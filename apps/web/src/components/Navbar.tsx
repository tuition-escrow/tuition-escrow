"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/providers/AuthProvider";
import { useWallet } from "@/providers/WalletProvider";
import { AddressDisplay } from "@/components/ui/AddressDisplay";

export function Navbar() {
  const { user, loginWithRole, logout } = useAuth();
  const { wallet, connect, disconnect } = useWallet();

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-lg font-bold text-blue-600 hover:text-blue-700"
          >
            Tuition Escrow
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <Link
              href="/funder"
              className="text-gray-600 hover:text-gray-900 focus-visible:underline"
            >
              Funder
            </Link>
            <Link
              href="/school"
              className="text-gray-600 hover:text-gray-900 focus-visible:underline"
            >
              School
            </Link>
            <Link
              href="/attester"
              className="text-gray-600 hover:text-gray-900 focus-visible:underline"
            >
              Attester
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Role:</span>
            <select
              value={user?.role ?? ""}
              onChange={(e) => {
                const role = e.target.value as
                  "funder" | "school_admin" | "attester";
                if (role) {
                  loginWithRole(role, wallet.address ?? undefined).catch(
                    console.error,
                  );
                } else {
                  logout();
                }
              }}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700"
              aria-label="Active role selector"
            >
              <option value="">(None)</option>
              <option value="funder">Funder</option>
              <option value="school_admin">School Admin</option>
              <option value="attester">Attester</option>
            </select>
          </div>

          {wallet.connected && wallet.address ? (
            <div className="flex items-center gap-2">
              <AddressDisplay address={wallet.address} />
              <button
                onClick={disconnect}
                className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => connect("freighter")}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
