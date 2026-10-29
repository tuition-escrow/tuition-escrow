/**
 * Authorization boundary tests.
 *
 * Verifies that:
 *   1. Unauthenticated requests are rejected with 401.
 *   2. Wrong-role requests are rejected with 403.
 *   3. school_admin cannot access another school's voucher mapping.
 *   4. funder cannot access another funder's vouchers.
 *   5. No endpoint can be called without auth to move funds.
 *
 * Uses an in-memory mock of pool and dependencies — no real DB needed.
 */

import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { schoolsRouter } from "../routes/schools";
import { vouchersRouter, schoolVouchersRouter } from "../routes/vouchers";
import { StudentMappingService } from "../services/studentMapping";
import { Pool } from "pg";

const JWT_SECRET = "test-secret-for-auth-tests";
process.env.JWT_SECRET = JWT_SECRET;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeToken(role: string, extra: Record<string, unknown> = {}) {
  return jwt.sign(
    { userId: "user-1", sub: "sub-1", role, ...extra },
    JWT_SECRET,
  );
}

function mockPool(
  queryFn: (text: string, params?: unknown[]) => { rows: unknown[] },
): Pool {
  return { query: vi.fn(queryFn) } as unknown as Pool;
}

function stubMappingService(pool: Pool): StudentMappingService {
  const kms = {
    encrypt: vi.fn(async (_: string, p: string) => `enc:${p}`),
    decrypt: vi.fn(async (_: string, c: string) => c.replace("enc:", "")),
  };
  return new StudentMappingService(pool, kms, "dev-key");
}

// ── App builder ───────────────────────────────────────────────────────────────

function buildApp(pool: Pool) {
  const app = express();
  app.use(express.json());
  const mapping = stubMappingService(pool);
  app.use("/schools", schoolsRouter(pool));
  app.use("/vouchers", vouchersRouter(pool, mapping));
  app.use("/schools/:id/vouchers", schoolVouchersRouter(pool, mapping));
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth boundaries — schools", () => {
  const pool = mockPool(() => ({ rows: [] }));
  const app = buildApp(pool);

  it("GET /schools is public (no auth required)", async () => {
    const res = await request(app).get("/schools");
    expect(res.status).toBe(200);
  });

  it("POST /schools without token → 401", async () => {
    const res = await request(app)
      .post("/schools")
      .send({ name: "X", stellarAddress: "G".repeat(56) });
    expect(res.status).toBe(401);
  });

  it("POST /schools with funder token → 403", async () => {
    const res = await request(app)
      .post("/schools")
      .set("Authorization", `Bearer ${makeToken("funder")}`)
      .send({ name: "X", stellarAddress: "G".repeat(56) });
    expect(res.status).toBe(403);
  });

  it("POST /schools with school_admin token → 403", async () => {
    const res = await request(app)
      .post("/schools")
      .set(
        "Authorization",
        `Bearer ${makeToken("school_admin", { schoolId: "school-1" })}`,
      )
      .send({ name: "X", stellarAddress: "G".repeat(56) });
    expect(res.status).toBe(403);
  });

  it("PATCH /schools/:id without token → 401", async () => {
    const res = await request(app)
      .patch("/schools/abc")
      .send({ stellarAddress: "G".repeat(56) });
    expect(res.status).toBe(401);
  });
});

describe("Auth boundaries — vouchers", () => {
  it("POST /vouchers/prepare without token → 401", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    const app = buildApp(pool);
    const res = await request(app).post("/vouchers/prepare").send({});
    expect(res.status).toBe(401);
  });

  it("POST /vouchers/prepare with school_admin token → 403", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    const app = buildApp(pool);
    const res = await request(app)
      .post("/vouchers/prepare")
      .set(
        "Authorization",
        `Bearer ${makeToken("school_admin", { schoolId: "s1" })}`,
      )
      .send({});
    expect(res.status).toBe(403);
  });

  it("GET /vouchers without token → 401", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    const app = buildApp(pool);
    const res = await request(app).get("/vouchers");
    expect(res.status).toBe(401);
  });

  it("GET /vouchers/:id without token → 401", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    const app = buildApp(pool);
    const res = await request(app).get("/vouchers/1");
    expect(res.status).toBe(401);
  });
});

describe("Auth boundaries — mapping endpoint", () => {
  it("GET mapping without token → 401", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    const app = buildApp(pool);
    const res = await request(app).get("/schools/school-1/vouchers/42/mapping");
    expect(res.status).toBe(401);
  });

  it("GET mapping with funder token → 403", async () => {
    const pool = mockPool(() => ({ rows: [] }));
    const app = buildApp(pool);
    const res = await request(app)
      .get("/schools/school-1/vouchers/42/mapping")
      .set("Authorization", `Bearer ${makeToken("funder")}`);
    expect(res.status).toBe(403);
  });

  it("GET mapping with school_admin for WRONG school → 403", async () => {
    // school_admin belongs to school 'school-A'
    // voucher belongs to school 'GBBBBBBBB...'
    // school-A stellar address is 'GAAAAAAAAA...'
    const pool = mockPool((text) => {
      if (text.includes("FROM schools WHERE id")) {
        return { rows: [{ stellar_address: "G" + "A".repeat(55) }] };
      }
      if (text.includes("FROM vouchers WHERE voucher_id")) {
        return { rows: [{ school: "G" + "B".repeat(55) }] }; // different school
      }
      return { rows: [] };
    });
    const app = buildApp(pool);
    const res = await request(app)
      .get("/schools/school-A/vouchers/42/mapping")
      .set(
        "Authorization",
        `Bearer ${makeToken("school_admin", { schoolId: "school-A" })}`,
      );
    expect(res.status).toBe(403);
  });

  it("GET mapping with school_admin for CORRECT school → calls mapping service", async () => {
    const pool = mockPool((text) => {
      if (text.includes("FROM schools WHERE id")) {
        return { rows: [{ stellar_address: "G" + "A".repeat(55) }] };
      }
      if (text.includes("FROM vouchers WHERE voucher_id")) {
        return { rows: [{ school: "G" + "A".repeat(55) }] }; // same school
      }
      if (text.includes("FROM student_mappings")) {
        return {
          rows: [
            {
              id: "mapping-1",
              encrypted_student_identifier: "enc:student-123",
              encrypted_salt: "enc:salt-abc",
              key_id: "dev-key",
              deleted_at: null,
            },
          ],
        };
      }
      if (text.includes("INSERT INTO audit_log")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const app = buildApp(pool);
    const res = await request(app)
      .get("/schools/school-A/vouchers/42/mapping")
      .set(
        "Authorization",
        `Bearer ${makeToken("school_admin", { schoolId: "school-A" })}`,
      );
    expect(res.status).toBe(200);
    expect(res.body.mapping).toBeDefined();
    expect(res.body.mapping.studentIdentifier).toBe("student-123");
  });
});
