import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { TrpcProvider } from '@/app/trpc-provider';
import { ThemeProvider, themeBootScript } from '@/components/theme';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Legal Team OS',
  description: "Legal Builder's legal workflow platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
            rel="stylesheet"
          />
        </head>
        <body className="min-h-screen bg-ink-50 dark:bg-ink-950 text-ink-900 dark:text-ink-100 antialiased transition-colors">
          <ThemeProvider>
            <TrpcProvider>{children}</TrpcProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
