export function TerminalCopyOverlay({
  text,
  onClose,
}: {
  text: string;
  onClose: () => void;
}) {
  return (
    <div className="terminal-copy-overlay" role="dialog" aria-label="选择 terminal 文本">
      <div className="terminal-copy-header">
        <div className="terminal-copy-title">选择文本</div>
        <button type="button" className="terminal-toolbar-button" onClick={onClose}>
          关闭
        </button>
      </div>
      <pre className="terminal-copy-text" tabIndex={0}>
        {text || '暂无可复制内容'}
      </pre>
    </div>
  );
}
