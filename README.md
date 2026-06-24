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

Open `http://localhost:3000`. The default local login is `admin` /
`webTerminal`; override it with environment variables before exposing the
service.

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

Build an x86 Linux image:

```bash
npm run docker:build -- webterminal:latest
```

The build script targets `linux/amd64` by default. On macOS it uses
`docker buildx build --platform linux/amd64 --load`; on x86 Linux it uses
`docker build --platform linux/amd64`.
Docker npm install configures `npm_config_disturl` with
`https://mirrors.ustc.edu.cn/node/` for Node.js distribution downloads used by
native dependency builds.

The production image uses an Alpine runtime containing only the Node binary,
its required system library, traced runtime dependencies, compiled backend,
configuration, and the pruned Next.js build. It does not contain npm, Yarn,
development dependencies, frontend source packages, build caches, source maps,
or the complete project `node_modules` directory.

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
- After the browser disconnects or refreshes, the terminal can reconnect to the in-memory SSH session within the resume window and replay buffered output.
- Development uses `node --import tsx` for the TypeScript backend; production runs compiled JavaScript from `dist/backend`.
