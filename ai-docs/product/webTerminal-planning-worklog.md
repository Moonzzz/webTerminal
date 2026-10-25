---
keywords:
  - webTerminal
  - worklog
  - planning
  - documentation
summary: webTerminal 功能规划与文档整理开发日志，记录已完成能力、待办事项和相关文件。
---

# webTerminal 规划 worklog

## TODO

- [ ] 生产环境拒绝默认登录密码和默认 `sessionSecret`。
- [ ] 增加 WebSocket Origin / Host 校验。
- [ ] 增加登录、握手、WSS、SSH 会话创建的限流与最大会话数。
- [ ] 增加 SSH idle timeout、最大会话时长和连接建立超时。
- [ ] 增加 SSH host key verification。
- [ ] 增加 CSP、frame-ancestors、Referrer-Policy、HSTS 等安全响应头。
- [ ] 增加基础审计日志，仅记录连接元数据。
- [ ] 增加输出侧 backpressure 和高输出合批写入。
- [ ] 增加大段粘贴确认、分块发送和 tmux 快捷入口。
- [ ] 补充 Claude Code / Codex CLI 环境健康检查。
- [ ] 明确是否需要多用户、SSO、完整终端回放、多实例会话路由。

## 已完成

### 2026-10-25：快照恢复

- [x] 使用 headless xterm 快照恢复屏幕与有限滚动历史，再接收有序实时增量。
- [x] 废弃原始输出回放及 `replayBufferBytes`：回放会重复展示下载进度等中间状态，无法直接恢复当前屏幕。

### 2026-06-23：规划与基础功能

- [x] 梳理 webTerminal 原始需求和产品定位。
- [x] 拆分 `frontend/` 与 `backend/` 目录。
- [x] 增加后端统一配置 `config/server.json`，支持 `${ENV:default}` 注入。
- [x] 实现单用户登录、HttpOnly Cookie、认证失败 IP 锁定。
- [x] 实现 WSS 登录 Cookie 鉴权。
- [x] 实现节点端口 allowList，非白名单目标不可连接。
- [x] 首页移除 SSH 密码输入，terminal 页面临时输入 SSH 密码。
- [x] 按节点 host 记住上次 port 和 username。
- [x] 实现浏览器 ping、服务端 WebSocket ping、SSH keepalive。
- [x] 实现前端输入缓冲。
- [x] 实现单进程内存态会话恢复（恢复方式已更新为上述快照方案）。
- [x] 启动脚本使用 `node --import tsx`，避免 `tsx` CLI 临时 IPC 依赖。

相关文件：

- `config/server.json`
- `backend/server.ts`
- `backend/lib/auth.ts`
- `backend/lib/config.ts`
- `backend/lib/http-api.ts`
- `backend/lib/ws-server.ts`
- `frontend/app/page.tsx`
- `frontend/components/TerminalClient.tsx`

### 2026-06-24：allowList、分层与安全通道

- [x] 移除后端预配置节点模型、`nodeId` 创建路径和服务端私钥节点配置。
- [x] 移除 `/api/nodes`、`/api/targets`，allowList 不再返回前端。
- [x] 后端拆分 WebSocket 协议、Terminal Session Manager、SSH Connector。
- [x] 首页改为只输入 host、port、username。
- [x] Terminal 路由只允许 `/terminal/custom`。
- [x] WebSocket `init` 改为发送用户输入 `target`。
- [x] 新增应用层安全通道：短期 RSA-OAEP 握手、AES-GCM 加密、HMAC 签名、防重放。
- [x] 登录接口改为只接收加密认证载荷。
- [x] Cookie 有效时可重新签发页面内存态安全会话。
- [x] WebSocket 首帧 `auth` 和后续业务帧双向加密。
- [x] 移除自定义节点存储中 `password` 字段读取逻辑，刷新后不能绕过 SSH 密码输入。
- [x] 运行类型检查和构建验证。

相关文件：

- `backend/lib/terminal-protocol.ts`
- `backend/lib/terminal-session-manager.ts`
- `backend/lib/ssh-connector.ts`
- `backend/lib/secure-channel.ts`
- `backend/lib/http-api.ts`
- `backend/lib/ws-server.ts`
- `frontend/lib/secure-channel.ts`
- `frontend/app/page.tsx`
- `frontend/app/terminal/[nodeId]/page.tsx`
- `frontend/components/TerminalClient.tsx`

### 2026-06-24：依赖清理与 Docker 生产结构

- [x] 终端包从弃用 `xterm` 迁移到 `@xterm/xterm`。
- [x] 升级 Next.js、React、React DOM、`ssh2`、`ws`、`@xterm/addon-fit` 和类型包。
- [x] 使用 package override 固定 `postcss` 安全版本范围。
- [x] 新增 `tsconfig.backend.json`，生产后端编译到 `dist/backend`。
- [x] `npm run build` 统一执行类型检查、前端构建和后端编译。
- [x] `npm run start` 改为运行 `dist/backend/server.js`。
- [x] 新增 Dockerfile、`.dockerignore`、Docker 镜像构建脚本。
- [x] 使用 `@vercel/nft` 从真实自定义 server 入口追踪生产运行依赖。
- [x] runner 改为纯 Alpine，只保留 Node、必要系统库和生产文件包。
- [x] 生产镜像历史由 558MB 降至 183MB。

相关文件：

- `package.json`
- `package-lock.json`
- `tsconfig.backend.json`
- `Dockerfile`
- `.dockerignore`
- `.gitignore`
- `scripts/build-docker-image.sh`
- `scripts/create-production-bundle.mjs`
- `frontend/next.config.mjs`
- `README.md`

### 2026-06-25：Docker 运行验证

- [x] 确认 Docker 构建入口为 `npm run docker:build`，默认目标平台 `linux/amd64`。
- [x] Docker 构建阶段增加 npm registry 与 Node dist 镜像源配置。
- [x] 构建 `webterminal:validation` 成功。
- [x] 启动容器并验证 `/login`、未登录跳转、错误登录、正确登录、Cookie 后 `/api/auth/me` 与首页访问。
- [x] 验证完成后停止并清理临时容器。

相关文件：

- `Dockerfile`
- `scripts/build-docker-image.sh`
- `config/server.json`
- `README.md`

### 2026-06-25：登录跳转与 HMR 修复

- [x] 定位登录页未发起请求而执行原生刷新的原因。
- [x] 修复终端 WebSocket 与 Next.js HMR 的 Upgrade 冲突。
- [x] 终端 WebSocket 改为 `noServer`，只处理 `/ws/terminal`。
- [x] 增加非终端 Upgrade 回归测试。
- [x] 验证 HMR、终端 WebSocket、登录跳转和生产构建。

相关文件：

- `backend/lib/ws-server.ts`
- `tests/ws-server.test.ts`
- `package.json`

### 2026-06-25：Terminal 密码、视口、UTF-8 与复制体验

- [x] SSH 密码输入禁用网站密码自动填充语义，改用普通文本框配合 CSS 掩码。
- [x] Terminal 页面固定覆盖视口，页面级裁剪溢出，仅保留 xterm 内部滚动。
- [x] 使用 `ResizeObserver` 监听 terminal 容器尺寸变化并同步行列。
- [x] SSH 密码提交后自动聚焦 terminal。
- [x] 后端 SSH stdout/stderr 使用 `StringDecoder` 流式 UTF-8 解码，修复 Claude Code TUI 边框乱码。
- [x] 增加 OSC 52 handler，支持 Claude Code CLI 复制到浏览器剪贴板。
- [x] Clipboard API 不可用时使用隐藏 textarea 回退，并恢复焦点。
- [x] 完成类型检查、测试和前端构建验证。

相关文件：

- `frontend/components/TerminalClient.tsx`
- `frontend/app/globals.css`
- `backend/lib/ssh-connector.ts`

### 2026-06-25：ai-docs 整理

- [x] 盘点 `ai-docs` 下全部功能文档，确认均为 UTF-8 文本。
- [x] 将登录跳转、allowList、安全通道、依赖清理、Docker、Docker 验证、OSC 52、Terminal 视口与密码等功能点合并到 `webTerminal-planning.md`。
- [x] 按当前实现修订 `architecture-optimization.md`，更新模块职责、资源状态、清理状态、安全缺口和演进路线。
- [x] 将需求点提炼到 `requires.md`，仅保留核心描述。
- [x] 将分散 worklog 合并到当前 worklog。
- [x] 删除被合并的独立功能文档，仅保留 4 份核心文档。

相关文件：

- `ai-docs/product/webTerminal-planning.md`
- `ai-docs/product/webTerminal-planning-worklog.md`
- `ai-docs/product/architecture-optimization.md`
- `ai-docs/product/requires.md`

### 2026-07-06：开发模式 HTTPS 与证书生成

- [x] `npm run dev` 改为开发启动包装脚本，默认证书不存在时自动用 `openssl` 生成自签证书。
- [x] 开发证书默认写入 `.certs/webterminal-dev-key.pem` 和 `.certs/webterminal-dev-cert.pem`，并包含 localhost、机器名和当前局域网 IP 的 SAN。
- [x] 继续支持通过 `WEBTERMINAL_HTTPS_KEY` 和 `WEBTERMINAL_HTTPS_CERT` 指定自定义开发证书路径，解决局域网 HTTP 访问时浏览器不暴露 Web Crypto 的问题。
- [x] README 补充局域网设备访问开发服务时的 HTTPS 证书配置说明。
- [x] 运行类型检查验证通过。

相关文件：

- `package.json`
- `scripts/dev.mjs`
- `.gitignore`
- `backend/server.ts`
- `backend/lib/ws-server.ts`
- `README.md`
