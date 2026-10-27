/**
 * API client for the web app.
 * All API calls go through this module — no component fetches directly.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...fetchOptions } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...fetchOptions, headers });

  if (!res.ok) {
    let code = 'unknown_error';
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string; message?: string };
      code = body.error ?? code;
      message = body.message ?? message;
    } catch { /* ignore */ }
    throw new ApiError(res.status, code, message);
  }

  return res.json() as Promise<T>;
}

// ─── Schools ──────────────────────────────────────────────────────────────

export interface School {
  id: string;
  name: string;
  stellar_address: string;
}

export async function listSchools(): Promise<School[]> {
  const data = await apiFetch<{ schools: School[] }>('/schools');
  return data.schools;
}

// ─── Vouchers ─────────────────────────────────────────────────────────────

export interface VoucherRow {
  voucher_id: string;
  funder: string;
  school: string;
  token: string;
  amount: string;
  category: number;
  student_ref: string;
  expires_at: string;
  status: string;
  created_at: string;
  attestation_count?: number;
}

export interface PrepareVoucherResponse {
  studentRef: string;
  mappingId: string;
  fundParams: {
    school: string;
    token: string;
    amount: number;
    category: number;
    studentRef: string;
    expiresAt: number;
  };
}

export async function prepareVoucher(
  token: string,
  payload: {
    schoolAddress: string;
    tokenAddress: string;
    amount: number;
    category: number;
    studentIdentifier: string;
    expiresAt: number;
  },
): Promise<PrepareVoucherResponse> {
  return apiFetch<PrepareVoucherResponse>('/vouchers/prepare', {
    method: 'POST',
    body: JSON.stringify(payload),
    token,
  });
}

export async function listVouchers(
  token: string,
  funderAddress?: string,
): Promise<VoucherRow[]> {
  const qs = funderAddress ? `?funderAddress=${encodeURIComponent(funderAddress)}` : '';
  const data = await apiFetch<{ vouchers: VoucherRow[] }>(`/vouchers${qs}`, { token });
  return data.vouchers;
}

export async function getVoucher(token: string, id: string): Promise<VoucherRow> {
  const data = await apiFetch<{ voucher: VoucherRow }>(`/vouchers/${id}`, { token });
  return data.voucher;
}

export interface MappingResponse {
  mapping: { studentIdentifier: string; salt: string };
}

export async function getVoucherMapping(
  token: string,
  schoolId: string,
  voucherId: string,
): Promise<MappingResponse> {
  return apiFetch<MappingResponse>(
    `/schools/${schoolId}/vouchers/${voucherId}/mapping`,
    { token },
  );
}
