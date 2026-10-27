import type { Metadata } from 'next';
import { WalletProvider } from '@/providers/WalletProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tuition Escrow',
  description: 'Purpose-bound school-fee payments on Stellar',
  manifest: '/manifest.json',
  themeColor: '#1a56db',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <AuthProvider>
          <WalletProvider>
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 rounded bg-white px-3 py-1 text-sm font-medium shadow z-50"
            >
              Skip to main content
            </a>
            <main id="main-content">{children}</main>
          </WalletProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
