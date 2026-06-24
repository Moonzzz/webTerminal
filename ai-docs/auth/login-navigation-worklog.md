---
keywords:
  - login
  - websocket
  - hmr
  - worklog
summary: 登录页无法 hydration 和跳转问题的修复记录。
---

# 登录后跳转主页面 worklog

## 2026-06-25

### TODO

- [x] 定位登录页未发起请求而执行原生刷新的原因。
- [x] 修复终端 WebSocket 与 Next.js HMR 的 Upgrade 冲突。
- [x] 增加非终端 Upgrade 回归测试。
- [x] 验证 HMR、终端 WebSocket、登录跳转和生产构建。
- [x] 完成代码自我审查。

### 已完成

- [x] 修复前实测 `/_next/webpack-hmr` 返回 400。
- [x] 终端 WebSocket 改为 `noServer`，只处理 `/ws/terminal`。
- [x] 非终端 Upgrade 不再被终端服务写入或关闭。
- [x] 修复后 Next.js HMR 返回 101。
- [x] 终端 WebSocket 仍能握手，未登录连接按预期关闭为 1008。
- [x] 浏览器实际登录后首页返回 200，确认请求和跳转恢复。
- [x] 测试、类型检查和生产构建通过。
- [x] 回退登录流程封装、会话二次校验、开发缓存和文件上限等无关改动。

### 相关文件

- `backend/lib/ws-server.ts`
- `tests/ws-server.test.ts`
- `package.json`
