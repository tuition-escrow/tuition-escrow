/**
 * RPC client — thin wrapper around the Soroban RPC `getEvents` and
 * `getLatestLedger` endpoints.
 *
 * README sections: "System architecture" — "Soroban RPC (simulate, submit, getEvents)"
 *
 * We deliberately keep this wrapper minimal and typed so the rest of the
 * indexer never deals with raw HTTP.  If the Stellar SDK's RPC client
 * improves, swap this out here.
 *
 * All Soroban RPC calls are JSON-RPC 2.0 over HTTP POST.
 * Reference: https://developers.stellar.org/docs/data/rpc/api-reference
 *
 * NOTE: We do NOT import @stellar/stellar-sdk here because the generated
 * bindings package handles XDR decoding.  We call the JSON-RPC API directly
 * so the indexer has no hard dependency on an SDK version that may change.
 */

import { logger } from './logger';

export interface RpcEvent {
  /** Ledger sequence containing this event */
  ledger: number;
  /** Ledger close timestamp (Unix seconds) */
  ledgerClosedAt: string;
  /** Contract ID */
  contractId: string;
  /** Pageable cursor for this event */
  id: string;
  /**
   * topics[0] is the event name symbol, remaining topics are indexed fields.
   * Each topic is an XDR-encoded ScVal in base64.
   */
  topic: string[];
  /** Event body (XDR-encoded ScVal, base64) */
  value: { xdr: string };
  /** Whether this is a contract event */
  type: 'contract' | 'system' | 'diagnostic';
  /**
   * Parsed topic values — filled by the decoder, not by the RPC response.
   * Added by our parsing layer.
   */
  parsedTopics?: unknown[];
  /** Parsed value — filled by the decoder. */
  parsedValue?: unknown;
}

export interface GetEventsResponse {
  events: RpcEvent[];
  /** Cursor pointing past the last returned event; use for the next page. */
  latestLedger: number;
}

export interface GetLatestLedgerResponse {
  sequence: number;
}

export class SorobanRpcClient {
  private readonly rpcUrl: string;

  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl;
  }

  /**
   * Calls getEvents on the RPC node.
   *
   * @param contractId  - The voucher contract ID to filter by.
   * @param startLedger - First ledger to include (inclusive).
   * @param cursor      - Pagination cursor (if resuming within a page).
   * @param limit       - Max events per page (default 100, max 10 000).
   */
  async getEvents(
    contractId: string,
    startLedger: number,
    cursor?: string,
    limit = 100,
  ): Promise<GetEventsResponse> {
    const params: Record<string, unknown> = {
      filters: [
        {
          type: 'contract',
          contractIds: [contractId],
        },
      ],
      pagination: { limit },
    };

    if (cursor) {
      params['pagination'] = { cursor, limit };
    } else {
      params['startLedger'] = startLedger;
    }

    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getEvents',
      params,
    };

    const response = await this.post(body);
    const result = response.result as {
      events: RpcEvent[];
      latestLedger: number;
    };
    return {
      events: result.events ?? [],
      latestLedger: result.latestLedger,
    };
  }

  /**
   * Returns the latest ledger sequence from the RPC node.
   * Used to compute indexer lag.
   */
  async getLatestLedger(): Promise<GetLatestLedgerResponse> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'getLatestLedger',
      params: {},
    };
    const response = await this.post(body);
    const result = response.result as { sequence: number };
    return { sequence: result.sequence };
  }

  private async post(body: unknown): Promise<{ result: unknown }> {
    const res = await fetch(this.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as {
      result?: unknown;
      error?: { code: number; message: string };
    };
    if (json.error) {
      logger.error({ rpcError: json.error }, 'Soroban RPC error response');
      throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    }
    return { result: json.result };
  }
}
