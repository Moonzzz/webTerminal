'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { secureLogin } from '@/lib/secure-channel';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await secureLogin(username, password);
      window.location.replace('/');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '登录失败';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div>
          <h1>webTerminal</h1>
          <p>登录后打开 SSH 工作台。</p>
        </div>
        <label>
          <span>用户名</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label>
          <span>密码</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? '登录中...' : '登录'}
        </button>
        {error ? <div className="form-error">{error}</div> : null}
      </form>
    </main>
  );
}
