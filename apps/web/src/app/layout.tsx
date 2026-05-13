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
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />
        </head>
        <body className="min-h-screen bg-ink-50 text-ink-900 antialiased">
          <TrpcProvider>{children}</TrpcProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
