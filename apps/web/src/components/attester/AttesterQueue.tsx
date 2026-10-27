/**
 * AttesterQueue — queue of Funded vouchers awaiting verification.
 *
 * README section: "Attester model"
 *   - Queue of Funded vouchers awaiting verification for the attester's school(s).
 *   - Approve/reject interface that calls the attester service.
 *   - Clear indication of threshold progress (e.g. 1 of 2 attestations).
 *   - Display of the audit log for the attester's own decisions.
 *
 * UI shows ONLY: voucher id, category, expiry, status, threshold progress.
 * It NEVER displays student data, funder identity beyond what is needed,
 * or any school records.
 *
 * Privacy: no student identifiers, no school records, no personal data.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { listVouchers, type VoucherRow } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { VoucherStatus } from '@tuition-escrow/shared';
import { categoryLabel } from '@/lib/categories';

const ATTESTER_API = process.env.NEXT_PUBLIC_ATTESTER_URL ?? 'http://localhost:3002';

interface AuditEntry {
  id: number;
  voucherId: string;
  decision: string;
  reason: string;
  timestamp: string;
}

// ─── Attest action ────────────────────────────────────────────────────────

async function callAttest(
  token: string,
  voucherId: string,
  contextToken: string,
): Promise<{ success: boolean; reason: string }> {
  const res = await fetch(`${ATTESTER_API}/attest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ voucherId, contextToken }),
  });
  return res.json() as Promise<{ success: boolean; reason: string }>;
}

async function fetchAuditLog(token: string): Promise<AuditEntry[]> {
  const res = await fetch(`${ATTESTER_API}/audit`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json() as { entries: AuditEntry[] };
  return data.entries;
}

// ─── VoucherQueueItem ─────────────────────────────────────────────────────

function VoucherQueueItem({
  v,
  onApprove,
  onReject,
}: {
  v: VoucherRow;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const expiresIn = Math.max(
    0,
    Math.floor((new Date(v.expires_at).getTime() - Date.now()) / 3_600_000),
  );

  return (
    <article
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3"
      aria-labelledby={`att-voucher-${v.voucher_id}`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <h3 id={`att-voucher-${v.voucher_id}`} className="font-semibold text-sm">
          Voucher #{v.voucher_id}
        </h3>
        <StatusBadge status={v.status as VoucherStatus} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-gray-500">Category</dt>
        <dd>{categoryLabel(v.category)}</dd>

        <dt className="text-gray-500">Expires in</dt>
        <dd className={expiresIn < 24 ? 'text-red-600 font-medium' : ''}>
          {expiresIn}h
        </dd>

        <dt className="text-gray-500">Attestations</dt>
        <dd>
          <span aria-label={`${v.attestation_count ?? 0} attestations so far`}>
            {v.attestation_count ?? 0}
          </span>
        </dd>
      </dl>

      <div className="flex gap-2">
        <button
          onClick={() => onApprove(v.voucher_id)}
          className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 focus-visible:ring-2 focus:outline-none"
          aria-label={`Approve voucher ${v.voucher_id}`}
        >
          Approve
        </button>
        <button
          onClick={() => onReject(v.voucher_id)}
          className="rounded-md border border-red-300 text-red-700 px-3 py-1.5 text-xs font-medium hover:bg-red-50 focus-visible:ring-2 focus:outline-none"
          aria-label={`Reject voucher ${v.voucher_id}`}
        >
          Reject
        </button>
      </div>
    </article>
  );
}

// ─── AttesterQueue ────────────────────────────────────────────────────────

export function AttesterQueue() {
  const { token } = useAuth();
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionModal, setActionModal] = useState<{
    voucherId: string;
    type: 'approve' | 'reject';
  } | null>(null);
  const [contextToken, setContextToken] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      listVouchers(token).then((vs) =>
        setVouchers(vs.filter((v) => v.status === VoucherStatus.Funded)),
      ),
      fetchAuditLog(token).then(setAuditLog),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleApprove = (id: string) => {
    setActionModal({ voucherId: id, type: 'approve' });
    setContextToken('');
    setRejectReason('');
    setFeedback(null);
  };

  const handleReject = (id: string) => {
    setActionModal({ voucherId: id, type: 'reject' });
    setContextToken('');
    setRejectReason('');
    setFeedback(null);
  };

  const handleSubmit = async () => {
    if (!actionModal || !token) return;
    setSubmitting(true);
    try {
      if (actionModal.type === 'approve') {
        const result = await callAttest(token, actionModal.voucherId, contextToken);
        setFeedback(result.success ? '✓ Attestation submitted' : `✗ ${result.reason}`);
      } else {
        // Reject: call attester service admin reject endpoint
        const res = await fetch(
          `${ATTESTER_API}/admin/reviews/${actionModal.voucherId}/reject`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ reason: rejectReason }),
          },
        );
        setFeedback(res.ok ? '✓ Rejection recorded' : '✗ Rejection failed');
      }
      setActionModal(null);
      // Refresh
      const updated = await listVouchers(token);
      setVouchers(updated.filter((v) => v.status === VoucherStatus.Funded));
      const log = await fetchAuditLog(token);
      setAuditLog(log);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="queue-heading">
        <h2 id="queue-heading" className="text-lg font-semibold mb-4">
          Vouchers awaiting attestation
        </h2>

        <ErrorDisplay error={error} />
        {feedback && (
          <div className={`mb-4 rounded-md px-4 py-3 text-sm ${feedback.startsWith('✓') ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {feedback}
          </div>
        )}

        {/* Action modal */}
        {actionModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-modal-title"
            className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3"
          >
            <h3 id="action-modal-title" className="font-semibold text-blue-900">
              {actionModal.type === 'approve'
                ? `Approve voucher #${actionModal.voucherId}`
                : `Reject voucher #${actionModal.voucherId}`}
            </h3>

            {actionModal.type === 'approve' && (
              <div>
                <label
                  htmlFor="context-token"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Verification context token
                </label>
                <input
                  id="context-token"
                  type="text"
                  value={contextToken}
                  onChange={(e) => setContextToken(e.target.value)}
                  placeholder="Token from school records system"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:ring-2 focus:outline-none"
                  aria-describedby="context-hint"
                />
                <p id="context-hint" className="mt-1 text-xs text-gray-500">
                  This token is verified by the attester service. It does not
                  contain student personal data — only an opaque verification reference.
                </p>
              </div>
            )}

            {actionModal.type === 'reject' && (
              <div>
                <label
                  htmlFor="reject-reason"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Reason for rejection
                </label>
                <input
                  id="reject-reason"
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="e.g. Student not enrolled for this term"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:ring-2 focus:outline-none"
                  maxLength={500}
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setActionModal(null)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 focus-visible:ring-2 focus:outline-none"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className={`rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-50 focus-visible:ring-2 focus:outline-none ${
                  actionModal.type === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {submitting ? 'Submitting…' : actionModal.type === 'approve' ? 'Confirm approval' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : vouchers.length === 0 ? (
          <p className="text-sm text-gray-500">No vouchers awaiting attestation.</p>
        ) : (
          <ul className="space-y-4" aria-label="Voucher queue">
            {vouchers.map((v) => (
              <li key={v.voucher_id}>
                <VoucherQueueItem
                  v={v}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Audit log */}
      <section aria-labelledby="audit-heading">
        <h2 id="audit-heading" className="text-lg font-semibold mb-4">
          My audit log
        </h2>
        {auditLog.length === 0 ? (
          <p className="text-sm text-gray-500">No audit entries yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse" aria-label="Audit log">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-600">
                  <th scope="col" className="px-3 py-2 font-medium">Voucher</th>
                  <th scope="col" className="px-3 py-2 font-medium">Decision</th>
                  <th scope="col" className="px-3 py-2 font-medium">Reason</th>
                  <th scope="col" className="px-3 py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLog.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2 font-mono">#{e.voucherId}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          e.decision === 'approved'
                            ? 'bg-green-100 text-green-700'
                            : e.decision === 'rejected'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {e.decision}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{e.reason}</td>
                    <td className="px-3 py-2 text-gray-400 text-xs">
                      {new Date(e.timestamp).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
