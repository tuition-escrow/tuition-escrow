/**
 * VoucherList + VoucherDetail — funder's voucher views.
 *
 * README section: "How it works — Funder"
 *   - My vouchers list and detail: status timeline, attestation count, expiry countdown.
 *   - Reclaim button, enabled only after expiry for Funded vouchers.
 *   - Cancel request flow (requires school co-signature — shown as a request).
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useWallet } from '@/providers/WalletProvider';
import { listVouchers, type VoucherRow } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { AmountDisplay } from '@/components/ui/AmountDisplay';
import { AddressDisplay } from '@/components/ui/AddressDisplay';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { ContractCallPreviewPanel } from '@/components/ui/ContractCallPreviewPanel';
import { VoucherStatus } from '@tuition-escrow/shared';
import { categoryLabel } from '@/lib/categories';

// ─── helpers ──────────────────────────────────────────────────────────────

function expiryCountdown(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  return `${h}h`;
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

// ─── VoucherCard ──────────────────────────────────────────────────────────

function VoucherCard({
  v,
  onReclaim,
  onCancelRequest,
}: {
  v: VoucherRow;
  onReclaim: (id: string) => void;
  onCancelRequest: (id: string) => void;
}) {
  const expired = isExpired(v.expires_at);
  const status = v.status as VoucherStatus;

  return (
    <article
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3"
      aria-labelledby={`voucher-${v.voucher_id}-title`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <h3 id={`voucher-${v.voucher_id}-title`} className="font-semibold text-sm">
          Voucher #{v.voucher_id}
        </h3>
        <StatusBadge status={status} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">School</dt>
        <dd><AddressDisplay address={v.school} /></dd>

        <dt className="text-gray-500">Amount</dt>
        <dd><AmountDisplay amount={BigInt(v.amount)} /></dd>

        <dt className="text-gray-500">Category</dt>
        <dd>{categoryLabel(v.category)}</dd>

        <dt className="text-gray-500">Attestations</dt>
        <dd>{v.attestation_count ?? 0}</dd>

        <dt className="text-gray-500">Expiry</dt>
        <dd className={expired ? 'text-red-600 font-medium' : ''}>
          {expiryCountdown(v.expires_at)}
        </dd>
      </dl>

      {/* Status timeline */}
      <div className="text-xs text-gray-400">
        Created {new Date(v.created_at).toLocaleDateString()}
        {' → '}
        <span className="font-medium text-gray-700">{v.status}</span>
      </div>

      {/* Actions */}
      <div className="flex gap-2 flex-wrap">
        {status === VoucherStatus.Funded && expired && (
          <button
            onClick={() => onReclaim(v.voucher_id)}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 focus-visible:ring-2 focus:outline-none"
            aria-label={`Reclaim voucher ${v.voucher_id}`}
          >
            Reclaim
          </button>
        )}
        {status === VoucherStatus.Funded && !expired && (
          <button
            onClick={() => onCancelRequest(v.voucher_id)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:ring-2 focus:outline-none"
            aria-label={`Request cancellation of voucher ${v.voucher_id}`}
          >
            Request cancellation
          </button>
        )}
      </div>
    </article>
  );
}

// ─── VoucherList ──────────────────────────────────────────────────────────

export function FunderVoucherList() {
  const { token, user } = useAuth();
  const { wallet, signAndSubmit } = useWallet();
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPreview, setActionPreview] = useState<{
    voucherId: string;
    preview: { functionName: string; parameters: Array<{ name: string; value: string }> };
    action: 'reclaim' | 'cancel';
  } | null>(null);
  const [txResult, setTxResult] = useState<string | null>(null);

  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';

  useEffect(() => {
    if (!token) return;
    listVouchers(token, wallet.address ?? undefined)
      .then(setVouchers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, wallet.address]);

  const handleReclaim = (voucherId: string) => {
    setActionPreview({
      voucherId,
      action: 'reclaim',
      preview: {
        functionName: 'reclaim',
        parameters: [{ name: 'voucher_id', value: voucherId }],
      },
    });
  };

  const handleCancelRequest = (voucherId: string) => {
    setActionPreview({
      voucherId,
      action: 'cancel',
      preview: {
        functionName: 'cancel',
        parameters: [
          { name: 'voucher_id', value: voucherId },
          { name: 'note', value: 'Requires school co-signature to complete' },
        ],
      },
    });
  };

  const handleConfirmAction = async () => {
    if (!actionPreview) return;
    const xdr = `${actionPreview.action}:${actionPreview.voucherId}`;
    try {
      const hash = await signAndSubmit(xdr, actionPreview.preview);
      setTxResult(hash);
      setActionPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading vouchers…</p>;

  return (
    <section aria-labelledby="voucher-list-heading">
      <h2 id="voucher-list-heading" className="text-lg font-semibold mb-4">My vouchers</h2>

      <ErrorDisplay error={error} />

      {txResult && (
        <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          Transaction submitted: <span className="font-mono">{txResult}</span>
        </div>
      )}

      {actionPreview && (
        <div className="mb-6 space-y-3">
          <ContractCallPreviewPanel
            preview={actionPreview.preview}
            contractId={contractId}
          />
          {actionPreview.action === 'cancel' && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2">
              Cancellation requires the school to co-sign. Your request will be sent to the school for approval.
            </p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setActionPreview(null)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 focus-visible:ring-2 focus:outline-none"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmAction}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 focus-visible:ring-2 focus:outline-none"
            >
              Sign with wallet
            </button>
          </div>
        </div>
      )}

      {vouchers.length === 0 ? (
        <p className="text-sm text-gray-500">No vouchers found.</p>
      ) : (
        <ul className="space-y-4" aria-label="Voucher list">
          {vouchers.map((v) => (
            <li key={v.voucher_id}>
              <VoucherCard
                v={v}
                onReclaim={handleReclaim}
                onCancelRequest={handleCancelRequest}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
