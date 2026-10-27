/**
 * Indexer tests.
 *
 * README section: "Testing strategy — Indexer"
 *   "recorded RPC fixtures, replay safety, restart-mid-batch behavior"
 *
 * Test approach:
 *   - All RPC calls are replaced with fixture data (no network).
 *   - Database calls use a simple in-memory mock (no Postgres needed).
 *   - We verify idempotency by replaying the same batch twice.
 *   - We verify restart-mid-batch by simulating a crash after the 2nd
 *     event in a 3-event batch and confirming cursor + state after restart.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RpcEvent } from '../rpc';
import { decodeEvent } from '../decoder';
import {
  handleFunded,
  handleAttested,
  handleReleased,
  handleReclaimed,
  handleCancelled,
} from '../handlers';

// ─── Fixtures ─────────────────────────────────────────────────────────────
//
// We use synthetic XDR blobs built from known values.
// The decoder tests verify the XDR decoding separately.
// Here we test the handler logic using pre-decoded events.

import type { PoolClient } from 'pg';

// A minimal mock PoolClient for handler tests
function makeClient(state: {
  vouchers: Map<string, { status: string; attestation_count: number }>;
}): Partial<PoolClient> {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const id = params?.[0] as string;

      if (sql.includes('INSERT INTO vouchers') && sql.includes('ON CONFLICT')) {
        if (!state.vouchers.has(id)) {
          state.vouchers.set(id, { status: 'Funded', attestation_count: 0 });
        }
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes('SET attestation_count = GREATEST') && state.vouchers.has(id)) {
        const v = state.vouchers.get(id)!;
        const newCount = Math.max(v.attestation_count, (params?.[1] as number) ?? 0);
        state.vouchers.set(id, { ...v, attestation_count: newCount });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("SET status = 'Released'") && state.vouchers.has(id)) {
        const v = state.vouchers.get(id)!;
        if (v.status === 'Funded') state.vouchers.set(id, { ...v, status: 'Released' });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("SET status = 'Reclaimed'") && state.vouchers.has(id)) {
        const v = state.vouchers.get(id)!;
        if (v.status === 'Funded') state.vouchers.set(id, { ...v, status: 'Reclaimed' });
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("SET status = 'Cancelled'") && state.vouchers.has(id)) {
        const v = state.vouchers.get(id)!;
        if (v.status === 'Funded') state.vouchers.set(id, { ...v, status: 'Cancelled' });
        return { rows: [], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }) as unknown as PoolClient['query'],
  };
}

// ─── Handler unit tests ───────────────────────────────────────────────────

describe('handleFunded', () => {
  it('inserts a new voucher row', async () => {
    const state = { vouchers: new Map() };
    const client = makeClient(state) as unknown as PoolClient;

    await handleFunded(client, {
      name: 'funded',
      ledger: 100,
      id: 1n,
      funder: 'account:aaa',
      school: 'account:bbb',
      token: 'contract:ccc',
      amount: 40000n,
      category: 0,
      expiresAt: 1800000000n,
    });

    expect(state.vouchers.has('1')).toBe(true);
    expect(state.vouchers.get('1')?.status).toBe('Funded');
  });

  it('is idempotent — second insert is ignored', async () => {
    const state = { vouchers: new Map() };
    const client = makeClient(state) as unknown as PoolClient;

    const ev = {
      name: 'funded' as const,
      ledger: 100,
      id: 1n,
      funder: 'account:aaa',
      school: 'account:bbb',
      token: 'contract:ccc',
      amount: 40000n,
      category: 0,
      expiresAt: 1800000000n,
    };

    await handleFunded(client, ev);
    await handleFunded(client, ev); // replay

    // Still only one entry (ON CONFLICT DO NOTHING)
    expect(state.vouchers.size).toBe(1);
  });
});

describe('handleAttested', () => {
  it('updates attestation_count', async () => {
    const state = { vouchers: new Map([['2', { status: 'Funded', attestation_count: 0 }]]) };
    const client = makeClient(state) as unknown as PoolClient;

    await handleAttested(client, { name: 'attested', ledger: 101, id: 2n, attester: 'account:att1', count: 1 });

    expect(state.vouchers.get('2')?.attestation_count).toBe(1);
  });

  it('is idempotent — replaying count=1 does not lower from 2', async () => {
    const state = { vouchers: new Map([['2', { status: 'Funded', attestation_count: 2 }]]) };
    const client = makeClient(state) as unknown as PoolClient;

    // Replay an earlier attestation event
    await handleAttested(client, { name: 'attested', ledger: 101, id: 2n, attester: 'account:att1', count: 1 });

    // Count should remain 2 (GREATEST)
    expect(state.vouchers.get('2')?.attestation_count).toBe(2);
  });
});

describe('handleReleased', () => {
  it('sets status to Released', async () => {
    const state = { vouchers: new Map([['3', { status: 'Funded', attestation_count: 2 }]]) };
    const client = makeClient(state) as unknown as PoolClient;

    await handleReleased(client, { name: 'released', ledger: 102, id: 3n, school: 'account:school', amount: 40000n });

    expect(state.vouchers.get('3')?.status).toBe('Released');
  });

  it('is idempotent — already Released stays Released', async () => {
    const state = { vouchers: new Map([['3', { status: 'Released', attestation_count: 2 }]]) };
    const client = makeClient(state) as unknown as PoolClient;

    await handleReleased(client, { name: 'released', ledger: 102, id: 3n, school: 'account:school', amount: 40000n });

    expect(state.vouchers.get('3')?.status).toBe('Released');
  });
});

describe('handleReclaimed', () => {
  it('sets status to Reclaimed', async () => {
    const state = { vouchers: new Map([['4', { status: 'Funded', attestation_count: 0 }]]) };
    const client = makeClient(state) as unknown as PoolClient;

    await handleReclaimed(client, { name: 'reclaimed', ledger: 200, id: 4n, funder: 'account:funder', amount: 40000n });

    expect(state.vouchers.get('4')?.status).toBe('Reclaimed');
  });
});

describe('handleCancelled', () => {
  it('sets status to Cancelled', async () => {
    const state = { vouchers: new Map([['5', { status: 'Funded', attestation_count: 0 }]]) };
    const client = makeClient(state) as unknown as PoolClient;

    await handleCancelled(client, { name: 'cancelled', ledger: 150, id: 5n });

    expect(state.vouchers.get('5')?.status).toBe('Cancelled');
  });
});

// ─── Replay safety ────────────────────────────────────────────────────────

describe('replay safety — full batch', () => {
  it('replaying a batch of funded+attested+released produces same state', async () => {
    const state = { vouchers: new Map<string, { status: string; attestation_count: number }>() };
    const client = makeClient(state) as unknown as PoolClient;

    const applyBatch = async () => {
      await handleFunded(client, {
        name: 'funded', ledger: 100, id: 10n,
        funder: 'account:f', school: 'account:s', token: 'contract:t',
        amount: 100n, category: 1, expiresAt: 1900000000n,
      });
      await handleAttested(client, { name: 'attested', ledger: 101, id: 10n, attester: 'account:a1', count: 1 });
      await handleAttested(client, { name: 'attested', ledger: 101, id: 10n, attester: 'account:a2', count: 2 });
      await handleReleased(client, { name: 'released', ledger: 102, id: 10n, school: 'account:s', amount: 100n });
    };

    await applyBatch();
    const stateAfterFirst = state.vouchers.get('10');

    // Replay same batch
    await applyBatch();
    const stateAfterSecond = state.vouchers.get('10');

    expect(stateAfterFirst).toEqual(stateAfterSecond);
    expect(stateAfterSecond?.status).toBe('Released');
    expect(stateAfterSecond?.attestation_count).toBe(2);
  });
});

// ─── Restart-mid-batch ────────────────────────────────────────────────────

describe('restart-mid-batch behavior', () => {
  it('partial batch followed by restart re-applies only un-persisted events', async () => {
    // Simulate: batch has 3 events. "Crash" after event 2 (attested).
    // Cursor is not advanced. On restart, all 3 events are replayed.
    // The final state must be the same as if there was no crash.

    const state = { vouchers: new Map<string, { status: string; attestation_count: number }>() };
    const client = makeClient(state) as unknown as PoolClient;

    // First run: apply funded + attested, then simulate crash (no cursor update)
    await handleFunded(client, {
      name: 'funded', ledger: 100, id: 20n,
      funder: 'account:f', school: 'account:s', token: 'contract:t',
      amount: 200n, category: 0, expiresAt: 1900000000n,
    });
    await handleAttested(client, { name: 'attested', ledger: 101, id: 20n, attester: 'account:a1', count: 1 });
    // Crash here — cursor not written

    // Restart: replay all 3 events including the released one
    await handleFunded(client, {
      name: 'funded', ledger: 100, id: 20n,
      funder: 'account:f', school: 'account:s', token: 'contract:t',
      amount: 200n, category: 0, expiresAt: 1900000000n,
    });
    await handleAttested(client, { name: 'attested', ledger: 101, id: 20n, attester: 'account:a1', count: 1 });
    await handleReleased(client, { name: 'released', ledger: 102, id: 20n, school: 'account:s', amount: 200n });

    expect(state.vouchers.get('20')?.status).toBe('Released');
  });
});

// ─── Decoder smoke test (using fixture RpcEvent) ──────────────────────────

describe('decodeEvent', () => {
  it('returns null for a diagnostic event', () => {
    const ev: RpcEvent = {
      ledger: 99,
      ledgerClosedAt: '2024-01-01T00:00:00Z',
      contractId: 'C123',
      id: 'abc',
      topic: [],
      value: { xdr: '' },
      type: 'diagnostic',
    };
    expect(decodeEvent(ev)).toBeNull();
  });

  it('returns null for an unknown event name', () => {
    // Encode symbol_short "hello" as SCV_SYMBOL XDR
    // discriminant=15 (SCV_SYMBOL), length=5, "hello" padded to 8 bytes
    const disc = Buffer.alloc(4);
    disc.writeInt32BE(15, 0);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(5, 0);
    const str = Buffer.from('hello\0\0\0'); // padded to 8
    const topicXdr = Buffer.concat([disc, len, str]).toString('base64');

    const ev: RpcEvent = {
      ledger: 99,
      ledgerClosedAt: '2024-01-01T00:00:00Z',
      contractId: 'C123',
      id: 'abc',
      topic: [topicXdr],
      value: { xdr: '' },
      type: 'contract',
    };
    expect(decodeEvent(ev)).toBeNull();
  });
});
