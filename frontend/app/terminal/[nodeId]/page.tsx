import { redirect } from 'next/navigation';
import TerminalClient from '@/components/TerminalClient';

export default async function TerminalPage({
  params,
}: {
  params: Promise<{ nodeId: string }>;
}) {
  const { nodeId } = await params;
  if (nodeId !== 'custom') {
    redirect('/');
  }

  return (
    <main className="terminal-page">
      <div className="terminal-shell">
        <TerminalClient nodeName="Custom SSH" useStoredTarget />
      </div>
    </main>
  );
}
