import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ManagedTerminalSession, type TerminalPeer } from '../backend/lib/terminal-session';
import type { SshConnectorParams } from '../backend/lib/ssh-connector';
import type { ServerMessage } from '../shared/terminal-protocol';

class Peer implements TerminalPeer {
  messages: ServerMessage[] = [];
  closed = false;
  private listeners: Array<(message: ServerMessage) => void> = [];
  send(message: ServerMessage) {
    this.messages.push(message);
    for (const listener of this.listeners) listener(message);
  }
  close() { this.closed = true; }
  isOpen() { return !this.closed; }
  wait<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve) => {
      const match = (message: ServerMessage) => {
        if (message.type === type) resolve(message as Extract<ServerMessage, { type: T }>);
      };
      this.listeners.push(match);
      for (const message of this.messages) match(message);
    });
  }
}

function fixture() {
  const inputs: string[] = [];
  const sizes: number[][] = [];
  let sshClosed = false;
  let removed = 0;
  let connectorParams!: SshConnectorParams;
  const session = new ManagedTerminalSession({
    id: 'session', target: { name: 'fixture', host: 'localhost', port: 22, username: 'test', password: 'test' },
    cols: 40, rows: 5,
    settings: { scrollbackLines: 10, outputBufferBytes: 1024 * 1024, resumeTtlMs: 1000,
      keepaliveIntervalMs: 1000, keepaliveCountMax: 3 },
    onClosed: () => { removed++; },
    createConnector: (params) => {
      connectorParams = params;
      return { connect: () => {}, write: (data) => inputs.push(data),
        resize: (cols, rows) => { sizes.push([cols, rows]); }, close: () => { sshClosed = true; } };
    },
  });
  session.connect();
  return { session, inputs, sizes, get sshClosed() { return sshClosed; },
    get removed() { return removed; }, output: (data: string) => connectorParams.onOutput(data),
    finish: () => connectorParams.onClose() };
}

test('恢复期间仅接受当前连接的协议回复，确认后才开放用户输入', async (t) => {
  const f = fixture();
  t.after(() => f.session.close());
  const peer = new Peer();
  f.session.attach(peer, false);
  const restore = await peer.wait('restore');
  f.session.write(peer, 'blocked');
  f.session.reply(peer, 'stale', 'blocked reply');
  f.session.reply(peer, restore.restoreId, 'query reply');
  assert.deepEqual(f.inputs, ['query reply']);
  f.session.completeRestore(peer, restore.restoreId, 60, 8);
  await peer.wait('restored');
  f.session.write(peer, 'accepted');
  assert.deepEqual(f.inputs, ['query reply', 'accepted']);
});

test('连接接管取消旧尺寸操作并拒绝旧连接输入、回复和确认', async (t) => {
  const f = fixture();
  t.after(() => f.session.close());
  const old = new Peer();
  f.session.attach(old, false);
  const first = await old.wait('restore');
  f.session.completeRestore(old, first.restoreId, 100, 20);
  const current = new Peer();
  f.session.attach(current, true);
  const second = await current.wait('restore');
  assert.equal(old.closed, true);
  assert.deepEqual(f.sizes, []);
  assert.deepEqual([second.cols, second.rows], [40, 5]);
  f.session.completeRestore(current, second.restoreId, 60, 8);
  await current.wait('restored');
  f.session.write(old, 'stale input');
  f.session.reply(old, second.restoreId, 'stale reply');
  f.session.resize(old, 100, 20);
  f.session.completeRestore(old, second.restoreId, 100, 20);
  f.session.detach(old);
  f.session.write(current, 'current input');
  assert.deepEqual(f.inputs, ['current input']);
  assert.deepEqual(f.sizes, [[60, 8]]);
});

test('恢复超时只断开浏览器，原 SSH 会话仍可重新接管', async (t) => {
  const f = fixture();
  t.after(() => f.session.close());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired = new Peer();
  f.session.attach(expired, false);
  t.mock.timers.tick(30_000);
  assert.equal(expired.closed, true);
  assert.equal(f.sshClosed, false);
  assert.equal(f.session.isClosed(), false);
  t.mock.timers.reset();
  const resumed = new Peer();
  f.session.attach(resumed, true);
  const restore = await resumed.wait('restore');
  f.session.completeRestore(resumed, restore.restoreId, 40, 5);
  await resumed.wait('restored');
  f.session.write(resumed, 'resumed');
  assert.deepEqual(f.inputs, ['resumed']);
});

test('断开超过保留期限后释放 SSH 与注册项，重复关闭不会重复释放', (t) => {
  const f = fixture();
  t.after(() => f.session.close());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const peer = new Peer();
  f.session.attach(peer, false);
  f.session.detach(peer);
  t.mock.timers.tick(1000);
  assert.equal(f.sshClosed, true);
  assert.equal(f.session.isClosed(), true);
  f.session.close();
  assert.equal(f.removed, 1);
});

test('SSH 结束前先发布排队的最后输出，再关闭浏览器连接', async (t) => {
  const f = fixture();
  t.after(() => f.session.close());
  const peer = new Peer();
  f.session.attach(peer, false);
  await peer.wait('restore');
  f.output('final output');
  f.finish();
  const output = await peer.wait('output');
  assert.equal(output.data, 'final output');
  // The flush operation follows output parsing in the same terminal queue.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(peer.closed, true);
  assert.equal(f.sshClosed, true);
});
