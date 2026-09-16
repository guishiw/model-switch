import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'LLM Relay Gateway', description: 'Unified LLM API relay & management platform' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
