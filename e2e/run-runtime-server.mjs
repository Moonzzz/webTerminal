import { spawn } from 'node:child_process';
import process from 'node:process';

const e2ePort = process.env.WEBTERMINAL_E2E_PORT || '3200';
const sshHost = process.env.WEBTERMINAL_E2E_SSH_HOST || '127.0.0.1';
const sshPort = process.env.WEBTERMINAL_E2E_SSH_PORT || '2022';
const fixturePort = process.env.WEBTERMINAL_E2E_FIXTURE_PORT || '3201';

const children = [];

try {
  await run('npm', ['run', 'build:frontend']);
  await run('npm', ['run', 'build:backend']);

  const fixture = start('node', ['e2e/ssh-fixture.mjs'], {
    WEBTERMINAL_E2E_SSH_HOST: sshHost,
    WEBTERMINAL_E2E_SSH_PORT: sshPort,
    WEBTERMINAL_E2E_FIXTURE_PORT: fixturePort,
  });
  await waitForReady(fixture, 'E2E fixture API ready');

  const app = start('node', ['dist/backend/server.js'], {
    NODE_ENV: 'production',
    WEBTERMINAL_HOSTNAME: '127.0.0.1',
    PORT: e2ePort,
    WEBTERMINAL_ALLOWED_TARGETS: `${sshHost}:${sshPort}`,
    WEBTERMINAL_SECURE_COOKIE: 'false',
  });
  await waitForReady(app, '> Ready on');
} catch (error) {
  console.error(error);
  shutdown(1);
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}`));
    });
  });
}

function start(command, args, env) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...env,
    },
  });
  children.push(child);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  child.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`${command} ${args.join(' ')} exited with ${code}`);
    } else if (signal) {
      console.error(`${command} ${args.join(' ')} exited by ${signal}`);
    }
  });
  return child;
}

function waitForReady(child, marker) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for: ${marker}`));
    }, 120_000);

    const onData = (chunk) => {
      process.stdout.write(chunk);
      if (chunk.includes(marker)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Process exited before ready: ${code ?? signal}`));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
    };

    child.stdout.on('data', onData);
    child.on('exit', onExit);
  });
}

function shutdown(code) {
  for (const child of children.toReversed()) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  process.exit(code);
}
