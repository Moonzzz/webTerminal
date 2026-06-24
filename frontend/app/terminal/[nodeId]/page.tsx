import Link from 'next/link';
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
      <div className="terminal-header">
        <Link href="/" className="back-link">
          Back
        </Link>
        <div>
          <div className="terminal-title">Custom SSH</div>
          <div className="terminal-subtitle">用户输入节点信息，后端校验连接权限</div>
        </div>
      </div>

      <div className="terminal-shell">
        <TerminalClient nodeName="Custom SSH" useStoredTarget />
      </div>
    </main>
  );
}
