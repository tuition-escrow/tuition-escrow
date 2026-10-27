'use client';
import React from 'react';
import { SchoolDashboard } from '@/components/school/SchoolDashboard';

export default function SchoolPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">School dashboard</h1>
      <SchoolDashboard />
    </div>
  );
}
