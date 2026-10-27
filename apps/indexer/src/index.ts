/**
 * Main indexer loop.
 *
 * README sections:
 *   "System architecture — Indexer"
 *   "Operations and monitoring"
 *
 * Responsibilities:
 *   1. Read the deployment start ledger from deployments/<network>.json.
 *   2. Poll Soroban RPC getEvents for the voucher contract.
 *   3. Decode and apply events transactionally (cursor + writes are atomic).
 *   4. Detect and recover from gaps via get_voucher fallback.
 *   5. Expose Prometheus metrics on /metrics.
 *   6. Expose /health endpoint.
 *
 * Environment variables:
 *   STELLAR_NETWORK          — 'local' | 'testnet' | 'mainnet'
 *   STELLAR_RPC_URL          — Soroban RPC endpoint
 *   DATABASE_URL             — Postgres connection string
 *   INDEXER_POLL_INTERVAL    — ms between polls (default 5000)
 *   NETWORK_PASSPHRASE       — for gap recovery (optional at this stage)
 *   LOG_LEVEL                — default 'info'
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { Pool } from 'pg';
import { logger } from './logger';
import { SorobanRpcClient } from './rpc';
import { decodeEvent } from './decoder';
import {
  handleFunded,
  handleAttested,
  handleReleased,
  handleReclaimed,
  handleCancelled,
} from './handlers';
import { ensureCursorTable, readCursor, writeCursor } from './cursor';
import { recoverGap } from './gap';
import {
  metricsRegistry,
  latestLedgerGauge,
  lagGauge,
  errorsCounter,
} from './metrics';

// ─── Configuration ────────────────────────────────────────────────────────

function loadDeployment(network: string): { contractId: string; startLedger: number } {
  const filePath = path.resolve(
    __dirname,
    '../../../deployments',
    `${network}.json`,
  );
  if (!fs.existsSync(filePath)) {
    throw new Error(`Deployment file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw) as {
    voucherContractId?: string;
    deployLedger?: number;
  };
  if (!data.voucherContractId) {
    throw new Error(
      `deployments/${network}.json is missing voucherContractId. ` +
        'Run the deploy script and update the file.',
    );
  }
  return {
    contractId: data.voucherContractId,
    startLedger: data.deployLedger ?? 0,
  };
}

// ─── Metrics HTTP server ──────────────────────────────────────────────────

function startMetricsServer(port: number): void {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.end(await metricsRegistry.metrics());
    } else if (req.url === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
    } else {
      res.statusCode = 404;
      res.end('not_found');
    }
  });
  server.listen(port, () => {
    logger.info({ port }, 'Indexer metrics/health server listening');
  });
}

// ─── Main loop ────────────────────────────────────────────────────────────

async function runIndexer(pool: Pool, rpc: SorobanRpcClient, contractId: string, deployLedger: number): Promise<void> {
  const pollInterval = parseInt(process.env.INDEXER_POLL_INTERVAL ?? '5000', 10);
  const network = process.env.STELLAR_NETWORK ?? 'testnet';
  const networkPassphrase = process.env.NETWORK_PASSPHRASE ?? '';
  const rpcUrl = process.env.STELLAR_RPC_URL ?? '';

  // Ensure cursor table and initial row exist
  {
    const client = await pool.connect();
    try {
      await ensureCursorTable(client);
    } finally {
      client.release();
    }
  }

  logger.info({ contractId, deployLedger, pollInterval }, 'Indexer started');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce(pool, rpc, contractId, deployLedger, {
        rpcUrl,
        networkPassphrase,
        network,
      });
    } catch (err) {
      errorsCounter.inc({ error_type: 'poll_loop' });
      logger.error({ err }, 'Indexer poll error');
    }

    await sleep(pollInterval);
  }
}

interface PollContext {
  rpcUrl: string;
  networkPassphrase: string;
  network: string;
}

async function pollOnce(
  pool: Pool,
  rpc: SorobanRpcClient,
  contractId: string,
  deployLedger: number,
  ctx: PollContext,
): Promise<void> {
  // Read cursor within a transaction-less connection (just reading)
  const client = await pool.connect();
  let cursor;
  try {
    cursor = await readCursor(client);
  } finally {
    client.release();
  }

  const startLedger = Math.max(cursor.lastLedger + 1, deployLedger);

  // Fetch a page of events
  let response;
  try {
    response = await rpc.getEvents(contractId, startLedger, cursor.lastEventId ?? undefined);
  } catch (err: unknown) {
    const msg = String(err);
    // RPC error -32602 indicates the startLedger is too old (gap detected)
    if (msg.includes('-32602') || msg.includes('too old') || msg.includes('startLedger')) {
      logger.warn({ startLedger }, 'Gap detected: startLedger outside RPC retention window. Starting gap recovery.');
      await recoverGap(pool, {
        rpcUrl: ctx.rpcUrl,
        contractId,
        networkPassphrase: ctx.networkPassphrase,
      });
      // Reset cursor to current ledger tip so we don't loop on gap recovery
      const { sequence } = await rpc.getLatestLedger();
      const resetClient = await pool.connect();
      try {
        await resetClient.query('BEGIN');
        await writeCursor(resetClient, sequence, null);
        await resetClient.query('COMMIT');
      } finally {
        resetClient.release();
      }
      return;
    }
    throw err;
  }

  // Update lag metric
  try {
    const { sequence } = await rpc.getLatestLedger();
    lagGauge.set(Math.max(0, sequence - response.latestLedger));
    latestLedgerGauge.set(response.latestLedger);
  } catch {
    // Non-fatal — metrics may lag
  }

  if (response.events.length === 0) {
    return;
  }

  // Process all events in a single DB transaction (atomic with cursor write)
  const txClient = await pool.connect();
  try {
    await txClient.query('BEGIN');

    let lastLedger = cursor.lastLedger;
    let lastEventId: string | null = cursor.lastEventId;

    for (const rawEvent of response.events) {
      const decoded = decodeEvent(rawEvent);
      if (!decoded) {
        logger.debug({ eventId: rawEvent.id }, 'Skipping unknown event');
        continue;
      }

      switch (decoded.name) {
        case 'funded':
          await handleFunded(txClient, decoded);
          break;
        case 'attested':
          await handleAttested(txClient, decoded);
          break;
        case 'released':
          await handleReleased(txClient, decoded);
          break;
        case 'reclaimed':
          await handleReclaimed(txClient, decoded);
          break;
        case 'cancelled':
          await handleCancelled(txClient, decoded);
          break;
      }

      if (rawEvent.ledger > lastLedger) lastLedger = rawEvent.ledger;
      lastEventId = rawEvent.id;
    }

    await writeCursor(txClient, lastLedger, lastEventId);
    await txClient.query('COMMIT');

    latestLedgerGauge.set(lastLedger);
    logger.info(
      { eventsProcessed: response.events.length, lastLedger, lastEventId },
      'Poll complete',
    );
  } catch (err) {
    await txClient.query('ROLLBACK');
    errorsCounter.inc({ error_type: 'db_transaction' });
    throw err;
  } finally {
    txClient.release();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry point ─────────────────────────────────────────────────────────

import { initSentry } from '@tuition-escrow/shared';

async function main(): Promise<void> {
  initSentry('indexer');
  const network = process.env.STELLAR_NETWORK ?? 'testnet';
  const rpcUrl = process.env.STELLAR_RPC_URL;
  const databaseUrl = process.env.DATABASE_URL;
  const metricsPort = parseInt(process.env.INDEXER_METRICS_PORT ?? '9101', 10);

  if (!rpcUrl) throw new Error('STELLAR_RPC_URL is required');
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const deployment = loadDeployment(network);
  const pool = new Pool({ connectionString: databaseUrl });
  const rpc = new SorobanRpcClient(rpcUrl);

  startMetricsServer(metricsPort);
  await runIndexer(pool, rpc, deployment.contractId, deployment.startLedger);
}

if (require.main === module) {
  main().catch((err) => {
    logger.error({ err }, 'Fatal indexer error');
    process.exit(1);
  });
}

export { runIndexer, pollOnce, loadDeployment };
