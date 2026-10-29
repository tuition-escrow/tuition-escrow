/**
 * Attester service tests.
 *
 * README section: "Testing strategy — Backend"
 * Task requirement:
 *   "Tests: success path, rejection path, expired voucher, unauthorized
 *    request, audit-log integrity verification."
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AttesterService } from "../service";
import { appendAuditEntry, verifyAuditChain } from "../audit";
import { SignedExportProvider } from "../verification";
import { createHmac } from "crypto";
import type { Pool, PoolClient } from "pg";

// ─── Helpers ──────────────────────────────────────────────────────────────

const TEST_SECRET = "test-secret";

function makeSignedToken(
  voucherId: string,
  approved: boolean,
  reason: string,
): string {
  const sig = createHmac("sha256", TEST_SECRET)
    .update(`${voucherId}:${approved}:${reason}`)
    .digest("hex");
  return JSON.stringify({ voucherId, approved, reason, sig });
}

function makeStubSigner(address = "account:attester") {
  return {
    address,
    sign: vi.fn(async (xdr: string) => xdr),
  };
}

/** Minimal in-memory mock for Postgres pool used by audit tests */
let auditRows: Array<{
  id: number;
  voucher_id: string;
  decision: string;
  reason: string;
  attester_address: string;
  timestamp: Date;
  prev_hash: string;
  entry_hash: string;
}> = [];

function makeAuditPool(): Pool {
  let idSeq = 0;
  const client: Partial<PoolClient> = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes("CREATE TABLE")) return { rows: [] };

      if (sql.includes("ORDER BY id DESC LIMIT 1")) {
        const last = auditRows[auditRows.length - 1];
        return { rows: last ? [{ entry_hash: last.entry_hash }] : [] };
      }

      if (sql.includes("INSERT INTO attester_audit_log")) {
        const row = {
          id: ++idSeq,
          voucher_id: (params as string[])[0],
          decision: (params as string[])[1],
          reason: (params as string[])[2],
          attester_address: (params as string[])[3],
          timestamp: new Date((params as string[])[4]),
          prev_hash: (params as string[])[5],
          entry_hash: (params as string[])[6],
        };
        auditRows.push(row);
        return { rows: [{ id: row.id }] };
      }

      if (sql.includes("SELECT * FROM attester_audit_log")) {
        if (params && params.length > 0) {
          return {
            rows: auditRows.filter((r) => r.attester_address === params[0]),
          };
        }
        return { rows: [...auditRows] };
      }

      return { rows: [] };
    }) as unknown as PoolClient["query"],
    release: vi.fn(),
  };

  return {
    connect: vi.fn(async () => client as PoolClient),
    query: client.query,
  } as unknown as Pool;
}

// ─── SignedExportProvider ─────────────────────────────────────────────────

describe("SignedExportProvider", () => {
  const provider = new SignedExportProvider(TEST_SECRET);

  it("approves a correctly signed token", async () => {
    const token = makeSignedToken("42", true, "Student enrolled");
    const result = await provider.verify(42n, { token });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("Student enrolled");
  });

  it("rejects a token with wrong signature", async () => {
    const token = JSON.stringify({
      voucherId: "42",
      approved: true,
      reason: "ok",
      sig: "bad",
    });
    const result = await provider.verify(42n, { token });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("signature mismatch");
  });

  it("rejects a token for a different voucherId", async () => {
    const token = makeSignedToken("99", true, "ok");
    const result = await provider.verify(42n, { token });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("mismatch");
  });

  it("rejects a rejection token", async () => {
    const token = makeSignedToken("42", false, "Student not enrolled");
    const result = await provider.verify(42n, { token });
    expect(result.ok).toBe(false);
  });

  it("rejects malformed JSON", async () => {
    const result = await provider.verify(42n, { token: "not-json" });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not valid JSON");
  });
});

// ─── AttesterService — success path ──────────────────────────────────────

describe("AttesterService — success path", () => {
  beforeEach(() => {
    auditRows = [];
  });

  it("approves and calls signer.sign when chain check passes and provider approves", async () => {
    const pool = makeAuditPool();
    const signer = makeStubSigner();
    const verifier = new SignedExportProvider(TEST_SECRET);
    const checker = {
      fetchVoucher: vi.fn(async () => ({
        id: 1n,
        funder: "account:f",
        school: "account:s",
        token: "contract:t",
        amount: 100n,
        category: 0,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
        status: "Funded" as const,
        attesters: ["account:attester"],
        threshold: 1,
        attestationCount: 0,
      })),
    };

    const service = new AttesterService(pool, verifier, signer, checker);
    await service.initialize();

    const token = makeSignedToken("1", true, "Enrolled");
    const result = await service.attest(1n, { token }, "user1");

    expect(result.success).toBe(true);
    expect(signer.sign).toHaveBeenCalledOnce();
  });
});

// ─── AttesterService — rejection path ────────────────────────────────────

describe("AttesterService — rejection path", () => {
  beforeEach(() => {
    auditRows = [];
  });

  it("rejects and does NOT call signer.sign when provider rejects", async () => {
    const pool = makeAuditPool();
    const signer = makeStubSigner();
    const verifier = new SignedExportProvider(TEST_SECRET);
    const checker = {
      fetchVoucher: vi.fn(async () => ({
        id: 2n,
        funder: "f",
        school: "s",
        token: "t",
        amount: 100n,
        category: 0,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
        status: "Funded" as const,
        attesters: ["account:attester"],
        threshold: 1,
        attestationCount: 0,
      })),
    };

    const service = new AttesterService(pool, verifier, signer, checker);
    await service.initialize();

    const token = makeSignedToken("2", false, "Not enrolled");
    const result = await service.attest(2n, { token }, "user1");

    expect(result.success).toBe(false);
    expect(result.reason).toBe("Not enrolled");
    expect(signer.sign).not.toHaveBeenCalled();
  });
});

// ─── AttesterService — expired voucher ───────────────────────────────────

describe("AttesterService — expired voucher", () => {
  beforeEach(() => {
    auditRows = [];
  });

  it("skips attestation when voucher is expired", async () => {
    const pool = makeAuditPool();
    const signer = makeStubSigner();
    const verifier = new SignedExportProvider(TEST_SECRET);
    const checker = {
      fetchVoucher: vi.fn(async () => ({
        id: 3n,
        funder: "f",
        school: "s",
        token: "t",
        amount: 100n,
        category: 0,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) - 60), // already expired
        status: "Funded" as const,
        attesters: ["account:attester"],
        threshold: 1,
        attestationCount: 0,
      })),
    };

    const service = new AttesterService(pool, verifier, signer, checker);
    await service.initialize();

    const token = makeSignedToken("3", true, "ok");
    const result = await service.attest(3n, { token }, "user1");

    expect(result.success).toBe(false);
    expect(result.reason).toContain("expired");
    expect(signer.sign).not.toHaveBeenCalled();
  });
});

// ─── AttesterService — unauthorized (attester not in set) ─────────────────

describe("AttesterService — unauthorized attester", () => {
  beforeEach(() => {
    auditRows = [];
  });

  it("skips when attester address is not in voucher attester set", async () => {
    const pool = makeAuditPool();
    const signer = makeStubSigner("account:not-an-attester");
    const verifier = new SignedExportProvider(TEST_SECRET);
    const checker = {
      fetchVoucher: vi.fn(async () => ({
        id: 4n,
        funder: "f",
        school: "s",
        token: "t",
        amount: 100n,
        category: 0,
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
        status: "Funded" as const,
        attesters: ["account:other-attester"],
        threshold: 1,
        attestationCount: 0,
      })),
    };

    const service = new AttesterService(pool, verifier, signer, checker);
    await service.initialize();

    const token = makeSignedToken("4", true, "ok");
    const result = await service.attest(4n, { token }, "user1");

    expect(result.success).toBe(false);
    expect(result.reason).toContain("not in the voucher");
    expect(signer.sign).not.toHaveBeenCalled();
  });
});

// ─── Audit log integrity verification ────────────────────────────────────

describe("Audit log integrity", () => {
  beforeEach(() => {
    auditRows = [];
  });

  it("verifyAuditChain passes for an untampered chain", async () => {
    const pool = makeAuditPool();

    await appendAuditEntry(pool, {
      voucherId: "10",
      decision: "approved",
      reason: "test",
      attesterAddress: "account:att",
    });
    await appendAuditEntry(pool, {
      voucherId: "11",
      decision: "rejected",
      reason: "test2",
      attesterAddress: "account:att",
    });

    const result = await verifyAuditChain(pool);
    expect(result.valid).toBe(true);
    expect(result.count).toBe(2);
  });

  it("verifyAuditChain detects a tampered entry_hash", async () => {
    const pool = makeAuditPool();

    await appendAuditEntry(pool, {
      voucherId: "20",
      decision: "approved",
      reason: "ok",
      attesterAddress: "account:att",
    });

    // Tamper with the entry_hash of the first row
    auditRows[0].entry_hash = "tampered";

    const result = await verifyAuditChain(pool);
    expect(result.valid).toBe(false);
    expect(result.firstBrokenId).toBeDefined();
  });
});
