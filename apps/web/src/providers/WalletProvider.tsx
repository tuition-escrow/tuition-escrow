/**
 * WalletProvider — abstraction over Stellar Wallets Kit.
 *
 * README sections: "Tech stack", "Design principles"
 *   "Stellar Wallets Kit integration (Freighter, LOBSTR, xBull) behind a
 *    WalletProvider abstraction. Show the exact contract call (function and
 *    parameters) before the wallet prompts for signature."
 *
 * All wallet operations go through this interface.  Components never import
 * wallet SDK directly — they use the context from useWallet().
 *
 * NOTE: @creit.tech/stellar-wallets-kit API details should be verified
 * against their docs before wiring up a real wallet call.
 * Reference: https://stellarwalletskit.dev
 */

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────

export type WalletId = 'freighter' | 'lobstr' | 'xbull';

export interface WalletState {
  connected: boolean;
  address: string | null;
  walletId: WalletId | null;
}

export interface ContractCallPreview {
  /** Contract function name, e.g. 'fund' */
  functionName: string;
  /** Human-readable parameter list shown before signing */
  parameters: Array<{ name: string; value: string }>;
}

export interface WalletContextValue {
  wallet: WalletState;
  connect(walletId: WalletId): Promise<void>;
  disconnect(): void;
  /**
   * Sign and submit a transaction.
   * Shows preview to the user before calling the wallet's sign method.
   * Returns the submitted transaction hash.
   */
  signAndSubmit(txXdr: string, preview: ContractCallPreview): Promise<string>;
}

// ─── Context ──────────────────────────────────────────────────────────────

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>');
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    address: null,
    walletId: null,
  });

  const connect = useCallback(async (walletId: WalletId) => {
    // TODO: initialise @creit.tech/stellar-wallets-kit and connect to
    // the selected wallet.  The StellarWalletsKit constructor requires
    // the network and selected wallet to be set.
    //
    // Example (pseudocode):
    //   const kit = new StellarWalletsKit({ network: WalletNetwork.TESTNET, selectedWallet: walletId });
    //   await kit.openModal({ onWalletSelected: async (wallet) => {
    //     const { address } = await kit.getAddress();
    //     setWallet({ connected: true, address, walletId });
    //   }});
    //
    // Reference: https://stellarwalletskit.dev/guides/getting-started
    console.warn('WalletProvider.connect: stub — implement with stellar-wallets-kit');
    setWallet({ connected: true, address: 'GDEMO_ADDRESS_STUB', walletId });
  }, []);

  const disconnect = useCallback(() => {
    setWallet({ connected: false, address: null, walletId: null });
  }, []);

  const signAndSubmit = useCallback(
    async (txXdr: string, _preview: ContractCallPreview): Promise<string> => {
      if (!wallet.connected) throw new Error('Wallet not connected');
      // TODO: implement with stellar-wallets-kit:
      //   1. Show the preview (done by the calling component before this call).
      //   2. Call kit.signTx({ xdr: txXdr }).
      //   3. Submit the signed XDR via the API's fee-bump endpoint.
      //   4. Return the transaction hash.
      console.warn('WalletProvider.signAndSubmit: stub');
      return `stub_tx_${Date.now()}`;
    },
    [wallet.connected],
  );

  return (
    <WalletContext.Provider value={{ wallet, connect, disconnect, signAndSubmit }}>
      {children}
    </WalletContext.Provider>
  );
}
