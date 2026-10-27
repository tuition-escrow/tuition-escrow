/**
 * AmountDisplay — formats a stablecoin amount for display.
 *
 * README section: "Shared components: amount display"
 *
 * Amount is stored as an integer (smallest unit).  We divide by the
 * asset's decimals (USDC = 7 decimals on Stellar) and format with
 * locale-aware number formatting.
 *
 * Accessibility: uses <span> with descriptive aria-label.
 */

import React from 'react';

interface AmountDisplayProps {
  /** Raw amount as a bigint or string (smallest unit) */
  amount: bigint | string;
  /** Asset symbol, e.g. 'USDC' */
  symbol?: string;
  /** Decimal places for the asset. USDC on Stellar = 7. */
  decimals?: number;
  className?: string;
}

export function AmountDisplay({
  amount,
  symbol = 'USDC',
  decimals = 7,
  className = '',
}: AmountDisplayProps) {
  const raw = typeof amount === 'bigint' ? amount : BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;

  // Format to at most 2 decimal places for display
  const fractionStr = fraction.toString().padStart(decimals, '0').slice(0, 2);
  const formatted = `${whole.toLocaleString()}.${fractionStr}`;

  return (
    <span
      aria-label={`${formatted} ${symbol}`}
      className={`font-mono tabular-nums ${className}`}
    >
      {formatted} <span className="text-gray-500">{symbol}</span>
    </span>
  );
}
