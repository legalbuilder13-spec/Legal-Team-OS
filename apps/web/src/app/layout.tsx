import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { TrpcProvider } from '@/app/trpc-provider';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Legal Team OS',
  description: "Legal Builder's legal workflow platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-gray-50 text-gray-900">
          <TrpcProvider>{children}</TrpcProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
