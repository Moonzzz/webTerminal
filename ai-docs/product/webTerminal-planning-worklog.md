# webTerminal 规划 worklog

## 2026-06-23

### TODO

- [ ] 确认部署场景：单人自用、团队内网、公网多用户。
- [ ] 确认是否保留自定义 SSH 连接能力。
- [ ] 确认认证方式：单用户 token、反向代理认证、OIDC/SSO。
- [ ] 确认后端演进路线：继续 TypeScript Gateway，还是规划 Go/Rust Gateway。
- [ ] 将 M1 安全基线拆成可执行开发任务。
- [ ] 规划多实例或进程重启后的持久会话恢复方案。
- [ ] 补充 SSH host key 校验、Origin 校验和连接限流。

### 已完成

- [x] 阅读当前项目结构和核心代码。
- [x] 确认当前实现包含 Next.js 页面、WebSocket SSH 转发、配置节点和自定义密码连接。
- [x] 查阅 Claude Code、Codex CLI、Next.js、Node.js、xterm.js 相关官方资料。
- [x] 编写功能规划文档，覆盖业务流程、架构边界、AI CLI 适配、安全规划、资源占用和阶段路线。
- [x] 将产品名和文档名统一为 `webTerminal`。
- [x] 增加最小内存会话恢复：页面断开或刷新后可按会话 ID 重连，并回放有限输出缓冲。
- [x] 新增最简需求清单。
- [x] 将代码拆分为 `frontend` 和 `backend` 目录。
- [x] 增加后端统一配置 `server.json`，支持 `${ENV:default}` 注入。
- [x] 增加单用户登录、WSS 鉴权、认证失败 IP 锁定。
- [x] 增加节点端口白名单，非白名单目标不可连接。
- [x] 首页连接去掉 SSH 密码输入，terminal 页面临时输入 SSH 密码。
- [x] 按节点 IP 记住上次端口和用户名。
- [x] 增加浏览器/服务端/SSH keepalive 和前端输入缓冲。
- [x] 将启动脚本改为 `node --import tsx`，避免 `tsx` CLI 临时 IPC 对受限环境的依赖。

### 关键判断

- 当前项目是可用原型，但缺少公网部署必要的认证、授权、审计、限流和 SSH host key 校验。
- 任意自定义 SSH 连接会扩大 SSRF、内网探测和凭证泄漏风险，公网部署时应默认关闭或仅管理员启用。
- Claude Code 与 Codex CLI 的核心适配点不是深度集成 API，而是保证浏览器终端的 TUI 兼容、tmux 恢复、快捷键、粘贴和长会话稳定性。
- 前后端解耦应先从协议边界开始，避免前端依赖 `ssh2` 或某个后端实现。
- 当前会话恢复为单进程内存能力，可覆盖刷新和短暂断线；进程重启、多实例漂移和持久终端回放仍需后续设计。
- 当前认证为单用户 cookie 认证，可覆盖短期自用部署；多用户授权、SSO、审计和细粒度节点权限仍需后续设计。

### 相关文件

- `requires.md`
- `webTerminal-planning.md`
- `webTerminal-planning-worklog.md`
- `server.json`
- `server.ts`
- `auth.ts`
- `config.ts`
- `http-api.ts`
- `ws-server.ts`
- `ssh-session.ts`
- `TerminalClient.tsx`
- `page.tsx`
