import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Server as HttpServer } from 'node:http';
import { describe, test } from 'node:test';
import type { AuthService } from '../backend/lib/auth';
import type { RuntimeConfig } from '../backend/lib/config';
import type { SecureChannelService } from '../backend/lib/secure-channel';
import { setupWebSocketServer } from '../backend/lib/ws-server';

describe('setupWebSocketServer', () => {
  test('does not handle Next.js HMR upgrade requests', () => {
    // Given
    const server = new EventEmitter() as HttpServer;
    const socket = new UpgradeSocketProbe();
    const wss = setupWebSocketServer(
      server,
      {} as AuthService,
      { websocket: { heartbeatIntervalMs: 60_000 } } as RuntimeConfig,
      {} as SecureChannelService
    );

    // When
    server.emit(
      'upgrade',
      { url: '/_next/webpack-hmr' },
      socket,
      Buffer.alloc(0)
    );

    // Then
    assert.equal(socket.written, false);
    assert.equal(socket.ended, false);
    assert.equal(socket.destroyed, false);
    wss.close();
  });
});

class UpgradeSocketProbe extends EventEmitter {
  written = false;
  ended = false;
  destroyed = false;

  write() {
    this.written = true;
    return true;
  }

  end() {
    this.ended = true;
    return this;
  }

  destroy() {
    this.destroyed = true;
    return this;
  }
}
