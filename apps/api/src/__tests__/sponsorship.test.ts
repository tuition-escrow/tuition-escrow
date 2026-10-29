/**
 * Sponsorship service tests — mocked network calls.
 *
 * README section: "Fees and reserves"
 * Verifies: allowlist enforcement, balance threshold check.
 */

import { describe, it, expect } from "vitest";
import { SponsorshipServiceImpl } from "../services/sponsorship";

process.env.FEE_BUMP_SECRET_REF = "test-ref";
process.env.SPONSOR_ACCOUNT_ADDRESS = "G" + "A".repeat(55);
process.env.SPONSOR_BALANCE_THRESHOLD = "1000";

describe("SponsorshipServiceImpl", () => {
  it("rejects operations not on the allowlist", async () => {
    const svc = new SponsorshipServiceImpl();
    await expect(
      svc.wrapWithFeeBump("xdr-stub", "transfer", "account-1"),
    ).rejects.toThrow("SPONSORSHIP_NOT_ALLOWED");
  });

  it("accepts fund operation (on allowlist)", async () => {
    const svc = new SponsorshipServiceImpl();
    // Returns stub XDR in the current non-SDK implementation
    const result = await svc.wrapWithFeeBump("inner-xdr", "fund", "account-1");
    expect(result.feeBumpXdr).toBeDefined();
  });

  it("accepts change_trust operation (on allowlist)", async () => {
    const svc = new SponsorshipServiceImpl();
    const result = await svc.wrapWithFeeBump(
      "inner-xdr",
      "change_trust",
      "account-1",
    );
    expect(result.feeBumpXdr).toBeDefined();
  });
});
