'use client';
import React, { useState } from 'react';
import { CreateVoucherForm } from '@/components/funder/CreateVoucherForm';
import { FunderVoucherList } from '@/components/funder/FunderVoucherList';

type Tab = 'create' | 'vouchers';

export default function FunderPage() {
  const [tab, setTab] = useState<Tab>('vouchers');

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Funder dashboard</h1>

      <div role="tablist" aria-label="Funder sections" className="flex gap-2 mb-6 border-b border-gray-200">
        {(['vouchers', 'create'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px focus-visible:ring-2 focus:outline-none ${
              tab === t
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'create' ? 'New voucher' : 'My vouchers'}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-live="polite">
        {tab === 'create' ? <CreateVoucherForm /> : <FunderVoucherList />}
      </div>
    </div>
  );
}
