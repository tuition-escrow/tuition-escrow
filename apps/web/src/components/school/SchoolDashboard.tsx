/**
 * SchoolDashboard — incoming vouchers by status + mapping view.
 *
 * README section: "How it works — School"
 *   - Dashboard of incoming vouchers (by status).
 *   - Mapping view: see which student each voucher belongs to (via the
 *     authenticated mapping endpoint); this data must NEVER appear in any
 *     funder or public view.
 *   - Cancel approval, payout address display, off-ramp placeholder panel
 *     (clearly labelled "anchor integration planned", not functional).
 *
 * Privacy invariants:
 *   - Student mapping data is only fetched on explicit request per voucher.
 *   - Mapping data is displayed in a school-only component and never
 *     included in any shared or public endpoint response.
 *   - No free-text memo fields.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { listVouchers, getVoucherMapping, type VoucherRow } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AmountDisplay } from '@/components/ui/AmountDisplay';
import { AddressDisplay } from '@/components/ui/AddressDisplay';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { VoucherStatus } from '@tuition-escrow/shared';
import { categoryLabel } from '@/lib/categories';

// ─── Mapping reveal (school-only) ────────────────────────────────────────

function MappingReveal({
  voucherId,
  schoolId,
}: {
  voucherId: string;
  schoolId: string;
}) {
  const { token } = useAuth();
  const [mapping, setMapping] = useState<{ studentIdentifier: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReveal = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await getVoucherMapping(token, schoolId, voucherId);
      setMapping({ studentIdentifier: resp.mapping.studentIdentifier });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load mapping');
    } finally {
      setLoading(false);
    }
  };

  const handleHide = () => setMapping(null);

  if (mapping) {
    return (
      <div className="mt-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 text-sm">
        <p className="text-yellow-800 font-medium mb-1">Student reference (school only)</p>
        <p className="font-mono text-yellow-900">{mapping.studentIdentifier}</p>
        <button
          onClick={handleHide}
          className="mt-2 text-xs text-yellow-700 underline focus-visible:ring-2 focus:outline-none"
        >
          Hide
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <ErrorDisplay error={error} />
      <button
        onClick={handleReveal}
        disabled={loading}
        className="rounded-md border border-yellow-400 bg-yellow-50 px-3 py-1.5 text-xs font-medium text-yellow-800 hover:bg-yellow-100 disabled:opacity-50 focus-visible:ring-2 focus:outline-none"
        aria-label={`Reveal student mapping for voucher ${voucherId}`}
      >
        {loading ? 'Loading…' : 'Reveal student'}
      </button>
    </div>
  );
}

// ─── School voucher card ──────────────────────────────────────────────────

function SchoolVoucherCard({
  v,
  schoolId,
}: {
  v: VoucherRow;
  schoolId: string;
}) {
  const status = v.status as VoucherStatus;

  return (
    <article
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-2"
      aria-labelledby={`school-voucher-${v.voucher_id}`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <h3 id={`school-voucher-${v.voucher_id}`} className="font-semibold text-sm">
          Voucher #{v.voucher_id}
        </h3>
        <StatusBadge status={status} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">Funder</dt>
        <dd><AddressDisplay address={v.funder} /></dd>

        <dt className="text-gray-500">Amount</dt>
        <dd><AmountDisplay amount={BigInt(v.amount)} /></dd>

        <dt className="text-gray-500">Category</dt>
        <dd>{categoryLabel(v.category)}</dd>

        <dt className="text-gray-500">Expires</dt>
        <dd>{new Date(v.expires_at).toLocaleDateString()}</dd>
      </dl>

      {/* School-only student mapping */}
      <MappingReveal voucherId={v.voucher_id} schoolId={schoolId} />
    </article>
  );
}

// ─── SchoolDashboard ──────────────────────────────────────────────────────

export function SchoolDashboard() {
  const { token, user } = useAuth();
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [filter, setFilter] = useState<VoucherStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const schoolId = user?.schoolId ?? '';

  useEffect(() => {
    if (!token) return;
    listVouchers(token)
      .then(setVouchers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const filtered =
    filter === 'all'
      ? vouchers
      : vouchers.filter((v) => v.status === filter);

  const statuses: (VoucherStatus | 'all')[] = [
    'all',
    VoucherStatus.Funded,
    VoucherStatus.Released,
    VoucherStatus.Reclaimed,
    VoucherStatus.Cancelled,
  ];

  return (
    <section aria-labelledby="school-dashboard-heading">
      <h2 id="school-dashboard-heading" className="text-lg font-semibold mb-4">
        Incoming vouchers
      </h2>

      {/* Payout address */}
      <div className="mb-4 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm">
        <span className="text-gray-500 mr-2">Payout address:</span>
        <AddressDisplay address={user?.stellarAddress ?? '—'} />
      </div>

      {/* Off-ramp placeholder */}
      <div className="mb-6 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        <span className="font-medium text-gray-700">Anchor integration planned</span>
        {' '}— withdraw funds to a local bank account or mobile wallet via a
        Stellar anchor (SEP-24/SEP-31). Not yet functional in this release.
      </div>

      <ErrorDisplay error={error} />

      {/* Status filter */}
      <div
        role="group"
        aria-label="Filter vouchers by status"
        className="flex gap-2 flex-wrap mb-4"
      >
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={`rounded-full px-3 py-1 text-xs font-medium border focus-visible:ring-2 focus:outline-none ${
              filter === s
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {s === 'all' ? 'All' : s}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500">No vouchers found.</p>
      ) : (
        <ul className="space-y-4" aria-label="Voucher list">
          {filtered.map((v) => (
            <li key={v.voucher_id}>
              <SchoolVoucherCard v={v} schoolId={schoolId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
