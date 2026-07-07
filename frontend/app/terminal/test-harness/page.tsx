import { notFound } from 'next/navigation';
import { TerminalTestHarness } from '@/components/terminal/test-harness/TerminalTestHarness';

export const dynamic = 'force-dynamic';

export default function TerminalTestHarnessPage() {
  if (process.env.WEBTERMINAL_E2E !== '1') {
    notFound();
  }

  return (
    <main className="terminal-page" data-testid="terminal-test-page">
      <div className="terminal-shell">
        <TerminalTestHarness />
      </div>
    </main>
  );
}
