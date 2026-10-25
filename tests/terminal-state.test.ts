import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Terminal } from '@xterm/headless';
import { TerminalState, type TerminalSnapshot } from '../backend/lib/terminal-state';

const ignoreOutput = () => {};

async function snapshot(state: TerminalState) {
  let result!: TerminalSnapshot;
  await state.snapshot((value) => { result = value; });
  return result;
}

async function restore(value: TerminalSnapshot) {
  const terminal = new Terminal({ cols: value.cols, rows: value.rows,
    scrollback: value.scrollback, convertEol: true, allowProposedApi: true });
  await write(terminal, value.data);
  return terminal;
}

function write(terminal: Terminal, data: string) {
  return new Promise<void>((resolve) => terminal.write(data, resolve));
}

function lines(terminal: Terminal) {
  const buffer = terminal.buffer.active;
  return Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i)?.translateToString(true) || '');
}

test('快照直接恢复下载最终进度、颜色和光标，不保留被覆盖的进度', async (t) => {
  const state = new TerminalState(40, 5);
  t.after(() => state.dispose());
  await state.write('开始下载\r\n0%\r\x1b[2K50%\r\x1b[2K\x1b[32m100%', ignoreOutput);
  const value = await snapshot(state);
  const term = await restore(value);
  t.after(() => term.dispose());
  assert.deepEqual(lines(term).slice(0, 2), ['开始下载', '100%']);
  assert.equal(value.data.includes('50%'), false);
  assert.equal(term.buffer.active.cursorX, 4);
  assert.equal(term.buffer.active.cursorY, 1);
  assert.equal(term.buffer.active.getLine(1)?.getCell(0)?.getFgColor(), 2);
});

test('快照一起恢复限定长度的滚动历史', async (t) => {
  const state = new TerminalState(20, 3, 4);
  t.after(() => state.dispose());
  await state.write(Array.from({ length: 12 }, (_, i) => `line-${i}`).join('\r\n'), ignoreOutput);
  const term = await restore(await snapshot(state));
  t.after(() => term.dispose());
  assert.deepEqual(lines(term), Array.from({ length: 7 }, (_, i) => `line-${i + 5}`));
});

test('恢复备用屏幕与粘贴模式，退出后保留主屏幕历史', async (t) => {
  const state = new TerminalState(30, 5);
  t.after(() => state.dispose());
  await state.write('shell history\x1b[?1049h\x1b[Heditor\x1b[?2004h', ignoreOutput);
  const term = await restore(await snapshot(state));
  t.after(() => term.dispose());
  assert.equal(term.buffer.active.type, 'alternate');
  assert.equal(lines(term)[0], 'editor');
  assert.equal(term.modes.bracketedPasteMode, true);
  await write(term, '\x1b[?1049l');
  assert.equal(term.buffer.active.type, 'normal');
  assert.equal(lines(term)[0], 'shell history');
});

test('恢复鼠标跟踪时同时保留 SGR 编码，避免 CLI 收不到滚轮事件', async (t) => {
  const state = new TerminalState(80, 24);
  t.after(() => state.dispose());
  await state.write('\x1b[?1003h\x1b[?1006h', ignoreOutput);
  const term = await restore(await snapshot(state));
  t.after(() => term.dispose());
  const replies: string[] = [];
  term.onData((data) => replies.push(data));
  await write(term, '\x1b[?1006$p');
  assert.equal(term.modes.mouseTrackingMode, 'any');
  assert.deepEqual(replies, ['\x1b[?1006;1$y']);
});

test('像素鼠标编码、编码关闭和终端重置都按当前状态恢复', async (t) => {
  for (const [output, sgr, pixels] of [
    ['\x1b[?1016h', 2, 1],
    ['\x1b[?1006h\x1b[?1006l', 2, 2],
    ['\x1b[?1006h\x1bc', 2, 2],
    ['\x1b[?1006;1016h\x1b[?1006l', 2, 2],
  ] as const) {
    const state = new TerminalState(80, 24);
    t.after(() => state.dispose());
    await state.write(output, ignoreOutput);
    const term = await restore(await snapshot(state));
    t.after(() => term.dispose());
    const replies: string[] = [];
    term.onData((data) => replies.push(data));
    await write(term, '\x1b[?1006$p\x1b[?1016$p');
    assert.deepEqual(replies, [`\x1b[?1006;${sgr}$y`, `\x1b[?1016;${pixels}$y`]);
  }
});

test('快照与并发输出有确定边界，后续增量不重复也不遗漏', async (t) => {
  const state = new TerminalState(30, 5);
  t.after(() => state.dispose());
  let value!: TerminalSnapshot;
  const events: Array<string | number> = [];
  const first = state.write('before', (_, sequence) => events.push(sequence));
  const capture = state.snapshot((result) => { value = result; events.push('snapshot'); });
  const next = state.write('\r\nafter', (_, sequence) => events.push(sequence));
  await Promise.all([first, capture, next]);
  assert.deepEqual(events, [1, 'snapshot', 2]);
  assert.equal(value.sequence, 1);
  const term = await restore(value);
  t.after(() => term.dispose());
  await write(term, '\r\nafter');
  assert.deepEqual(lines(term).slice(0, 2), ['before', 'after']);
});

test('跨数据块的控制序列在快照后完整补发，不产生控制码残留', async (t) => {
  const state = new TerminalState(30, 5);
  t.after(() => state.dispose());
  const outputs: string[] = [];
  await state.write('ready\r\n\x1b[3', (data) => outputs.push(data));
  const term = await restore(await snapshot(state));
  t.after(() => term.dispose());
  assert.deepEqual(outputs, ['ready\r\n']);
  await state.write('2mgreen\x1b[0m', (data) => outputs.push(data));
  await write(term, outputs[1]);
  assert.equal(lines(term)[1], 'green');
  assert.equal(term.buffer.active.getLine(1)?.getCell(0)?.getFgColor(), 2);
});

test('跨块剪贴板指令不会进入历史快照并在恢复时重新触发', async (t) => {
  const state = new TerminalState(30, 5);
  t.after(() => state.dispose());
  await state.write('ready\x1b]52;c;', ignoreOutput);
  assert.equal((await snapshot(state)).data.includes('52;'), false);
  const outputs: string[] = [];
  await state.write('aGVsbG8=\x1b', (data) => outputs.push(data));
  assert.equal(outputs.length, 0);
  await state.write('\\done', (data) => outputs.push(data));
  assert.deepEqual(outputs, ['\x1b]52;c;aGVsbG8=\x1b\\done']);
  assert.equal((await snapshot(state)).data.includes('52;'), false);
});

test('字符串控制指令可被新的转义指令终止，不阻塞后续输出', async (t) => {
  const state = new TerminalState(30, 5);
  t.after(() => state.dispose());
  await state.write('\x1b]0;title\x1b', ignoreOutput);
  assert.equal((await snapshot(state)).sequence, 0);
  await state.write('[32mcontinued', ignoreOutput);
  const term = await restore(await snapshot(state));
  t.after(() => term.dispose());
  assert.equal(lines(term)[0], 'continued');
  assert.equal(term.buffer.active.getLine(0)?.getCell(0)?.getFgColor(), 2);
});

test('尺寸变化按输出顺序处理，快照保存生成时的尺寸', async (t) => {
  const state = new TerminalState(10, 3);
  t.after(() => state.dispose());
  await state.write('中文abcdefghi', ignoreOutput);
  let before!: TerminalSnapshot;
  let after!: TerminalSnapshot;
  const capture = state.snapshot((value) => { before = value; });
  const resize = state.resize(20, 4);
  const captureAfter = state.snapshot((value) => { after = value; });
  await Promise.all([capture, resize, captureAfter]);
  assert.deepEqual([before.cols, before.rows, after.cols, after.rows], [10, 3, 20, 4]);
  const restored = await restore(before);
  const current = await restore(after);
  t.after(() => { restored.dispose(); current.dispose(); });
  restored.resize(20, 4);
  assert.deepEqual(lines(restored), lines(current));
});

test('未完成的超长控制序列和积压输出受到内存上限约束', async (t) => {
  const state = new TerminalState(30, 5, 10, 32);
  t.after(() => state.dispose());
  await state.write('\x1b]' + 'x'.repeat(20), ignoreOutput);
  await assert.rejects(state.write('x'.repeat(20), ignoreOutput), /buffer limit/);
  await assert.rejects(state.snapshot(ignoreOutput), /buffer limit/);
});

test('关闭状态时正在解析和排队的任务可以结束且不再发布输出', async () => {
  const state = new TerminalState(30, 5);
  const events: string[] = [];
  const first = state.write('pending', () => events.push('output'));
  const second = state.snapshot(() => events.push('snapshot'));
  await Promise.resolve();
  state.dispose();
  await Promise.allSettled([first, second]);
  assert.deepEqual(events, []);
});

test('会话结束前排空最终输出，避免退出信息被异步解析丢弃', async () => {
  const state = new TerminalState(30, 5);
  const events: string[] = [];
  const pending = state.write('process exited', (data) => events.push(data));
  const close = state.flush(() => { events.push('closed'); state.dispose(); });
  await Promise.all([pending, close]);
  assert.deepEqual(events, ['process exited', 'closed']);
});

test('连接被替换后取消旧连接排队的尺寸调整', async (t) => {
  const state = new TerminalState(30, 5);
  t.after(() => state.dispose());
  let current = true;
  const pending = state.write('pending', ignoreOutput);
  const resize = state.resize(10, 2, ignoreOutput, () => current);
  current = false;
  await Promise.all([pending, resize]);
  const value = await snapshot(state);
  assert.deepEqual([value.cols, value.rows], [30, 5]);
});
