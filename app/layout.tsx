import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FreshFlow | Intelligent Food Spoilage & Dynamic Markdown Hub',
  description: 'AI-guided dynamic markdown and food bank donation engine mitigating retail grocery waste.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-slate-950 text-slate-50">{children}</body>
    </html>
  );
}
