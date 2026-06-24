---
keywords:
  - webTerminal
  - architecture
  - terminal gateway
  - SSH
  - resource optimization
  - low memory
  - low disk
summary: webTerminal 当前架构调研与低资源目标架构建议，结合 requires.md 的需求约束，给出保持项目整洁、简单、高效、低内存和低磁盘占用的演进方案。
---

# webTerminal 架构调研与优化建议

## 原始需求

需求来源：`requires.md`。

核心需求可以归纳为：

- 浏览器提供 SSH 终端面板，支持后端服务节点连接。
- 适配 Claude Code、Codex CLI 等长时间交互式 AI CLI。
- 页面刷新、断开后可恢复原 SSH 会话并回放缓冲输出。
- 浏览器与后端连接长时间保活。
- 节点和端口必须命中白名单。
- 单用户认证，网站和 WSS 都必须登录，失败过多锁 IP。
- 登录认证和 WebSocket 业务帧需要应用层安全通道，包含短期非对称握手、对称加密、HMAC 签名和防重放。
- 自定义连接只在首页输入 host、port、username，SSH 密码在终端页临时输入。
- 按节点 IP 记住上次端口和用户名。
- 后端配置统一从配置文件读取，支持环境变量注入。
- 前后端目录清晰独立，后端后续可替换。
- 弱网下输入不阻塞。
- 项目要整洁、简单、高效，低 CPU、低内存、低磁盘占用。

## 当前架构事实

当前实现是一个轻量单进程 Web Terminal：

```text
Browser
  ├─ Login / Node page
  ├─ xterm terminal
  └─ Web Crypto secure channel
        │
        │ HTTP + WebSocket
        ▼
Node.js custom server
  ├─ Next.js frontend handler
  ├─ HTTP auth / node API
  ├─ secure channel service
  ├─ WebSocket terminal gateway
  ├─ in-memory session manager
  └─ ssh2 connector
        │
        ▼
Target SSH node
```

已确认实现边界：

| 边界 | 当前职责 | 评价 |
| --- | --- | --- |
| `server.ts` | 启动 Next、自定义 HTTP server、挂载后端 API 和 WSS | 结构简单，适合单进程部署 |
| `http-api.ts` | 登录、退出、当前用户、安全会话 | API 数量少，边界清晰，不暴露 allowList |
| `ws-server.ts` | WSS 鉴权、解密业务帧、init/input/resize/ping 协议分发 | 网关职责集中 |
| `terminal-protocol.ts` | WS 业务消息归一化 | 协议校验从网关中拆出 |
| `terminal-session-manager.ts` | SSH 会话恢复、回放缓冲、detach/close 生命周期、allowList 校验 | 会话状态集中管理 |
| `ssh-connector.ts` | `ssh2` 连接、shell、输入、resize、keepalive | SSH 库隔离在连接器层 |
| `secure-channel.ts` | RSA 握手、AES-GCM、HMAC、防重放、短期安全会话 | 满足需求，但前后端存在协议逻辑重复 |
| `config.ts` | 配置解析、环境变量占位、allowList | 简单有效，适合当前阶段 |
| `TerminalClient.tsx` | xterm 按需加载、WSS、输入缓冲、keepalive、恢复会话 | 前端没有用 React state 承载输出，方向正确 |

资源现状：

| 项目 | 当前大小 |
| --- | ---: |
| 后端源码 | 约 88K |
| 前端目录 | 约 8.5M，其中主要是 `.next` |
| `node_modules` | 约 394M |
| `dist` | 约 49M |
| 生产包文件数 | 约 2136 |
| 生产包最大运行依赖 | `next` 约 39M |
| 编译后后端 | 约 80K |

现有低资源设计已做对的点：

- 生产依赖只有 `@xterm/addon-fit`、`@xterm/xterm`、`next`、`react`、`react-dom`、`ssh2`、`ws`。
- 终端组件动态加载，首页不加载 xterm。
- 终端输出直接写入 xterm，不进入 React state。
- SSH 会话、登录失败计数、安全会话、回放缓冲全部在内存中，无数据库和磁盘写入。
- 生产包通过 Node File Trace 追踪运行入口，不复制完整 `node_modules`。
- Docker 运行镜像已从 558MB 降到 183MB，生产文件包约 42.1MiB。
- `.dockerignore` 已排除 `node_modules`、`dist`、`.next`、`**/._*`、密钥和环境文件。

当前整洁性问题：

- 源码目录存在多个 macOS AppleDouble 元数据文件，例如 `._ssh-session.ts`、`._TerminalClient.tsx`、`._page.tsx`。它们已被 Docker 忽略，但仍会污染源码扫描。
- 根目录存在空的 `.git` 目录，当前 `git status` 无法识别为有效仓库。
- 没有 `.gitignore` 文件；如果后续接入 Git，应明确忽略 `node_modules`、`dist`、`.next`、`*.tsbuildinfo`、`._*`、密钥和环境文件。
- `frontend/app/api` 目录当前没有有效 Next API 源码，容易误导读者以为同时存在 Next API Route 和后端自定义 API。

## 需求匹配结论

| 需求 | 当前状态 | 建议 |
| --- | --- | --- |
| 浏览器 SSH 面板 | 已实现 | 保持 xterm + ssh2 |
| Claude/Codex CLI | 基础可用 | 优先补 tmux、粘贴保护、resize/IME/快捷键体验 |
| 会话恢复 | 已实现单进程内存恢复 | 保持内存态，不要引入 Redis；先加配额和超时 |
| 浏览器保活 | 已实现客户端 ping、服务端 WS ping、SSH keepalive | 保持，增加 idle timeout 和最大会话时长 |
| 节点白名单 | 已实现 | 增加内网危险地址拦截和配置校验 |
| 单用户认证 | 已实现 | 生产环境拒绝默认密码和默认 secret |
| 安全通道 | 已实现 | 保留，但强调不能替代 HTTPS/WSS |
| SSH 密码临时输入 | 已实现 | 保持不持久化、不进 URL、不写日志 |
| 节点输入记忆 | 已实现 localStorage 记忆 host 对应端口和用户名 | 保持 |
| 配置统一 | 已实现 | 增加配置 schema/启动期失败提示 |
| 前后端分界 | 已实现目录分离 | 不急于拆多仓库或多服务 |
| 弱网输入缓冲 | 已实现 16ms flush、64KiB 输入缓冲、WS bufferedAmount 限制 | 增加输出侧 backpressure |
| 低资源 | 基础良好 | 优先限制会话、缓冲、构建产物；不是先拆微服务 |

## 推荐目标架构

### 总体判断

当前最优架构不是微服务，也不是马上重写成 Go/Rust。更合理的路线是：

> 保持单进程 Terminal Gateway，强化逻辑分层、资源配额、安全边界和构建瘦身；只有当 Next 的磁盘/内存开销成为主要矛盾时，再把前端迁移为 Vite 静态包。

理由：

- 当前需求是单用户或小规模 SSH 工作台，瓶颈更可能来自 SSH 会话、终端输出、浏览器渲染和依赖体积，而不是服务拆分。
- 引入数据库、Redis、队列、Kubernetes 多副本会增加资源占用、部署复杂度和状态一致性问题。
- 会话恢复要求天然依赖进程内 SSH 连接；除非明确要多实例，否则内存态 session manager 是最低资源方案。
- Next 带来的主要成本是磁盘和运行时依赖；但当前已有自定义 server 和鉴权跳转，短期继续使用 Next 成本低。

### 逻辑分层

建议保持物理目录简单，但把后端内部职责收敛为 5 个逻辑层：

```text
server bootstrap
  └─ 只负责组装依赖和启动 HTTP server

http control api
  └─ 登录、退出、安全会话补发

terminal gateway
  └─ WebSocket 鉴权、协议分发、加解密、限流

session manager
  └─ SSH 会话 Map、恢复 TTL、回放缓冲、资源配额

ssh connector
  └─ ssh2 连接、shell、resize、keepalive、host key 校验
```

当前已完成基础拆分；继续加功能时优先保持这些边界：

- `SshConnector`：只包装 `ssh2`。
- `TerminalSessionManager`：只管理 session Map、配额、TTL、回放缓冲。
- `TerminalProtocol`：只定义 init/input/output/resize/status/error/ping/pong 的消息结构和校验。

### 前端分层

前端保持三个小边界：

```text
page
  └─ 登录页、节点页、终端页

terminal component
  └─ xterm 生命周期、resize、输入缓冲、输出写入

secure/api client
  └─ Web Crypto、安全会话、HTTP/WSS 协议调用
```

建议保持 `TerminalClient` 不使用全局状态库，不引入 UI 框架。当前页面数量和交互复杂度不需要 Redux、Zustand、TanStack Query、组件库或动画库。

## 低资源架构策略

### 后端内存

当前内存主要消耗来自：

- 每个 SSH 连接的 `ssh2` 客户端和 shell stream。
- 每个 SSH 会话的回放缓冲，当前默认 512KiB。
- 每个安全会话的 AES/HMAC key、序号、requestId 记录。
- 登录失败 Map 和握手 Map。
- Next 运行时常驻内存。

建议：

1. 增加全局和来源维度的会话上限：
   - `maxSessionsGlobal`
   - `maxSessionsPerIp`
   - `maxSessionsPerUser`
   - `maxSessionsPerTarget`
2. 增加 SSH idle timeout 和最大会话时长：
   - idle timeout 处理无人输入但连接长期占用的问题。
   - max lifetime 防止浏览器或 tmux 长期占用 Gateway 资源。
3. 保持 `replayBufferBytes` 默认 512KiB，允许配置降低到 128KiB 或 256KiB。
4. 增加输出侧 backpressure：
   - 当 WebSocket `bufferedAmount` 超过阈值时暂停/限速 SSH 输出。
   - 长时间慢消费直接断开浏览器绑定，但保留 SSH 会话到恢复 TTL。
5. 安全通道的 `seenRequestIds` 已有 2048 上限，应继续保持；高频输入不应逐字符发送，继续批量发送。

不要为了会话恢复引入 Redis。Redis 只能保存元数据和输出，不能保存真实 SSH channel；多实例恢复仍需要会话路由或 sticky session，复杂度明显上升。

### 前端内存

当前前端方向正确：

- xterm 动态导入。
- 输出写入 xterm，不进入 React state。
- 输入缓冲有上限。
- scrollback 为 5000 行。

建议：

1. scrollback 默认保持 5000；只在用户显式设置时提高。
2. 大段粘贴分块发送，超过阈值弹确认。
3. 输出写入可做 `requestAnimationFrame` 合批，避免超高频 chunk 触发过多 xterm write。
4. 保持不引入大型 UI 库。
5. 终端页卸载时确保清理 interval、event listener、WS、xterm addon。

### 磁盘与镜像

当前磁盘大头是：

- 开发依赖 `node_modules` 约 394M。
- 生产包中 `next` 运行依赖约 39M。
- `dist` 约 49M。

建议：

1. 保持当前 Node File Trace 生产打包方式，不复制完整 `node_modules`。
2. 继续排除 source map、TS 源码、`.next/cache`、`.next/types`、diagnostics、trace。
3. 如果极限压缩镜像成为硬目标，下一步不是优化后端，而是迁移前端：
   - Next App Router 改为 Vite + React 静态包。
   - 后端只用 Node HTTP server 提供静态文件、HTTP API 和 WSS。
   - 预期收益是移除 Next server runtime，降低磁盘和常驻内存。
4. 不建议当前阶段直接换 Go/Rust：
   - 会重写安全通道、WSS、SSH、构建和前端集成。
   - 收益主要是单二进制和更低内存，但实现成本高于当前阶段收益。

## 安全与攻击面策略

当前项目要公网暴露时，最低安全闭环还缺这些能力：

1. 启动期拒绝默认凭证：
   - 默认密码 `webTerminal` 不允许生产运行。
   - 默认 `sessionSecret` 不允许生产运行。
2. WebSocket Origin / Host 校验：
   - 只允许配置中的公开访问域名。
3. 连接限流：
   - 登录、握手、创建 SSH 会话、WSS 连接都要有 IP 维度限制。
4. SSH host key verification：
   - 当前没有 host key 固定校验，公网或不可信网络下存在中间人风险。
5. 自定义目标收敛：
   - 自定义 host/port 必须命中 allowlist。
   - 额外禁止回环、链路本地、云元数据地址、内网管理网段等危险目标，除非显式配置允许。
6. 安全响应头：
   - CSP
   - frame-ancestors
   - Referrer-Policy
   - HSTS
7. 审计只记录元数据：
   - 用户、IP、节点、连接时间、断开原因、失败原因。
   - 默认不记录命令内容和完整终端输出。

应用层安全通道应保留，但必须明确：它不能替代 HTTPS/WSS。第一次握手公钥仍需要 TLS 证书链保护，否则主动中间人可以替换公钥。

## 协议建议

当前 WebSocket 协议已经足够小，应保持小协议，不要扩展成复杂 RPC。

建议稳定为：

| 方向 | 消息 | 说明 |
| --- | --- | --- |
| client -> server | `auth` | 安全通道首帧认证 |
| client -> server | `init` | 创建或恢复 SSH 会话 |
| client -> server | `input` | 终端输入，允许批量 |
| client -> server | `resize` | 终端大小 |
| client -> server | `ping` | 应用层保活 |
| server -> client | `ready` | 安全通道可用 |
| server -> client | `session` | 返回 SSH sessionId |
| server -> client | `output` | 终端输出 |
| server -> client | `status` | 连接状态 |
| server -> client | `error` | 业务错误 |
| server -> client | `pong` | 应用层保活响应 |

后续优化顺序：

1. 先补协议文档和运行时校验。
2. 再考虑控制帧 JSON、终端输入输出二进制帧。
3. 最后才考虑共享协议类型包。

不建议现在把协议实现抽到复杂 SDK；前后端可替换的关键是协议稳定，不是共享同一份运行时代码。

## 最优演进路线

### P0：清理和基线

目标：让项目更干净，但不改变运行行为。

- 删除源码中的 AppleDouble 元数据文件。
- 如果接入 Git，补 `.gitignore`。
- 删除空的 `frontend/app/api` 目录或补注释说明 API 由自定义 server 承载。
- 在文档中明确：当前是单进程内存态会话恢复，不支持多实例和进程重启恢复。
- 在 README 或部署文档中强调 HTTPS/WSS 必需。

### P1：公网安全闭环

目标：达到可谨慎公网部署的最低标准。

- 生产模式拒绝默认密码和默认 session secret。
- 增加 WebSocket Origin / Host 校验。
- 增加 SSH 会话创建限流和最大会话数。
- 增加 idle timeout、最大会话时长、连接建立超时。
- 增加 SSH host key verification。
- 增加安全响应头。
- 增加基础审计日志，只记录元数据。

### P2：低资源和弱网体验

目标：控制高输出、高延迟、慢浏览器造成的资源放大。

- 输出侧按帧合批写入 xterm。
- 后端增加 WS `bufferedAmount` 高水位处理。
- SSH 回放缓冲可配置为 128KiB / 256KiB / 512KiB。
- 大段粘贴分块和确认。
- tmux 快捷入口，优先把长任务交给远端 tmux 保活。

### P3：可替换前端或网关

只有在实际资源数据证明 Next 或 Node Gateway 成为瓶颈时再做：

- 前端迁移到 Vite 静态包，降低 Next server runtime 磁盘和内存开销。
- 后端仍保持 Node + `ssh2`，先不重写。
- 如果单实例 Gateway 的 CPU/内存或单文件部署成为关键目标，再评估 Go/Rust Gateway。

## 明确不建议的方向

- 不建议现在引入数据库保存会话。真实 SSH channel 不能靠数据库恢复。
- 不建议现在引入 Redis 做会话恢复。除非同时做 sticky session 或会话路由。
- 不建议拆成多个后端服务。当前功能域很小，拆服务会增加资源和运维成本。
- 不建议引入大型 UI 框架。当前页面数量少，CSS 足够。
- 不建议默认启用 WebSocket 压缩。终端流量容易造成 CPU 和内存放大。
- 不建议默认记录完整终端输出。磁盘、隐私和安全成本都高。
- 不建议浏览器长期保存 SSH 密码、密钥或安全会话材料。

## 最终结论

当前项目的最佳架构方向是：

> 单进程、内存态、配置驱动的 Terminal Gateway；前端轻量化，后端边界清晰，严格限制会话与缓冲，生产包继续按真实入口裁剪。短期强化安全和资源配额，中期再按真实数据决定是否从 Next 迁移到 Vite 静态前端。

这样能同时满足：

- 简单：一个进程、一个配置、少量依赖。
- 整洁：前后端目录清晰，后端模块职责可继续收敛。
- 高效：终端输出不走 React state，输入批量发送，SSH 会话内存恢复。
- 低资源：不引入 DB/Redis/队列；生产镜像只保留运行必需文件。
- 可扩展：协议稳定后，未来可替换前端构建工具或后端 Gateway 实现。
