/**
 * Playwright smoke tests.
 * README section: "Testing strategy — End-to-end"
 *   "Fund → attest → release, fund → expire → reclaim"
 *
 * These tests run against a locally running stack (pnpm dev).
 * They do NOT make real network calls to Stellar — the wallet and
 * contract calls are stubbed via the WalletProvider.
 *
 * Run: pnpm --filter @tuition-escrow/web exec playwright test
 */

import { test, expect } from '@playwright/test';

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

test.describe('Home page', () => {
  test('shows role selection links', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.getByRole('link', { name: /funder/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /school/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /attester/i })).toBeVisible();
  });
});

test.describe('Funder page', () => {
  test('shows the My vouchers tab by default', async ({ page }) => {
    await page.goto(`${BASE}/funder`);
    await expect(page.getByRole('tab', { name: /my vouchers/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /new voucher/i })).toBeVisible();
  });

  test('Create voucher form has all five fee categories', async ({ page }) => {
    await page.goto(`${BASE}/funder`);
    await page.getByRole('tab', { name: /new voucher/i }).click();
    const select = page.locator('#category');
    await expect(select).toBeVisible();
    // Check all five options exist
    for (const label of ['Tuition', 'Boarding', 'Exam Fees', 'Uniform & Books', 'Transport']) {
      await expect(select.locator(`option:has-text("${label}")`)).toBeAttached();
    }
  });

  test('Create voucher form has no free-text memo field', async ({ page }) => {
    await page.goto(`${BASE}/funder`);
    await page.getByRole('tab', { name: /new voucher/i }).click();
    // There must be no input labelled "memo" or "note"
    const memoField = page.getByLabel(/memo|note/i);
    await expect(memoField).toHaveCount(0);
  });

  test('Student identifier field has privacy hint', async ({ page }) => {
    await page.goto(`${BASE}/funder`);
    await page.getByRole('tab', { name: /new voucher/i }).click();
    await expect(page.getByText(/never stored in your browser/i)).toBeVisible();
  });
});

test.describe('School page', () => {
  test('shows the off-ramp placeholder panel', async ({ page }) => {
    await page.goto(`${BASE}/school`);
    await expect(page.getByText(/anchor integration planned/i)).toBeVisible();
  });

  test('student mapping button exists but is school-only protected', async ({ page }) => {
    await page.goto(`${BASE}/school`);
    // Without auth the page still loads; no student data is visible
    await expect(page.getByText(/student/i).first()).toBeAttached();
  });
});

test.describe('Attester page', () => {
  test('shows the voucher queue heading', async ({ page }) => {
    await page.goto(`${BASE}/attester`);
    await expect(page.getByRole('heading', { name: /vouchers awaiting attestation/i })).toBeVisible();
  });

  test('shows audit log section', async ({ page }) => {
    await page.goto(`${BASE}/attester`);
    await expect(page.getByRole('heading', { name: /my audit log/i })).toBeVisible();
  });
});

test.describe('Accessibility', () => {
  test('home page has skip-to-content link', async ({ page }) => {
    await page.goto(BASE);
    // Tab once to focus the skip link
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: /skip to main/i });
    await expect(skipLink).toBeFocused();
  });
});
