import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoundedTaskQueue } from '../shared/bounded-task-queue';

test('有界队列严格串行并在排空后释放容量', async () => {
  const queue = new BoundedTaskQueue({ maxPendingBytes: 10, maxPendingMessages: 2 });
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = queue.enqueue(5, async () => { events.push('first'); await gate; });
  const second = queue.enqueue(5, async () => { events.push('second'); });
  await Promise.resolve();
  assert.deepEqual(events, ['first']);
  release();
  await Promise.all([first, second, queue.drain()]);
  await queue.enqueue(10, async () => { events.push('third'); });
  assert.deepEqual(events, ['first', 'second', 'third']);
});

test('字节或消息积压超限会停止队列且不执行已排队的后续操作', async () => {
  for (const [bytes, messages] of [[10, 100], [100, 1]]) {
    const queue = new BoundedTaskQueue({ maxPendingBytes: bytes, maxPendingMessages: messages });
    const events: string[] = [];
    const pending = queue.enqueue(10, async () => { events.push('unexpected'); });
    await assert.rejects(queue.enqueue(1, async () => {}), /backlog/);
    await Promise.all([pending, queue.drain()]);
    assert.deepEqual(events, []);
    await assert.rejects(queue.enqueue(1, async () => {}), /closed/);
  }
});

test('任务失败或取消后不再执行后续任务，运行中的任务仍可正常收尾', async () => {
  const queue = new BoundedTaskQueue({ maxPendingBytes: 10, maxPendingMessages: 3 });
  const events: string[] = [];
  const first = queue.enqueue(1, async () => { throw new Error('parse failed'); });
  const second = queue.enqueue(1, async () => { events.push('unexpected'); });
  await assert.rejects(first, /parse failed/);
  await second;
  assert.deepEqual(events, []);
  queue.stop();
  await assert.rejects(queue.enqueue(1, async () => {}), /closed/);

  const active = new BoundedTaskQueue({ maxPendingBytes: 10, maxPendingMessages: 3 });
  const completed: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const running = active.enqueue(1, async () => { completed.push('running'); await gate; completed.push('finished'); });
  const skipped = active.enqueue(1, async () => { completed.push('unexpected'); });
  await Promise.resolve();
  active.stop();
  release();
  await Promise.all([running, skipped, active.drain()]);
  assert.deepEqual(completed, ['running', 'finished']);
});
