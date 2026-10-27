/**
 * ErrorDisplay — renders an AppError using shared error codes and messages.
 *
 * README section: "Shared components: error display using shared error codes"
 *
 * Accessibility: uses role="alert" so screen readers announce it immediately.
 */

import React from 'react';
import type { AppError } from '@tuition-escrow/shared';

interface ErrorDisplayProps {
  error: AppError | string | null | undefined;
  className?: string;
}

export function ErrorDisplay({ error, className = '' }: ErrorDisplayProps) {
  if (!error) return null;

  const message = typeof error === 'string' ? error : error.message;
  const code = typeof error === 'string' ? null : error.code;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800 ${className}`}
    >
      {code && (
        <span className="font-mono text-xs text-red-500 block mb-0.5">{code}</span>
      )}
      <span>{message}</span>
    </div>
  );
}
