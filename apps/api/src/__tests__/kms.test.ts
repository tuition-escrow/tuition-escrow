import { describe, it, expect } from "vitest";
import { LocalKmsAdapter } from "../kms/kms";

describe("LocalKmsAdapter", () => {
  const adapter = new LocalKmsAdapter("test-wrapping-key-32-bytes-minimum!");

  it("round-trips a plaintext value", async () => {
    const plain = "student-identifier-12345";
    const blob = await adapter.encrypt("dev-key", plain);
    const decrypted = await adapter.decrypt("dev-key", blob);
    expect(decrypted).toBe(plain);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const plain = "same-identifier";
    const blob1 = await adapter.encrypt("dev-key", plain);
    const blob2 = await adapter.encrypt("dev-key", plain);
    expect(blob1).not.toBe(blob2);
  });

  it("rejects a tampered ciphertext", async () => {
    const plain = "tamper-me";
    const blob = await adapter.encrypt("dev-key", plain);
    // Flip a byte in the middle of the base64
    const buf = Buffer.from(blob, "base64");
    buf[40] ^= 0xff;
    const tampered = buf.toString("base64");
    await expect(adapter.decrypt("dev-key", tampered)).rejects.toThrow();
  });

  it("throws if wrapping key is too short", () => {
    expect(() => new LocalKmsAdapter("short")).toThrow();
  });
});
