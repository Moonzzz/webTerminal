'use client';

import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState } from 'react';

const CUSTOM_NODE_STORAGE_KEY = 'webTerminal-custom-node';
const NODE_MEMORY_STORAGE_KEY = 'webTerminal-node-memory';

export default function HomePage() {
  const router = useRouter();
  const [customHost, setCustomHost] = useState('');
  const [customPort, setCustomPort] = useState('22');
  const [customUsername, setCustomUsername] = useState('');
  const [customError, setCustomError] = useState('');

  const rememberHost = (host: string) => {
    const remembered = readNodeMemory(host);
    if (!remembered) return;

    if (remembered.port) {
      setCustomPort(String(remembered.port));
    }
    if (remembered.username) {
      setCustomUsername(remembered.username);
    }
  };

  const connectCustomNode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const host = customHost.trim();
    const username = customUsername.trim();
    const port = Number(customPort);

    if (!host || /[\s/\\]/.test(host)) {
      setCustomError('请输入有效的 IP 或域名');
      return;
    }

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setCustomError('端口必须是 1 到 65535 之间的整数');
      return;
    }

    if (!username) {
      setCustomError('请输入用户名');
      return;
    }

    saveNodeMemory(host, { port, username });
    window.sessionStorage.setItem(
      CUSTOM_NODE_STORAGE_KEY,
      JSON.stringify({
        name: `${username}@${host}:${port}`,
        host,
        port,
        username,
      })
    );
    setCustomError('');
    router.push('/terminal/custom');
  };

  return (
    <main className="page">
      <header className="page-header">
        <div>
          <h1>webTerminal</h1>
          <p>输入节点地址并在浏览器中打开 SSH 终端；是否允许连接由后端校验。</p>
        </div>
      </header>

      <section className="custom-connect">
        <div className="section-title">自定义连接</div>
        <form className="custom-form" onSubmit={connectCustomNode}>
          <label>
            <span>IP / 域名</span>
            <input
              value={customHost}
              onChange={(event) => {
                setCustomHost(event.target.value);
                setCustomError('');
              }}
              onBlur={(event) => rememberHost(event.target.value.trim())}
              placeholder="192.168.1.10"
              autoComplete="off"
            />
          </label>
          <label>
            <span>端口</span>
            <input
              value={customPort}
              onChange={(event) => setCustomPort(event.target.value)}
              inputMode="numeric"
              placeholder="22"
            />
          </label>
          <label>
            <span>用户名</span>
            <input
              value={customUsername}
              onChange={(event) => setCustomUsername(event.target.value)}
              placeholder="root"
              autoComplete="username"
            />
          </label>
          <button type="submit">打开 SSH</button>
        </form>
        {customError ? <div className="form-error">{customError}</div> : null}
      </section>
    </main>
  );
}

function readNodeMemory(host: string) {
  if (!host) return undefined;

  try {
    const raw = window.localStorage.getItem(NODE_MEMORY_STORAGE_KEY);
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as Record<string, { port?: unknown; username?: unknown }>;
    const memory = parsed[host];
    if (!memory) return undefined;

    const port = typeof memory.port === 'number' ? memory.port : Number(memory.port);
    const username = typeof memory.username === 'string' ? memory.username : '';

    return {
      port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined,
      username,
    };
  } catch {
    return undefined;
  }
}

function saveNodeMemory(host: string, value: { port: number; username: string }) {
  try {
    const raw = window.localStorage.getItem(NODE_MEMORY_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

    parsed[host] = value;
    window.localStorage.setItem(NODE_MEMORY_STORAGE_KEY, JSON.stringify(parsed));
  } catch {}
}
