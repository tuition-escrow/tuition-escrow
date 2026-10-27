/**
 * Web component tests.
 * README section: "Testing strategy" — component tests and Playwright smoke tests.
 * Task requirement: "Add component tests and Playwright smoke tests for each flow."
 *
 * Unit/component tests run with Vitest + Testing Library.
 * Playwright smoke tests are in e2e/ (see e2e/smoke.spec.ts).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBadge } from '../components/ui/StatusBadge';
import { AmountDisplay } from '../components/ui/AmountDisplay';
import { AddressDisplay } from '../components/ui/AddressDisplay';
import { ErrorDisplay } from '../components/ui/ErrorDisplay';
import { VoucherStatus, ErrorCode, createError } from '@tuition-escrow/shared';
import { categoryLabel, CATEGORY_OPTIONS } from '../lib/categories';

// ─── StatusBadge ──────────────────────────────────────────────────────────

describe('StatusBadge', () => {
  it('renders Funded status', () => {
    render(<StatusBadge status={VoucherStatus.Funded} />);
    expect(screen.getByRole('status')).toHaveTextContent('Funded');
  });

  it('renders Released status', () => {
    render(<StatusBadge status={VoucherStatus.Released} />);
    expect(screen.getByRole('status')).toHaveTextContent('Released');
  });

  it('has an accessible aria-label', () => {
    render(<StatusBadge status={VoucherStatus.Reclaimed} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('aria-label');
    expect(badge.getAttribute('aria-label')).toContain('Reclaimed');
  });
});

// ─── AmountDisplay ────────────────────────────────────────────────────────

describe('AmountDisplay', () => {
  it('formats 4000000000 stroops as 400.00 USDC', () => {
    render(<AmountDisplay amount={4000000000n} />);
    // 4000000000 / 10^7 = 400.00
    expect(screen.getByText(/400/)).toBeTruthy();
    expect(screen.getByText('USDC')).toBeTruthy();
  });

  it('accepts a string amount', () => {
    render(<AmountDisplay amount="100000000" />);
    expect(screen.getByText(/10/)).toBeTruthy();
  });

  it('has aria-label with formatted value', () => {
    render(<AmountDisplay amount={4000000000n} />);
    const el = screen.getByLabelText(/USDC/i);
    expect(el).toBeTruthy();
  });
});

// ─── AddressDisplay ───────────────────────────────────────────────────────

describe('AddressDisplay', () => {
  it('truncates a long address', () => {
    const addr = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOP';
    render(<AddressDisplay address={addr} />);
    // The displayed text should be shorter than the full address
    const span = document.querySelector('span.font-mono') as HTMLSpanElement;
    expect(span.textContent!.length).toBeLessThan(addr.length);
  });

  it('shows full address in title attribute', () => {
    const addr = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOP';
    render(<AddressDisplay address={addr} />);
    expect(screen.getByTitle(addr)).toBeTruthy();
  });

  it('copy button has accessible label', () => {
    render(<AddressDisplay address="GABC" />);
    const btn = screen.getByRole('button', { name: /copy/i });
    expect(btn).toBeTruthy();
  });
});

// ─── ErrorDisplay ────────────────────────────────────────────────────────

describe('ErrorDisplay', () => {
  it('renders nothing when error is null', () => {
    const { container } = render(<ErrorDisplay error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a string error', () => {
    render(<ErrorDisplay error="Something went wrong" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('renders an AppError with code', () => {
    const err = createError(ErrorCode.VoucherNotFound);
    render(<ErrorDisplay error={err} />);
    expect(screen.getByRole('alert')).toHaveTextContent('VoucherNotFound');
    expect(screen.getByRole('alert')).toHaveTextContent('Voucher not found');
  });
});

// ─── Categories ──────────────────────────────────────────────────────────

describe('CATEGORY_OPTIONS', () => {
  it('contains exactly five categories', () => {
    expect(CATEGORY_OPTIONS).toHaveLength(5);
  });

  it('contains TUITION, BOARDING, EXAM_FEES, UNIFORM_BOOKS, TRANSPORT', () => {
    const labels = CATEGORY_OPTIONS.map((o) => o.label);
    expect(labels).toContain('Tuition');
    expect(labels).toContain('Boarding');
    expect(labels).toContain('Exam Fees');
    expect(labels).toContain('Uniform & Books');
    expect(labels).toContain('Transport');
  });

  it('categoryLabel returns the correct label for each code', () => {
    expect(categoryLabel(0)).toBe('Tuition');
    expect(categoryLabel(1)).toBe('Boarding');
    expect(categoryLabel(2)).toBe('Exam Fees');
    expect(categoryLabel(3)).toBe('Uniform & Books');
    expect(categoryLabel(4)).toBe('Transport');
  });

  it('categoryLabel returns fallback for unknown code', () => {
    expect(categoryLabel(99)).toBe('Category 99');
  });
});
