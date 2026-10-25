import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Terminal } from '@xterm/headless';
import { TerminalRestoreController } from '../frontend/components/terminal/terminal-restore-controller';
import type { ClientMessage, ServerMessage } from '../shared/terminal-protocol';

const restoreId = '00000000-0000-0000-0000-000000000001';
const snapshot: Extract<ServerMessage, { type: 'restore' }> = {
  type: 'restore', restoreId, data: '', sequence: 5, cols: 40, rows: 5, scrollback: 10,
};

function fixture() {
  const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
  const sent: ClientMessage[] = [];
  const input: string[] = [];
  const controller = new TerminalRestoreController({
    terminal, send: async (message) => { sent.push(message); },
    onInput: (data) => input.push(data), proposeDimensions: () => ({ cols: 60, rows: 8 }),
    onPhaseChange: () => {},
  });
  const listener = terminal.onData((data) => controller.onTerminalData(data));
  return { terminal, sent, input, controller, dispose: () => {
    controller.close(); listener.dispose(); terminal.dispose();
  } };
}

test('快照解析抑制回复和副作用，实时查询在恢复确认前仍能回复', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  let effects = 0;
  f.terminal.parser.registerOscHandler(52, () => {
    if (f.controller.acceptsSideEffects) effects++;
    return true;
  });
  await f.controller.handle({ ...snapshot, data: '\x1b[5n\x1b]52;c;aA==\x07' });
  assert.deepEqual(f.sent, [{ type: 'restore-ready', restoreId, cols: 60, rows: 8 }]);
  assert.equal(effects, 0);
  assert.equal(f.controller.interactive, false);
  f.controller.onTerminalData('user input');
  await f.controller.handle({ type: 'output', data: '\x1b[5n\x1b]52;c;aA==\x07', sequence: 6 });
  assert.deepEqual(f.sent[1], { type: 'terminal-reply', restoreId, data: '\x1b[0n' });
  assert.equal(effects, 1);
  assert.deepEqual(f.input, []);
  await f.controller.handle({ type: 'restored', restoreId, cols: 60, rows: 8 });
  f.controller.onTerminalData('user input');
  assert.deepEqual(f.input, ['user input']);
});

test('增量在旧尺寸解析，确认屏障后才切换尺寸并开放输入', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  await f.controller.handle(snapshot);
  await f.controller.handle({ type: 'output', data: 'old dimensions', sequence: 6 });
  assert.deepEqual([f.terminal.cols, f.terminal.rows], [40, 5]);
  await f.controller.handle({ type: 'restored', restoreId, cols: 60, rows: 8 });
  assert.deepEqual([f.terminal.cols, f.terminal.rows], [60, 8]);
  assert.equal(f.controller.interactive, true);
  await f.controller.handle({ type: 'output', data: '\r\nnew dimensions', sequence: 7 });
});

test('输出缺号、重复快照和错误确认均拒绝继续恢复', async (t) => {
  const f = fixture();
  t.after(f.dispose);
  await assert.rejects(f.controller.handle({ type: 'output', data: 'early', sequence: 1 }), /sequence/);
  await f.controller.handle(snapshot);
  await assert.rejects(f.controller.handle(snapshot), /snapshot/);
  await assert.rejects(f.controller.handle({ type: 'restored', restoreId: 'stale', cols: 60, rows: 8 }), /acknowledgement/);
  await assert.rejects(f.controller.handle({ type: 'output', data: 'gap', sequence: 7 }), /sequence/);
});

test('恢复中关闭可以结束未完成写入且不会发送恢复确认', async () => {
  const terminal = new Terminal({ cols: 40, rows: 5 });
  const sent: ClientMessage[] = [];
  const controller = new TerminalRestoreController({
    terminal: { reset: () => {}, resize: () => {}, options: terminal.options, write: () => {} },
    send: async (message) => { sent.push(message); }, onInput: () => {},
    proposeDimensions: () => undefined, onPhaseChange: () => {},
  });
  try {
    const pending = controller.handle(snapshot);
    controller.close();
    await pending;
    assert.deepEqual(sent, []);
    assert.equal(controller.hasSnapshot, false);
    assert.equal(controller.interactive, false);
  } finally { controller.close(); terminal.dispose(); }
});
