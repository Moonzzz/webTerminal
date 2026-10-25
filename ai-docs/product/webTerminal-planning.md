---
keywords:
  - webTerminal
  - ssh
  - browser terminal
  - allowList
  - secure channel
  - Claude Code
  - Codex CLI
  - Docker
summary: webTerminal 功能规划，合并登录、allowList、自定义 SSH、应用层安全通道、会话恢复、终端体验、AI CLI 适配、依赖清理和 Docker 部署等功能点。
---

# webTerminal 功能规划

## 产品定位

webTerminal 是轻量浏览器 SSH 工作台，面向开发、运维和 AI CLI 使用场景。当前阶段以单用户、小规模部署、低资源占用和清晰安全边界为核心，不做完整云 IDE。

核心目标：

- 浏览器中打开 SSH 终端，连接后端允许的目标节点。
- 稳定承载 Claude Code、Codex CLI、tmux、vim、git、npm 等交互式 CLI/TUI。
- 页面刷新或断线后，在恢复窗口内重连原 SSH 会话，通过快照恢复屏幕与有限滚动历史。
- 认证、WebSocket、SSH 目标校验和终端转发保持职责分离。
- 生产部署尽量裁剪运行依赖，降低镜像、磁盘、内存和攻击面。

非目标：

- 当前不做文件管理器、在线编辑器、SFTP、多人共享终端、终端录屏回放和完整权限平台。
- 当前不保存完整终端输出，不持久化 SSH 密码，不向前端暴露 allowList。
- 当前不支持多实例或进程重启后的真实 SSH 会话恢复。

## 当前实现概览

### 技术结构

- 前端：Next.js App Router、React、TypeScript、`@xterm/xterm`、`@xterm/addon-fit`。
- 后端：Node.js 自定义 HTTP server、`ws` WebSocket、`ssh2` SSH shell。
- 部署：开发环境通过 `node --import tsx backend/server.ts` 运行，生产环境编译到 `dist/backend` 后执行 `node dist/backend/server.js`。
- 目录：`frontend/` 和 `backend/` 已分离；HTTP API、WSS 和 Next 页面由同一 Node 进程承载。

### 登录与导航

登录流程：

1. 前端先调用 `/api/crypto/handshake` 获取短期 RSA-OAEP 公钥和 challenge。
2. 登录表单通过应用层安全通道提交用户名和密码。
3. 后端校验单用户凭据，失败按 IP 计数并在超过限制后锁定。
4. 登录成功写入 HttpOnly Cookie。
5. 前端使用整页跳转回首页，重新经过服务端鉴权。

已修复的关键问题：

- 终端 WebSocket 改为 `WebSocketServer({ noServer: true })`，只接管 `/ws/terminal`。
- 非终端 Upgrade 请求不再被终端服务处理，避免拦截 Next.js `/_next/webpack-hmr`，导致登录页无法 hydration 和跳转。

### 自定义 SSH 连接与 allowList

当前连接模型：

1. 首页只输入 host、port、username。
2. 前端只做基础格式校验，不读取、不展示、不本地判断 allowList。
3. 页面按 host 记住上次 port 和 username，保存于 localStorage。
4. 连接目标临时保存于 sessionStorage，用于进入 `/terminal/custom`。
5. Terminal 页面再人工输入 SSH 密码。
6. WebSocket `init` 只发送 `target`，不再发送 `nodeId`。
7. 后端在创建 SSH 会话前校验 `host:port` 必须命中 allowList。
8. allowList 不通过 HTTP API 暴露给浏览器。

已移除的旧模型：

- 预配置节点列表。
- `/api/nodes` 和 `/api/targets`。
- `nodeId` 创建 SSH 会话路径。
- 服务端私钥节点配置读取路径。

### Terminal 交互

已实现能力：

- xterm 按需动态加载，首页不加载 terminal 运行时代码。
- 终端输出直接写入 xterm，不进入 React state。
- 前端输入使用 16ms 批量 flush，输入缓冲上限 64KiB。
- WebSocket 发送缓冲超过阈值时暂停 flush，避免弱网下持续放大。
- 浏览器应用层 ping、服务端 WebSocket ping 和 SSH keepalive。
- `ResizeObserver` + `requestAnimationFrame` 合并 resize，自动同步行列到后端。
- Terminal 页面固定占满视口，页面级不滚动，只保留 xterm 内部滚动。
- SSH 密码输入使用普通文本框配合 CSS 掩码，降低浏览器和密码管理器误填网站密码的概率。
- SSH 密码提交后自动聚焦 terminal。
- 后端 SSH 输出使用 `StringDecoder` 流式 UTF-8 解码，避免多字节边框字符跨 chunk 出现乱码。
- 前端注册 OSC 52 handler，支持 Claude Code CLI 将复制内容写入浏览器剪贴板；Clipboard API 不可用时使用隐藏 textarea 回退。

### 会话恢复

当前恢复能力是单进程内存态：

1. SSH 会话创建后返回后端 sessionId。
2. 浏览器将 sessionId 按目标保存于 sessionStorage。
3. 页面刷新或 WebSocket 断开时，后端 detach 浏览器连接并保留 SSH 会话一段时间。
4. 浏览器重连后携带 sessionId，后端重新 attach 到同一 SSH 会话。
5. 后端通过 headless xterm 维护终端状态，生成包含当前屏幕和有限滚动历史的快照，并发送快照序号之后的实时增量。
6. 浏览器按快照原始尺寸恢复，解析完成后确认期望尺寸；服务端完成尺寸同步后开放输入。
7. 恢复 TTL 过期、SSH 关闭或进程重启后，需要重新创建连接。

滚动历史随快照一起恢复，默认保留 5000 行，由 `ssh.scrollbackLines` 控制。`ssh.outputBufferBytes` 限制待解析输出与不完整控制序列的总字节数，默认 4MiB，超限关闭会话。

不引入 Redis 或数据库保存真实 SSH 会话。真实 SSH channel 只能存在于当前网关进程内；多实例恢复需要会话路由或 sticky session。

### 应用层安全通道

当前安全通道用于登录认证、Cookie 会话补发安全会话和 WebSocket 双向业务帧。

握手与登录：

1. 后端生成短期 RSA-OAEP 2048 位密钥对、challenge 和过期时间。
2. 握手绑定来源 IP 和 User-Agent，2 分钟内有效，使用后销毁。
3. 浏览器生成一次性客户端 RSA-OAEP 密钥对和 AES-GCM 内容密钥。
4. 登录载荷包含 username、password、challenge、timestamp、requestId、clientPublicKeyJwk。
5. 登录载荷使用 AES-GCM 加密，AES 内容密钥使用服务端握手公钥 RSA-OAEP 加密。
6. 认证成功后，后端创建短期安全会话，包含 AES-256-GCM key、HMAC-SHA-256 key、sessionId 和过期时间。
7. 安全会话材料使用客户端公钥混合加密返回，前端只保存在页面内存中。

WebSocket：

- WSS 建连仍先校验 HttpOnly 登录 Cookie。
- 第一条业务消息必须是加密后的 `auth`。
- 后续 `init`、`input`、`resize`、`ping` 以及服务端 `ready`、`session`、`status`、`error`、`output`、`pong` 都使用安全封包。
- 封包包含 `sessionId`、`channel`、`sequence`、`requestId`、`timestamp`、`iv`、`ciphertext`、`signature`。
- 通过 AES-GCM AAD、HMAC、单调序号、requestId 记录和时间戳 TTL 做篡改与重放校验。

边界：

- 应用层安全通道不能替代 HTTPS/WSS。首次公钥下发仍需要 TLS 证书链保护，否则主动中间人可替换公钥。
- 安全会话是单进程内存态；刷新页面会基于有效登录 Cookie 重新签发。
- 若存在 XSS，运行时内存中的安全会话材料仍可能被读取，后续需要 CSP、依赖治理和输出转义。

### AI CLI 适配

Claude Code 和 Codex CLI 的适配重点不是深度集成 API，而是保证浏览器终端兼容性：

- 支持全屏 TUI、颜色、Unicode、CJK、IME、备用屏幕、鼠标模式和 resize。
- 支持 Ctrl+C、Ctrl+D、Ctrl+Z、Tab、方向键、Alt/Option 组合键。
- 支持大段粘贴、复制、OSC 52、长输出和 tmux 场景。
- 不替 Claude Code 或 Codex CLI 做权限审批；只转发真实终端交互。
- 不自动修改 Claude Code/Codex 权限、MCP、hooks、plugin 配置。
- 推荐长任务在远端 tmux 中运行，浏览器刷新时优先恢复到同一 SSH/tmux 上下文。

### 生产依赖与 Docker

已完成部署结构：

- 终端包从弃用的 `xterm` 迁移到 `@xterm/xterm`。
- 生产依赖保持在 `@xterm/addon-fit`、`@xterm/xterm`、`next`、`react`、`react-dom`、`ssh2`、`ws`。
- `npm run build` 串联类型检查、Next 前端构建和后端 TypeScript 编译。
- `@vercel/nft` 从 `dist/backend/server.js` 追踪实际运行依赖，生成生产文件包。
- Docker builder 使用 Node 22 + Alpine 3.24；runner 使用纯 Alpine，只保留 Node 可执行文件、必要系统库、配置、Next 运行产物和后端编译产物。
- 镜像不包含 npm、Yarn、开发依赖、完整 `node_modules`、构建缓存、source map、前端源码、密钥和环境文件。
- 构建脚本默认构建 `linux/amd64`；macOS 使用 buildx。
- Docker 构建阶段配置 npm registry 与 Node dist 镜像源，降低构建网络失败概率。

历史验证结果：

- `linux/amd64` 镜像曾从 558MB 降至 183MB。
- 生产文件包历史约 42.1MiB。
- 容器验证覆盖未登录跳转、`/login` 返回、错误登录、正确登录、Cookie 后访问 `/api/auth/me` 和首页。

## 业务流程

### 登录流程

1. 用户访问受保护页面，未登录则跳转 `/login`。
2. 登录页通过安全握手加密提交凭据。
3. 后端校验单用户凭据和失败锁定策略。
4. 成功后写入 HttpOnly Cookie。
5. 前端整页跳转到首页。

### SSH 连接流程

1. 用户在首页输入 host、port、username。
2. 前端保存 host 对应的 port 和 username 记忆。
3. 前端跳转 `/terminal/custom`。
4. Terminal 页面提示输入本次 SSH 密码。
5. 前端打开 WebSocket，先发送安全 `auth`，再发送安全 `init`。
6. 后端校验 Cookie、安全会话、消息格式和 allowList。
7. 后端使用 `ssh2` 建立 shell，准备完成后返回 sessionId。
8. 前端进入 xterm 交互。

### 断线恢复流程

1. 浏览器断开时后端 detach 当前 peer。
2. SSH 会话在恢复 TTL 内继续保留。
3. 浏览器重连时携带 sessionId。
4. 后端重新 attach，按序发送终端状态快照与后续实时增量。
5. 浏览器恢复快照时抑制终端回复与剪贴板副作用；实时查询回复使用独立通道，用户输入保持关闭。
6. 浏览器确认快照解析完成，服务端同步期望尺寸并确认后开放输入。
7. 旧会话过期时提示并重新建立连接。

### 复制流程

1. Claude Code CLI 或其他程序在 SSH 会话中输出 OSC 52 序列。
2. xterm parser handler 拦截 OSC 52。
3. 前端解析 base64 UTF-8 文本并限制最大长度。
4. 优先写入 Clipboard API，失败时使用隐藏 textarea 回退。

## 后续路线

### P0：文档与实现基线

- 保持 4 份核心 ai-docs 文档：规划、规划日志、架构优化、需求点。
- 明确当前是单进程内存态会话恢复。
- 明确 allowList 不返回前端，SSH 密码只临时输入。
- 保持前后端目录分离和后端模块职责边界。

### P1：公网安全闭环

- 生产模式拒绝默认密码和默认 session secret。
- 增加 WebSocket Origin / Host 校验。
- 增加登录、握手、WSS、SSH 会话创建限流。
- 增加最大会话数、idle timeout、最大会话时长和连接建立超时。
- 增加 SSH host key verification。
- 增加 CSP、frame-ancestors、Referrer-Policy、HSTS 等安全响应头。
- 增加基础审计日志，只记录元数据。

### P2：低资源与弱网体验

- 增加后端输出侧 backpressure。
- 前端输出写入按帧合批，降低高频输出压力。
- 大段粘贴分块发送并弹确认。
- 根据高输出与弱网场景评估滚动历史、解析队列和传输积压上限。
- 增加 tmux 快捷入口和环境健康检查。

### P3：可替换前端或 Gateway

- 只有当实际数据证明 Next 运行时成为主要资源瓶颈时，再评估 Vite + React 静态前端。
- 只有当单进程 Node Gateway 成为 CPU、内存或交付瓶颈时，再评估 Go/Rust Gateway。
- 替换前应先稳定 HTTP/WSS 协议，避免前端依赖后端实现细节。

## 仍需确认

- 部署场景是单人自用、团队内网还是公网多用户。
- 是否需要完整终端回放；如需要，保存多久、谁可查看、如何加密。
- 是否需要 OIDC/SSO、MFA 或反向代理认证。
- 是否需要移动端浏览器支持。
- Claude Code/Codex CLI 是否由目标节点预装，还是由 webTerminal 提供环境检查与引导。
