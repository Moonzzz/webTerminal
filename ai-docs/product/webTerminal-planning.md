---
keywords:
  - webTerminal
  - ssh
  - browser terminal
  - Claude Code
  - Codex CLI
  - xterm
  - security hardening
  - frontend backend decoupling
summary: webTerminal 的产品功能规划，覆盖 SSH 节点连接、会话恢复、AI 编程 CLI 适配、前后端解耦、安全边界、资源占用和阶段验收标准。
---

# webTerminal 功能规划

## 原始需求

- 在浏览器页面部署 SSH 面板，支持 SSH 连接后端服务所在的其他节点。
- 对 Claude Code、Codex CLI 拥有较好的支持。
- 界面美观、简洁、优雅。
- 对服务器、网页端资源占用低。
- 使用最新的稳定技术；服务部署在服务器并对外暴露，需要尽可能降低攻击面。
- 前后端代码独立、解耦，方便后期切换后端实现和扩展功能。
- 前端 terminal 在页面意外断开或刷新后，支持重连原会话并回显会话数据。
- 前端浏览器保活，长时间不会主动断连。
- 通过环境变量和后端配置文件维护可连接节点与端口白名单，非白名单节点不可连接。
- 网站连接和 WSS 连接添加认证，暂时只支持单用户；用户名、密码由环境变量注入；默认 30 分钟内 5 次认证失败锁定 IP。
- 连接自定义节点时只输入用户名，SSH 密码在 terminal 页面临时人工输入。
- 页面按节点 IP 保存输入过的端口和用户名。
- 后端服务配置统一在配置文件中维护，通过环境变量注入配置值。
- 前后端代码各自一个目录，一次划清边界。
- 高延迟弱网环境下支持前端输入缓冲，连续输入不被 WebSocket 发送延迟阻塞。

## 当前项目状态

已确认：

- 当前项目是 Next.js App Router + React + TypeScript，实现了一个自定义 `server.ts`，在同一 HTTP 服务上挂载 Next.js 页面与 `/ws/terminal` WebSocket。
- 终端渲染使用 `xterm` 与 `@xterm/addon-fit`，后端通过 `ssh2` 创建远程 shell。
- 当前只支持浏览器表单输入 host、port、username，terminal 页面临时输入 SSH 密码后发起连接；host:port 必须命中后端 allowList。
- 当前已拆分 `frontend` 和 `backend` 目录；后端统一处理认证、allowList 校验、WebSocket 和 SSH。
- 当前已实现单用户登录、WSS cookie 鉴权、失败锁 IP、节点端口白名单、浏览器/SSH keepalive、输入缓冲和单进程会话恢复。
- 当前还没有多用户授权、审计、host key 校验、跨实例会话恢复和生产级密钥管理。

规划判断：

- 当前代码适合作为原型，但不适合作为直接公网暴露版本。
- 主要风险来自任意自定义 SSH 目标、密码从浏览器传输、节点信息暴露、WebSocket 缺少认证与来源校验、缺少连接限流和会话生命周期控制。
- 优先目标不是堆功能，而是先把“公网可部署的最小安全闭环”建立起来。

## 产品定位

webTerminal 应定位为“面向开发与运维的轻量 SSH 工作台”，不是完整云 IDE。

核心体验：

- 打开网页，输入服务节点地址；后端校验该地址是否命中 allowList。
- 一键进入稳定、低延迟、可恢复的浏览器终端。
- 页面意外断开或刷新后，优先重连原 SSH 会话并回放已缓冲输出。
- 在远端节点中顺畅使用 Claude Code、Codex CLI、tmux、vim、git、npm 等 TUI/CLI 工具。
- 管理员可以安全地配置节点、凭证、访问策略和审计。

非目标：

- 第一阶段不做完整文件管理器、在线编辑器、SFTP、多人共享终端、录屏回放、网页内直接托管 AI Agent 权限系统。
- 第一阶段不直接替代 Claude Code 或 Codex 自身的权限、沙箱、MCP、插件体系，只保证终端承载能力和安全边界。

## 目标架构

### 推荐边界

将系统拆成三个边界：

1. Web Frontend
   - 只负责界面、节点选择、终端渲染、快捷键、会话状态展示。
   - 不保存长期 SSH 密钥、密码、节点敏感信息。
   - 可构建为静态资源，由 Nginx、Caddy 或 CDN 托管。

2. Terminal Gateway
   - 只负责认证后的 WebSocket 会话、SSH 拨号、PTY 转发、会话配额、审计。
   - 对前端暴露稳定协议，不把具体后端库类型暴露给前端。
   - 初期可沿用 TypeScript + `ssh2`，后期可替换为 Go/Rust 网关，只要保持协议兼容。

3. Control Plane
   - 管理节点、用户、角色、凭证引用、访问策略、审计查询。
   - 初期可以是只读配置文件，后续演进为数据库或配置中心。

### 解耦协议

前端与后端之间定义独立协议：

- HTTP:
  - 不提供 allowList 查询接口，避免节点信息外泄。
  - `POST /api/sessions`：创建终端会话，返回短期 session token。
  - `DELETE /api/sessions/{id}`：主动关闭会话。
- WebSocket:
  - `terminal.init`：绑定登录 cookie、resume session id、cols、rows。
  - `terminal.session`：返回当前后端会话 ID 和是否恢复成功。
  - `terminal.input`：前端输入。
  - `terminal.output`：后端输出。
  - `terminal.resize`：窗口大小变化。
  - `terminal.status`：连接、断开、重连、错误状态。
  - `terminal.ping/pong`：保活。

后续优化时，终端输入输出可从 JSON 文本帧升级为二进制帧，控制消息保留 JSON，减少编码开销。

## 业务流程

### 节点连接流程

1. 用户登录 Web 面板。
2. 用户输入 host、port、username。
3. 前端只做基础格式校验，不读取、不展示 allowList。
4. 前端使用 session token 建立 WebSocket。
5. Gateway 校验用户、allowList、来源、token 有效期和连接配额。
6. Gateway 使用用户临时输入的 SSH 密码连接目标 SSH 节点。
7. SSH shell 准备完成后，前端进入终端交互。
8. 用户关闭页面、会话超时或 SSH 断开时，Gateway 清理 SSH 连接和资源。

### 会话恢复流程

1. 前端首次连接成功后保存后端会话 ID。
2. 页面刷新、网络闪断或 WebSocket 意外关闭时，Gateway 暂时保留 SSH 会话和有限输出缓冲。
3. 前端重新打开 terminal 时携带原会话 ID 发起恢复。
4. Gateway 校验会话仍可恢复后重新绑定 WebSocket，回放缓冲输出，并继续转发同一 SSH 会话。
5. 若会话已过期或 SSH 已关闭，前端自动创建新会话并更新会话 ID。

### AI CLI 工作流

1. 管理员为节点配置默认工作目录、推荐 shell、tmux 策略和环境检查命令。
2. 用户进入节点后，可直接运行 `claude` 或 `codex`。
3. 面板保证常见 TUI 能力：
   - Ctrl+C、Ctrl+D、Ctrl+Z、Tab、方向键、Alt/Option 组合键。
   - 终端 resize。
   - 大段粘贴与多行提示词输入。
   - 颜色、Unicode、CJK、IME、鼠标事件、备用屏幕。
   - 任务完成 bell/notification。
4. 推荐通过 tmux 保持长任务：
   - 面板可提供“新建/恢复 tmux 会话”入口。
   - 页面刷新后重连到同一 tmux 会话，而不是依赖 WebSocket 永久在线。

### 自定义 SSH 连接流程

自定义 SSH 连接必须先命中后端白名单。

- host 和 port 必须经过 allowlist 校验。
- 禁止连接内网元数据地址、本机回环、网关管理网段和未授权端口。
- 首页只输入 host、port、username。
- SSH 密码在 terminal 页面临时输入，不落盘，不写日志，不进入 URL，不进入前端持久化存储。
- 页面可按 host 记住上次端口和 username，提高重复连接效率。
- 优先支持一次性凭证或短期 SSH certificate，而不是长期密码。

### 保活与弱网输入流程

1. 浏览器 WebSocket 定时发送应用层 `ping`。
2. 后端定时发送 WebSocket protocol ping，并启用 SSH keepalive。
3. 前端键盘输入先进入本地缓冲区，再按短周期批量发送。
4. 当 WebSocket 发送缓冲过高时，前端继续接收输入并延迟发送，避免高延迟下阻塞用户连续输入。
5. 输入缓冲有上限，超过上限时丢弃最旧数据，避免浏览器内存无界增长。

## Claude Code 适配规划

已确认的官方行为：

- Claude Code 是可在终端、IDE、桌面和浏览器使用的 agentic coding tool，能够读代码、编辑文件、运行命令并集成开发工具。
- Claude Code 支持细粒度 permissions、permission modes、settings scopes、hooks、MCP、CLI flags。
- Claude Code 文档强调默认权限保守，敏感操作需要审批；`bypassPermissions` 仅应在容器或 VM 等隔离环境中使用。

面板适配点：

- 终端兼容：
  - 支持 Claude Code 的全屏 TUI、快捷键、多行输入、通知 bell、tmux 场景。
  - 提供“浏览器快捷键冲突”说明和可配置拦截，例如浏览器默认 Ctrl+W 不应误关闭关键会话。
  - 支持大段粘贴分块和粘贴确认，避免误提交超长 prompt。

- 项目约定：
  - 节点或项目面板展示是否存在 `CLAUDE.md`。
  - 不在 Web 面板中自动修改 Claude Code 权限配置，避免绕过用户预期。
  - 可提供只读健康检查：`claude --version`、`claude auth status --text`、当前工作目录、tmux 状态。

- 安全建议：
  - 默认推荐 Claude Code 的 `default`、`plan` 或受控 allowlist 模式。
  - 禁止在共享节点默认使用 `bypassPermissions`。
  - 如使用 hooks、MCP、plugins，应在项目文档中登记来源和风险。

## Codex CLI 适配规划

已确认的官方行为：

- Codex CLI 支持交互式 TUI、resume、slash commands、permissions、sandbox、MCP、review、exec 等工作流。
- Codex CLI 的沙箱与审批是核心安全边界；常用模式包括 `workspace-write`、`read-only` 和高风险的 full access。
- Codex 支持 `AGENTS.md` 作为项目持久指令，按全局到项目再到子目录的顺序加载。
- Codex 还支持远程 app-server WebSocket 模式，但非本地客户端应使用 WebSocket auth 并置于 TLS 后。

面板适配点：

- 终端兼容：
  - 保证 Codex TUI 的 diff、markdown、slash command 菜单、模型选择、权限提示可正常显示和交互。
  - 支持 `/copy`、`/status`、`/review`、`/permissions` 等交互场景中的快捷键。
  - 支持长会话重连和 tmux，避免浏览器断线中断任务。

- 项目约定：
  - 节点或项目面板展示是否存在 `AGENTS.md`。
  - 可提供 Codex 健康检查：`codex --version`、`codex --help`、当前 `CODEX_HOME`、是否处于 tmux。
  - 不替 Codex 做权限审批，只转发真实终端交互。

- 远程 app-server：
  - 第一阶段不建议直接代理 Codex app-server WebSocket。
  - 如后续支持，应独立成“Codex Remote”能力，要求 WSS、token、最小权限、审计和显式开关。

## UI 规划

设计目标：安静、专业、密度适中、少装饰、终端优先。

页面结构：

- 顶部：产品名、当前用户、连接状态、资源状态、设置入口。
- 左侧或顶部节点区：节点分组、搜索、最近连接、状态标签。
- 主区域：终端全屏工作区。
- 终端工具条：重连、断开、复制、粘贴、清屏、字体大小、主题、tmux 会话、全屏。
- 连接详情：当前节点、用户、目录、会话时长、延迟、只读审计摘要。

交互原则：

- 首屏直接是工作台，不做营销式 landing page。
- 卡片只用于节点列表和对话框，不把页面分割成多层卡片。
- 终端区域拥有稳定尺寸，resize 不导致布局跳动。
- 默认暗色终端主题，管理界面使用浅色或中性色；提供高对比、低动画选项。
- 所有危险动作需要明确确认：断开会话、关闭所有会话、删除节点、导入密钥。

## 资源占用规划

前端：

- 终端组件按需加载，不在首页加载 xterm。
- 默认 scrollback 控制在 5k 到 10k 行，可按用户设置调整上限。
- 避免大型 UI 框架和动画库；优先 CSS、少量无依赖组件。
- WebSocket 输出批量写入，避免每个小 chunk 都触发 React state 更新。
- 可选 WebGL 渲染，不默认依赖 GPU。

后端：

- WebSocket 禁用或谨慎启用 `permessage-deflate`，避免 CPU 与内存放大。
- 每用户、每 IP、每节点设置会话数上限。
- 设置 idle timeout、最大连接时长、最大待发送缓冲区。
- 设置断线恢复 TTL 和输出回放缓冲上限，避免恢复能力变成无界内存占用。
- 对 SSH 输出做 backpressure，浏览器慢消费时主动降速或断开。
- 默认不保存完整终端输出，审计只记录元数据；如启用回放，必须单独加密、限期保留并显式告知。

## 技术选型建议

截至 2026-06-23 已确认的外部信息：

- Next.js 官方文档显示最新版本为 16.2.9。
- Node.js 官方下载页显示最新 LTS 为 v24.17.0，Current 为 v26.3.1；生产应用应使用 Active LTS 或 Maintenance LTS。
- xterm.js 官方 README 推荐使用 `@xterm/xterm`，当前项目中的 `xterm` 包应规划迁移。

建议：

- 前端目标：React + TypeScript + `@xterm/xterm` + `@xterm/addon-fit`，构建为静态资源。
- 短期可继续使用 Next.js，但终端应用不依赖 SSR；如果后续追求更低资源占用，可评估 Vite + React 静态前端。
- 后端短期：TypeScript Gateway + `ssh2`，快速补安全边界。
- 后端中期：抽象 `TerminalGateway` 协议与 `SshConnector` 接口，让后端可替换。
- 后端长期：如性能、单文件部署、攻击面成为主要矛盾，评估 Go/Rust 网关。
- 部署：公网只暴露反向代理 HTTPS；Gateway 监听内网或 Unix socket；SSH 节点访问走白名单网络。

## 安全规划

### 必做安全能力

- 用户认证：支持单用户 token 起步，后续接 OIDC 或反向代理认证。
- 授权：用户只能看到和连接被授权节点。
- WebSocket 鉴权：校验登录 cookie，后续补 Origin、Host、用户、节点权限和过期时间。
- 节点 allowlist：禁止未经授权的任意 host/port。
- SSH host key verification：首次录入、后续固定校验，防止中间人攻击。
- 凭证管理：密钥不提交仓库，不通过节点列表接口暴露，不写日志。
- 限流与配额：IP、用户、节点、全局连接数和失败次数限制。
- 超时：连接建立超时、认证超时、idle timeout、最大会话时长。
- 审计：记录谁在何时连接哪个节点、结果、断开原因、来源 IP；默认不记录命令内容。
- 安全响应头：CSP、X-Frame-Options 或 frame-ancestors、Referrer-Policy、HSTS。

### 攻击面收敛

- 删除或默认关闭自定义密码连接。
- 节点列表只返回别名、标签和必要展示字段，真实 host 可按权限决定是否展示。
- Gateway 不提供文件浏览、命令执行 API、任意端口代理和任意 TCP 转发。
- 所有管理 API 与终端 Gateway 分权，避免一个 WebSocket token 同时拥有管理权限。
- 依赖定期升级和漏洞扫描，避免使用 EOL Node.js 或过时终端包。

## 阶段路线

### M0：规划与安全基线

目标：把原型整理成可继续开发的安全方向。

- 完成功能规划文档和 worklog。
- 明确自定义 SSH 连接默认关闭策略。
- 定义前后端协议草案。
- 明确节点配置、凭证、审计、会话限制的边界。
- 完成前后端目录拆分、单用户认证、白名单、保活和输入缓冲的原型实现。

验收：

- 文档中能回答“做什么、不做什么、为什么安全、怎么扩展”。

### M1：公网可部署 MVP

目标：最小安全闭环。

- 增加登录或反向代理认证接入。
- 增加 WebSocket Origin 校验和更严格 session token。
- 增加节点授权、连接限流、idle timeout。
- 增加 SSH host key 校验。
- 隐藏敏感节点字段。
- 禁用普通用户自定义 SSH 连接。
- 增加基础审计日志。

验收：

- 未登录无法获取节点或建立终端。
- 未授权节点无法连接。
- WebSocket 不能绕过 HTTP 会话创建直接初始化 SSH。
- 连接失败、超时、断开都有可观察日志。

### M2：AI CLI 优化

目标：Claude Code 与 Codex CLI 在浏览器终端里稳定可用。

- 迁移到 `@xterm/xterm`。
- 完善快捷键、粘贴、resize、bell、Unicode、鼠标模式。
- 增加 tmux 会话创建/恢复入口。
- 增加页面刷新/意外断开后的后端会话恢复和输出回放。
- 增加 Claude/Codex 环境健康检查。
- 增加大段粘贴确认与分块发送。
- 增加断线重连到同一后端会话的能力。

验收：

- 能在 Web 终端中连续使用 `claude` 和 `codex` 完成多轮交互。
- 页面刷新后可恢复到同一后端 SSH 会话，并回显缓冲输出。
- 页面刷新后可恢复到同一 tmux 会话。
- 长输出不会明显卡死浏览器或导致后端内存持续增长。

### M3：前后端拆分与可替换网关

目标：从原型结构演进为可维护架构。

- 拆分 Web Frontend、Terminal Gateway、shared protocol。
- 前端不依赖后端实现细节。
- Gateway 封装 SSH connector 与 session manager。
- 管理 API 与终端 API 分离。
- 引入 e2e 测试和协议兼容测试。

验收：

- 替换 Gateway 实现时，前端无需改动或只改配置。
- 协议测试覆盖 init/input/output/resize/status/error/close。

### M4：运维与企业能力

目标：面向长期部署和团队使用。

- 节点分组、角色权限、审计查询。
- SSO/OIDC、MFA 或外部认证代理。
- 凭证轮换、短期 SSH certificate。
- 会话指标、告警、导出。
- 可选终端回放，默认关闭。
- 多实例 Gateway 与会话路由。

验收：

- 管理员可追踪节点访问。
- 凭证轮换不需要改代码。
- 单实例故障不会影响全部节点管理能力。

## 待确认问题

- 项目是单人自用、团队内网使用，还是公网多用户使用？
- 是否必须保留用户输入任意 SSH 目标的能力？
- 节点凭证由谁维护：项目配置、系统密钥目录、Vault，还是 SSH certificate？
- 是否需要记录完整终端回放？如果需要，保留多久，谁可以查看？
- 目标部署环境是 Docker、systemd、Kubernetes，还是现有服务器进程？
- 是否需要支持移动端浏览器，还是只面向桌面浏览器？
- Claude Code/Codex CLI 是已经安装在目标节点上，还是面板需要提供环境引导？

## 参考资料

- Next.js Docs: https://nextjs.org/docs
- Node.js Releases: https://nodejs.org/en/about/previous-releases
- xterm.js README: https://github.com/xtermjs/xterm.js
- Claude Code Overview: https://code.claude.com/docs/en/overview
- Claude Code Permissions: https://code.claude.com/docs/en/permissions
- Claude Code Security: https://code.claude.com/docs/en/security
- Claude Code CLI Reference: https://code.claude.com/docs/en/cli-reference
- Codex Manual: https://developers.openai.com/codex/codex-manual.md
