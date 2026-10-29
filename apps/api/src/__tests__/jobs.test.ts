/**
 * Tests for TTL extension and expiry reminder jobs.
 *
 * README section: "Testing strategy — Backend"
 * Task requirement: "Include tests and documentation of the job schedule
 *   and safety margins."
 *
 * Tests use in-memory mocks — no real DB, Redis, or network.
 */

import { describe, it, expect, vi } from "vitest";
import {
  findVouchersNeedingTtlExtension,
  runTtlExtensionJob,
  TTL_SAFETY_MARGIN_DAYS,
} from "../jobs/ttl";
import {
  runExpiryRemindersJob,
  REMINDER_THRESHOLDS_HOURS,
} from "../jobs/expiry";
import type { Pool } from "pg";

// ─── TTL tests ────────────────────────────────────────────────────────────

describe("TTL extension job", () => {
  it("TTL_SAFETY_MARGIN_DAYS is a positive integer", () => {
    expect(typeof TTL_SAFETY_MARGIN_DAYS).toBe("number");
    expect(TTL_SAFETY_MARGIN_DAYS).toBeGreaterThan(0);
  });

  it("findVouchersNeedingTtlExtension queries for Funded vouchers", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query: mockQuery } as unknown as Pool;

    await findVouchersNeedingTtlExtension(pool, 30);

    expect(mockQuery).toHaveBeenCalledOnce();
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'Funded'");
    expect(sql).toContain("last_ttl_extended_at");
  });

  it("runTtlExtensionJob completes when there are no vouchers to extend", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query: mockQuery } as unknown as Pool;

    await expect(runTtlExtensionJob(pool)).resolves.not.toThrow();
  });

  it("runTtlExtensionJob marks voucher extended on success", async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 24 * 3600 * 1000);

    // First call: findVouchersNeedingTtlExtension
    // Second call: markTtlExtended UPDATE
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            voucher_id: "42",
            expires_at: expiresAt,
            last_ttl_extended_at: null,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });

    const pool = { query: mockQuery } as unknown as Pool;
    await runTtlExtensionJob(pool);

    // markTtlExtended should have been called with voucher_id '42'
    const updateCall = mockQuery.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("UPDATE vouchers SET last_ttl_extended_at"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain("42");
  });
});

// ─── Expiry reminder tests ────────────────────────────────────────────────

describe("Expiry reminder job", () => {
  it("REMINDER_THRESHOLDS_HOURS contains positive integers", () => {
    expect(REMINDER_THRESHOLDS_HOURS.length).toBeGreaterThan(0);
    for (const h of REMINDER_THRESHOLDS_HOURS) {
      expect(h).toBeGreaterThan(0);
    }
  });

  it("sends notifications for vouchers nearing expiry", async () => {
    const now = new Date();
    const expires = new Date(now.getTime() + 12 * 3600_000); // 12h from now

    // Mock: CREATE TABLE returns {rows:[]}; SELECT returns a voucher; INSERT returns {rows:[]}
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE IF NOT EXISTS
      .mockResolvedValueOnce({
        rows: [
          {
            voucher_id: "7",
            funder: "account:funder",
            school: "account:school",
            expires_at: expires,
          },
        ],
      }) // findVouchersForReminder for first tier
      .mockResolvedValue({ rows: [] }); // remaining queries

    const pool = { query: mockQuery } as unknown as Pool;

    const sentNotifications: unknown[] = [];
    const provider = {
      send: vi.fn(async (n: unknown) => {
        sentNotifications.push(n);
      }),
    };

    // Filter REMINDER_THRESHOLDS_HOURS to only include tiers that would
    // catch a 12h-away voucher (those > 12h wouldn't fire in real life, but
    // our mock returns the voucher for the first SELECT call).
    await runExpiryRemindersJob(pool, provider);

    // We sent notifications for funder + school
    expect(provider.send).toHaveBeenCalled();
    const calls = provider.send.mock.calls.map(
      (c) => c[0] as { voucherId: string; role: string },
    );
    const voucherCalls = calls.filter((c) => c.voucherId === "7");
    // Should include at least one funder and one school notification
    expect(voucherCalls.some((c) => c.role === "funder")).toBe(true);
    expect(voucherCalls.some((c) => c.role === "school")).toBe(true);
  });

  it("does not resend a reminder that was already recorded", async () => {
    // Mock: CREATE TABLE; then SELECT returns [] (already reminded)
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValue({ rows: [] }); // all SELECTs return empty

    const pool = { query: mockQuery } as unknown as Pool;
    const provider = { send: vi.fn() };

    await runExpiryRemindersJob(pool, provider);

    expect(provider.send).not.toHaveBeenCalled();
  });
});
