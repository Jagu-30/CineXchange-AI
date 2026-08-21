import './globals.css';
import type { Metadata } from 'next';
import Providers from './providers';

export const metadata: Metadata = {
  title: 'CineXchange AI — Production Procurement Control',
  description:
    'Multi-agent procurement command center for film production crews. Source, negotiate, approve, and recover — autonomously.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased bg-[#080a0e] text-[#e8eaed] min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
