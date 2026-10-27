'use client';
import React from 'react';
import { AttesterQueue } from '@/components/attester/AttesterQueue';

export default function AttesterPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Attester dashboard</h1>
      <AttesterQueue />
    </div>
  );
}
