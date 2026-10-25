---
keywords:
  - webTerminal
  - requirements
  - SSH
  - terminal
summary: webTerminal 最简核心需求点。
---

# webTerminal 需求点

- 浏览器 SSH 终端：用户输入 host、port、username，后端只允许连接 allowList 命中的目标。
- 单用户认证：页面和 `/ws/terminal` 都必须登录，失败过多锁定来源 IP。
- 安全通道：登录、会话补发和 WebSocket 业务帧需加密、加签、防重放。
- SSH 密码：仅在 terminal 页面临时输入，不持久化、不进 URL、不写日志。
- 会话恢复：刷新或断线后在恢复窗口内重连原 SSH 会话，通过服务端终端状态快照恢复当前屏幕与有限滚动历史，并接收后续实时输出。
- 保活与弱网：浏览器、WebSocket、SSH 保活；前端输入缓冲，连续输入不被发送延迟阻塞。
- AI CLI 适配：稳定支持 Claude Code、Codex CLI、tmux 等 TUI/CLI，包含 resize、UTF-8、复制和快捷键场景。
- 终端体验：页面简洁，terminal 占满视口，仅保留 xterm 内部滚动，SSH 密码提交后自动聚焦。
- 节点记忆：按 host 记住上次 port 和 username。
- 配置统一：后端配置集中在配置文件中，支持环境变量注入。
- 架构边界：前后端目录分离，后端按 API、WSS、会话、SSH 连接职责拆分。
- 低资源部署：生产运行只保留必要依赖和构建产物，Docker 镜像面向 `linux/amd64`。
- 公网安全：生产必须补齐 TLS/WSS、默认凭据拒绝、Origin/Host 校验、SSH host key、限流、配额、安全响应头和元数据审计。
