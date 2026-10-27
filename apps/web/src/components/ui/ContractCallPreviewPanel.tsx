/**
 * ContractCallPreviewPanel — shows the exact contract call before signing.
 *
 * README section: "Design principles"
 *   "Show the exact contract call (function and parameters) before the
 *    wallet prompts for signature."
 *
 * Accessibility: labelled form region; parameters in a definition list.
 */

import React from 'react';
import type { ContractCallPreview } from '@/providers/WalletProvider';

interface ContractCallPreviewPanelProps {
  preview: ContractCallPreview;
  contractId: string;
}

export function ContractCallPreviewPanel({ preview, contractId }: ContractCallPreviewPanelProps) {
  return (
    <section
      aria-labelledby="contract-call-heading"
      className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm"
    >
      <h3 id="contract-call-heading" className="font-semibold text-blue-900 mb-2">
        Contract call to be signed
      </h3>
      <p className="text-xs text-blue-600 font-mono mb-2 break-all">
        Contract: {contractId}
      </p>
      <p className="font-mono text-blue-800 font-semibold mb-2">
        {preview.functionName}(
      </p>
      <dl className="ml-4 space-y-1">
        {preview.parameters.map((p) => (
          <div key={p.name} className="flex gap-2">
            <dt className="font-mono text-blue-700 min-w-[8rem]">{p.name}:</dt>
            <dd className="font-mono text-blue-900 break-all">{p.value}</dd>
          </div>
        ))}
      </dl>
      <p className="font-mono text-blue-800 font-semibold mt-1">)</p>
    </section>
  );
}
