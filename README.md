# webTerminal

Browser-based SSH terminal built with Next.js, WebSocket, `ssh2`, and `@xterm/xterm`.

## Structure

- `frontend/`: Next.js pages and terminal UI.
- `backend/`: HTTP auth/API, WebSocket gateway, SSH sessions, config loading.
- `config/server.json`: backend service config with `${ENV:default}` placeholders.

## Setup

```bash
npm install
```

Requires Node.js 22 or newer.

Edit `config/server.json`. Important environment variables:

```bash
WEBTERMINAL_AUTH_USERNAME=admin
WEBTERMINAL_AUTH_PASSWORD='change-this'
WEBTERMINAL_AUTH_SECRET='random-long-secret'
WEBTERMINAL_ALLOWED_TARGETS='10.0.0.11:22,10.0.0.12:2222'
```

Only server-side whitelisted `host:port` targets are connectable. The allowList
is not returned to the browser. The browser collects host, port, and username
on the home page. The SSH password is entered on the terminal page and is not
stored. There are no preconfigured SSH nodes or server-side private-key nodes.

## Development

```bash
npm run dev
```

The dev script creates `.certs/webterminal-dev-key.pem` and
`.certs/webterminal-dev-cert.pem` when they do not exist, then starts the
server with HTTPS enabled. Open `https://localhost:3000`. The default local login is `admin` /
`webTerminal`; override it with environment variables before exposing the
service.

To access the dev server from another LAN device, open
`https://<lan-ip>:3000`. Browsers require HTTPS before exposing the Web Crypto
APIs used by the secure channel. The generated certificate includes localhost,
the machine hostname, and current LAN IP addresses as SAN entries, but it is
self-signed and must be trusted by the client device to avoid browser warnings.

Use custom development certificate paths when needed:

```bash
WEBTERMINAL_HTTPS_KEY=./localhost-key.pem \
WEBTERMINAL_HTTPS_CERT=./localhost.pem \
npm run dev
```

## Production

```bash
npm run build
npm run start
```

`npm run build` creates the Next.js production build and compiles the backend
to `dist/backend`. `npm run start` runs the compiled backend with
`NODE_ENV=production`.

Use `PORT` and `WEBTERMINAL_HOSTNAME` in the environment to override the
listener.

```bash
PORT=8080 WEBTERMINAL_HOSTNAME=127.0.0.1 npm run start
```

## Docker

Build `webterminal:latest` for `linux/amd64`:

```bash
npm run docker:build -- webterminal:latest
```

Build, verify startup, and export:

```bash
npm run docker:build -- webterminal:latest --phase all
```

`--phase all` checks `/login` and exports
`dist/webterminal-latest-linux-amd64_yyyyMMdd_HHmmss.tar`.
Failed verification skips export. The temporary container is removed on exit.

Run the image:

```bash
docker run --rm -p 3000:3000 \
  -e WEBTERMINAL_AUTH_PASSWORD='change-this' \
  -e WEBTERMINAL_AUTH_SECRET='random-long-secret' \
  -e WEBTERMINAL_ALLOWED_TARGETS='10.0.0.11:22' \
  webterminal:latest
```

The container binds to `0.0.0.0` by default. Set
`WEBTERMINAL_HOSTNAME` only when the container must listen on another internal
address.

## Notes

- SSH targets are user-entered; the backend rejects targets that do not match `WEBTERMINAL_ALLOWED_TARGETS`.
- HTTP pages and `/ws/terminal` require the single-user login cookie.
- Failed login attempts lock the source IP after 5 failures for 30 minutes by default.
- The browser sends keepalive messages and the server also uses WebSocket/SSH keepalive.
- After the browser disconnects or refreshes, the terminal can reconnect to the in-memory SSH session within the resume window and restore the current screen and bounded scrollback using `@xterm/headless` and `@xterm/addon-serialize`, then continue with live output.
- Development uses `node --import tsx` for the TypeScript backend; production runs compiled JavaScript from `dist/backend`.

### Terminal state restoration

Each SSH session maintains a headless xterm with the same terminal parsing options as the browser. Reconnecting loads a VT snapshot at its original dimensions, including scrollback, cursor, styles, modes and the active alternate screen. Output, snapshots and resizing are processed in order; live output carries a separate terminal sequence number. Input is enabled after the browser acknowledges parsing the snapshot and the server confirms the requested dimensions. Connection messages appear outside the terminal buffer.

- `ssh.scrollbackLines`: retained history rows, default `5000` (range `0`–`50000`). History is restored together with the screen.
- `ssh.outputBufferBytes`: maximum queued output and incomplete control sequence bytes, default `4194304` (range `65536`–`67108864`). Exceeding it closes the session with an error.
- Restoration has a 30-second acknowledgement timeout; a timed-out browser is detached and the SSH session remains subject to the normal resume window.

Incomplete VT instructions are held until complete, so snapshots never end inside a control sequence. Historical clipboard commands are not retained in the snapshot. Mouse encoding modes (`1006` SGR and `1016` SGR pixels), omitted by SerializeAddon 0.14, are queried from the headless emulator using DECRQM and appended to the snapshot so mouse-aware CLI applications retain working wheel input. The headless terminal is a passive state mirror and does not send duplicate terminal-query replies to SSH. The SSH process still depends on the running backend and the resume window; snapshots do not preserve a process across backend restarts.

The restoration components have separate ownership:

| Component | Responsibility |
| --- | --- |
| `shared/terminal-protocol.ts` | Browser/server message contract and transport limits |
| `terminal-session-manager.ts` | Session registry, target policy and runtime settings injection |
| `terminal-session.ts` | SSH lifetime, current attachment, restore phases and expiry |
| `terminal-state.ts` | Ordered terminal parsing, snapshots and sequence boundaries |
| `secure-terminal-transport.ts` | Bounded secure send/receive queues and socket lifetime |
| `terminal-restore-controller.ts` | Snapshot/live parsing, dimensions and input permissions |
| `useTerminalSession.ts` | Terminal/DOM lifetime and React bindings |

Attachments progress through `snapshotting → awaiting-ready → resizing → interactive`. Every input, reply and queued resize is checked against the current attachment. Historical snapshot parsing suppresses replies and clipboard effects; live query replies during restoration use `terminal-reply` with the current restore ID, while user input stays disabled until `restored`.

Browser transport queues admit at most 16 MiB or 2048 pending messages per direction, including the running task. WebSocket sends also check encrypted frame size against the 16 MiB socket buffer limit; the backend limits outstanding sends to 2048. A transport overflow disconnects the browser and retains SSH for the resume window. Input pending in the browser is limited to 64 Ki characters and fails explicitly on overflow. Intermediate terminal output and input are never silently trimmed. These transport limits are separate from the terminal parsing limit, which closes the SSH session on overflow.

Backend compilation keeps the server at `dist/backend/server.js` and emits the shared contract under `dist/shared`. Production dependency tracing includes the shared runtime module.
