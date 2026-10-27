/**
 * CreateVoucherForm — funder creates a voucher.
 *
 * README section: "How it works — Funder"
 *   - Choose active school, fee category (only the five categories),
 *     amount, expiry.
 *   - Student identifier sent only to API's prepare endpoint over TLS,
 *     never stored client-side after submission.
 *   - Show a clear summary before signing (ContractCallPreviewPanel).
 *   - Fee-bumped flow (no XLM required).
 *
 * Privacy invariants:
 *   - studentIdentifier is cleared from component state immediately after
 *     the prepare API call returns.
 *   - No free-text memo field.
 *   - Only the five README fee categories are offered.
 */

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useWallet } from '@/providers/WalletProvider';
import { listSchools, prepareVoucher, type School } from '@/lib/api';
import { CATEGORY_OPTIONS } from '@/lib/categories';
import { ContractCallPreviewPanel } from '@/components/ui/ContractCallPreviewPanel';
import { ErrorDisplay } from '@/components/ui/ErrorDisplay';
import { AmountDisplay } from '@/components/ui/AmountDisplay';
import type { ContractCallPreview } from '@/providers/WalletProvider';

type Step = 'form' | 'preview' | 'signing' | 'done';

export function CreateVoucherForm() {
  const { token } = useAuth();
  const { wallet, signAndSubmit } = useWallet();

  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [category, setCategory] = useState<number>(0);
  const [amount, setAmount] = useState('');
  const [expiryDays, setExpiryDays] = useState('30');
  // studentIdentifier is NOT stored in any persistent state; it is cleared
  // immediately after the prepare call.
  const studentIdentifierRef = useRef('');
  const [step, setStep] = useState<Step>('form');
  const [preview, setPreview] = useState<ContractCallPreview | null>(null);
  const [prepareResp, setPrepareResp] = useState<{
    studentRef: string; mappingId: string;
    fundParams: { school: string; token: string; amount: number; category: number; studentRef: string; expiresAt: number };
  } | null>(null);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID ?? '';
  const assetContractId = process.env.NEXT_PUBLIC_ASSET_CONTRACT_ID ?? '';

  useEffect(() => {
    listSchools().then(setSchools).catch(() => setError('Failed to load schools'));
  }, []);

  const selectedSchool = schools.find((s) => s.id === schoolId);

  const handlePrepare = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) { setError('Not authenticated'); return; }
    if (!selectedSchool) { setError('Please select a school'); return; }
    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum <= 0) { setError('Invalid amount'); return; }
    const expiresAt = Math.floor(Date.now() / 1000) + parseInt(expiryDays, 10) * 86400;

    setLoading(true);
    try {
      // studentIdentifier is sent to the API over TLS and cleared immediately.
      const resp = await prepareVoucher(token, {
        schoolAddress: selectedSchool.stellar_address,
        tokenAddress: assetContractId,
        amount: amountNum,
        category,
        studentIdentifier: studentIdentifierRef.current,
        expiresAt,
      });
      // Clear the identifier from the ref immediately — never store after this point.
      studentIdentifierRef.current = '';

      setPrepareResp(resp);

      // Build the preview to show before signing
      const categoryLabel = CATEGORY_OPTIONS.find((o) => o.value === category)?.label ?? `${category}`;
      setPreview({
        functionName: 'fund',
        parameters: [
          { name: 'school', value: resp.fundParams.school },
          { name: 'token', value: resp.fundParams.token },
          { name: 'amount', value: resp.fundParams.amount.toString() },
          { name: 'category', value: `${category} (${categoryLabel})` },
          { name: 'student_ref', value: resp.studentRef },
          { name: 'expires_at', value: new Date(expiresAt * 1000).toISOString() },
        ],
      });
      setStep('preview');
    } catch (err) {
      studentIdentifierRef.current = '';
      setError(err instanceof Error ? err.message : 'Preparation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    if (!preview || !prepareResp) return;
    setError(null);
    setStep('signing');
    try {
      // The sponsorship service builds the fee-bumped XDR on the API side.
      // Here we use a placeholder XDR; in production, fetch the fee-bumped XDR
      // from POST /vouchers/build-tx (deferred — see sponsorship.ts TODO).
      const placeholderXdr = `fund:${JSON.stringify(prepareResp.fundParams)}`;
      const hash = await signAndSubmit(placeholderXdr, preview);
      setTxHash(hash);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signing failed');
      setStep('preview');
    }
  };

  if (step === 'done') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 text-center">
        <h2 className="text-xl font-semibold text-green-800 mb-2">Voucher created!</h2>
        <p className="text-sm text-green-700 mb-1">Transaction submitted successfully.</p>
        <p className="font-mono text-xs text-green-600 break-all">Tx: {txHash}</p>
        <button
          onClick={() => { setStep('form'); setPrepareResp(null); setPreview(null); setAmount(''); setSchoolId(''); }}
          className="mt-4 rounded-md bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 focus-visible:ring-2 focus:outline-none"
        >
          Create another
        </button>
      </div>
    );
  }

  if (step === 'preview' && preview) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Review before signing</h2>
        <ContractCallPreviewPanel preview={preview} contractId={contractId} />
        <p className="text-sm text-gray-600">
          Your wallet will be prompted to sign this transaction. No XLM is required — fees are sponsored.
        </p>
        <ErrorDisplay error={error} />
        <div className="flex gap-3">
          <button
            onClick={() => setStep('form')}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 focus-visible:ring-2 focus:outline-none"
          >
            Back
          </button>
          <button
            onClick={handleSign}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 focus-visible:ring-2 focus:outline-none"
          >
            Sign with wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handlePrepare} className="space-y-5" aria-label="Create voucher">
      <h2 className="text-lg font-semibold">Create a voucher</h2>

      {/* School */}
      <div>
        <label htmlFor="school" className="block text-sm font-medium text-gray-700 mb-1">
          School <span aria-hidden="true">*</span>
        </label>
        <select
          id="school"
          required
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none"
          aria-required="true"
        >
          <option value="">Select a school…</option>
          {schools.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* Fee category — only the five README categories */}
      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
          Fee category <span aria-hidden="true">*</span>
        </label>
        <select
          id="category"
          required
          value={category}
          onChange={(e) => setCategory(parseInt(e.target.value, 10))}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Amount */}
      <div>
        <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
          Amount (USDC, in stroops) <span aria-hidden="true">*</span>
        </label>
        <input
          id="amount"
          type="number"
          required
          min="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="e.g. 4000000000 (400 USDC)"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none"
          aria-describedby="amount-hint"
        />
        <p id="amount-hint" className="mt-1 text-xs text-gray-500">
          USDC on Stellar uses 7 decimal places. 400 USDC = 4,000,000,000 stroops.
        </p>
        {amount && !isNaN(parseInt(amount, 10)) && (
          <p className="mt-1 text-xs text-blue-600">
            ≈ <AmountDisplay amount={BigInt(amount)} />
          </p>
        )}
      </div>

      {/* Expiry */}
      <div>
        <label htmlFor="expiry" className="block text-sm font-medium text-gray-700 mb-1">
          Expiry (days from now) <span aria-hidden="true">*</span>
        </label>
        <input
          id="expiry"
          type="number"
          required
          min="1"
          max="365"
          value={expiryDays}
          onChange={(e) => setExpiryDays(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Student identifier — cleared immediately after submit */}
      <div>
        <label htmlFor="studentId" className="block text-sm font-medium text-gray-700 mb-1">
          Student reference <span aria-hidden="true">*</span>
        </label>
        <input
          id="studentId"
          type="text"
          required
          defaultValue=""
          onChange={(e) => { studentIdentifierRef.current = e.target.value; }}
          placeholder="School-assigned student ID or reference"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus:outline-none"
          aria-describedby="studentId-hint"
          autoComplete="off"
        />
        <p id="studentId-hint" className="mt-1 text-xs text-gray-500">
          This is sent directly to the API over an encrypted connection and
          is never stored in your browser. Only a one-way hash goes on-chain.
        </p>
      </div>

      <ErrorDisplay error={error} />

      {!wallet.connected && (
        <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2">
          Connect your wallet before submitting.
        </p>
      )}

      <button
        type="submit"
        disabled={loading || !wallet.connected}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus-visible:ring-2 focus:outline-none"
        aria-busy={loading}
      >
        {loading ? 'Preparing…' : 'Review and sign'}
      </button>
    </form>
  );
}
