/**
 * StatusBadge — displays a VoucherStatus with accessible colour coding.
 *
 * README section: "Shared components: status badge"
 *
 * Accessibility: uses role="status" and aria-label for screen readers.
 * Colours convey state but are never the sole indicator (text label included).
 */

import React from 'react';
import { VoucherStatus } from '@tuition-escrow/shared';

interface StatusBadgeProps {
  status: VoucherStatus;
  className?: string;
}

const statusStyles: Record<VoucherStatus, { bg: string; text: string; label: string }> = {
  [VoucherStatus.Funded]:    { bg: 'bg-blue-100',   text: 'text-blue-800',   label: 'Funded — awaiting attestation' },
  [VoucherStatus.Released]:  { bg: 'bg-green-100',  text: 'text-green-800',  label: 'Released — payment sent to school' },
  [VoucherStatus.Reclaimed]: { bg: 'bg-amber-100',  text: 'text-amber-800',  label: 'Reclaimed — funds returned to funder' },
  [VoucherStatus.Cancelled]: { bg: 'bg-gray-100',   text: 'text-gray-700',   label: 'Cancelled — mutual cancellation' },
  [VoucherStatus.Disputed]:  { bg: 'bg-red-100',    text: 'text-red-800',    label: 'Disputed — under review' },
  [VoucherStatus.Refunded]:  { bg: 'bg-purple-100', text: 'text-purple-800', label: 'Refunded — dispute outcome' },
};

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const styles = statusStyles[status] ?? { bg: 'bg-gray-100', text: 'text-gray-700', label: status };
  return (
    <span
      role="status"
      aria-label={styles.label}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.bg} ${styles.text} ${className}`}
    >
      {status}
    </span>
  );
}
