/**
 * Gap recovery — fallback to get_voucher when RPC event history is gone.
 *
 * README section: "Testing strategy — Indexer"
 *   "Detect and recover from gaps (e.g. after downtime or RPC retention
 *    limits) with a documented fallback that reads current voucher state
 *    via get_voucher."
 *
 * When the indexer detects a gap (RPC rejects startLedger as too old),
 * it calls this module.  We iterate voucher IDs in the DB that are still
 * Funded, fetch their current on-chain state via get_voucher, and update
 * the DB accordingly.
 *
 * INVARIANT: We only ADVANCE state (Funded → terminal).  We never overwrite
 * a terminal state with an earlier state.  The chain is authoritative.
 *
 * get_voucher RPC call uses the `simulateTransaction` + `getEvents` path.
 * We call it as a read-only contract invocation via simulateTransaction.
 * Reference: https://developers.stellar.org/docs/data/rpc/api-reference/methods/simulateTransaction
 *
 * NOTE: Because we have not pinned the @stellar/stellar-sdk version, the
 * get_voucher invocation is done as a raw JSON-RPC call.  Replace with
 * the typed contract client once the SDK is pinned.
 */

import type { Pool, PoolClient } from 'pg';
import { logger } from './logger';
import { errorsCounter, eventsCounter } from './metrics';

export interface GapRecoveryOptions {
  rpcUrl: string;
  contractId: string;
  networkPassphrase: string;
}

/**
 * Minimal on-chain voucher state returned by get_voucher.
 * Only the fields we need to reconcile status.
 */
interface OnChainVoucherStatus {
  status: 'Funded' | 'Released' | 'Reclaimed' | 'Cancelled';
}

/**
 * Recover state for all Funded vouchers in the DB by calling get_voucher.
 *
 * This is O(n) in Funded vouchers.  In production with many vouchers,
 * batch or paginate.  For the pilot scale described in the README (capped
 * volumes) this is acceptable.
 */
export async function recoverGap(pool: Pool, opts: GapRecoveryOptions): Promise<void> {
  logger.warn(
    { contractId: opts.contractId },
    'Gap recovery: fetching on-chain state for all Funded vouchers',
  );

  const { rows } = await pool.query<{ voucher_id: string }>(
    `SELECT voucher_id FROM vouchers WHERE status = 'Funded' ORDER BY voucher_id`,
  );

  let recovered = 0;
  let errors = 0;

  for (const row of rows) {
    const voucherId = BigInt(row.voucher_id);
    try {
      const onChain = await fetchVoucherStatus(opts.rpcUrl, opts.contractId, voucherId);
      if (onChain && onChain.status !== 'Funded') {
        await applyRecoveredStatus(pool, voucherId, onChain.status);
        recovered++;
        eventsCounter.inc({ event_type: 'gap_recovery' });
      }
    } catch (err) {
      errors++;
      errorsCounter.inc({ error_type: 'gap_recovery' });
      logger.error(
        { voucherId: voucherId.toString(), err },
        'Gap recovery: failed to fetch voucher state',
      );
    }
  }

  logger.info({ recovered, errors, total: rows.length }, 'Gap recovery complete');
}

async function applyRecoveredStatus(
  pool: Pool,
  voucherId: bigint,
  status: 'Released' | 'Reclaimed' | 'Cancelled',
): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE vouchers
       SET status = $1, updated_at = now()
       WHERE voucher_id = $2
         AND status = 'Funded'`,
      [status, voucherId.toString()],
    );
    await client.query('COMMIT');
    logger.info(
      { voucherId: voucherId.toString(), status },
      'Gap recovery: status applied',
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Fetch voucher status from the chain using simulateTransaction.
 *
 * TODO: replace with the typed contract client from packages/contract-bindings
 * once the SDK is pinned and the bindings are regenerated.
 *
 * The get_voucher function is read-only, so simulateTransaction is the
 * correct RPC method (no fee required).
 *
 * Reference: https://developers.stellar.org/docs/data/rpc/api-reference/methods/simulateTransaction
 */
async function fetchVoucherStatus(
  rpcUrl: string,
  _contractId: string,
  _voucherId: bigint,
): Promise<OnChainVoucherStatus | null> {
  // STUB: real implementation calls simulateTransaction with get_voucher.
  // Replace once contract-bindings are regenerated with the deployed contract ID.
  //
  // Example (pseudocode):
  //   const contract = new Contract(contractId);
  //   const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
  //     .addOperation(contract.call('get_voucher', xdr.ScVal.scvU64(new xdr.Uint64(voucherId))))
  //     .setTimeout(0)
  //     .build();
  //   const result = await rpcClient.simulateTransaction(tx);
  //   const statusValue = result.result.retval; // parse XDR ScVal
  //
  // For now, return null (no state change) so the fallback is a no-op stub.
  logger.warn(
    { rpcUrl, voucherId: _voucherId.toString() },
    'fetchVoucherStatus: stub — implement with contract-bindings (see gap.ts TODO)',
  );
  return null;
}
