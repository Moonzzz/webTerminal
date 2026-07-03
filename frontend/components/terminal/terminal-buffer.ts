import type { Terminal as XTermTerminal } from '@xterm/xterm';

export function readTerminalBufferText(term: XTermTerminal) {
  const buffer = term.buffer.active;
  const startLine = buffer.type === 'alternate' ? buffer.viewportY : 0;
  const endLine =
    buffer.type === 'alternate'
      ? Math.min(buffer.length, buffer.viewportY + term.rows)
      : buffer.length;
  const lines: string[] = [];

  for (let y = startLine; y < endLine; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;

    const text = line.translateToString(true);
    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(text);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
