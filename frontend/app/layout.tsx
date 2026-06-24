import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'webTerminal',
  description: 'SSH terminal in browser',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
