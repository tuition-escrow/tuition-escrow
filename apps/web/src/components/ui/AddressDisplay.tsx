/**
 * AddressDisplay — shows a truncated Stellar address with a copy button.
 *
 * README section: "Shared components: address display (truncated with copy)"
 *
 * Accessibility: copy button has a clear aria-label; truncation is
 * communicated via the full address in a title attribute and tooltip.
 */

'use client';

import React, { useState, useCallback } from 'react';

interface AddressDisplayProps {
  address: string;
  /** How many characters to show at start and end. Default 6. */
  chars?: number;
  className?: string;
}

export function AddressDisplay({ address, chars = 6, className = '' }: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);

  const truncated =
    address.length > chars * 2 + 3
      ? `${address.slice(0, chars)}…${address.slice(-chars)}`
      : address;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available (e.g., HTTP in some browsers) — ignore
    }
  }, [address]);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span
        className="font-mono text-sm"
        title={address}
        aria-label={`Stellar address: ${address}`}
      >
        {truncated}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Address copied' : 'Copy address to clipboard'}
        className="rounded p-0.5 text-gray-400 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {copied ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
          </svg>
        )}
      </button>
    </span>
  );
}
