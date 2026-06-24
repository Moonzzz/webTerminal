---
keywords:
  - terminal
  - worklog
  - password-autofill
  - scrollbar
  - ssh-utf8-decoder
  - terminal-focus
core_features:
  - Terminal 界面调整开发日志
---

# Terminal 密码与视口调整开发日志

## TODO

- [x] 定位 SSH 密码表单、Terminal 页面布局及 xterm 自适应逻辑。
- [x] 调整密码输入框自动填充语义。
- [x] 限制页面级滚动并保证终端完整渲染。
- [x] 完成类型检查、现有测试及前端生产构建。
- [ ] 完成浏览器尺寸与滚动行为验证（内置浏览器当前不可用）。
- [x] 完成功能代码自审。

## 阶段记录

### 需求分析

- `TerminalClient.tsx` 已使用密码管理器忽略属性，但 `autocomplete="off"` 仍可能被浏览器按登录密码处理。
- 页面使用 `100vh`，外层缺少明确的溢出裁剪；xterm 只监听 window resize，容器自身尺寸变化无法保证触发 `fit()`。

### 功能实现

- SSH 密码框使用一次性会话凭据的自动填充语义，增加无拼写检查/大小写转换配置，并保留密码管理器忽略标记。
- Terminal 页面固定覆盖可视区域，页面、shell、client 和 container 外层均裁剪溢出，只由 xterm viewport 提供内部滚动。
- 新增 `ResizeObserver` 监听终端容器，以动画帧合并尺寸变化后执行 `fit()` 并同步行列。
- 相关文件：`frontend/components/TerminalClient.tsx`、`frontend/app/globals.css`。

### 验证与自审

- `npm run typecheck --silent`：通过。
- `npm test --silent`：通过，1 个测试通过。
- `npm run build:frontend --silent`：通过，Next.js 生产构建及 TypeScript 校验成功。
- `npm run build:backend --silent`：通过。
- 内置浏览器连接不可用，未执行真实浏览器视口尺寸断言；保留为待验证项。
- 自审确认 ResizeObserver、动画帧、window resize listener、WebSocket 和 xterm 均在组件卸载时清理。
- 当前工作目录无 Git 元数据，无法执行 `git diff --check`。

### 浏览器复验修正

- Edge 首次复验发现 `autocomplete="new-password"` 仍会展示网站登录密码候选，未达到禁止自动填充目标。
- SSH 密码仅用于本次连接，不属于网站账户凭据；调整为 `autocomplete="one-time-code"`，字段名改为 `ssh-session-secret`，避免密码管理器按网站密码识别。
- Edge 第二次复验确认其仍会对 `type="password"` 展示已保存密码候选；改用普通文本输入配合 `-webkit-text-security: disc` 掩码，彻底隔离网站密码识别，同时保持界面不显示明文。

### Claude Code TUI 渲染修正

- 用户复验发现 Claude Code CLI 边框字符出现 `��`，底部输入区域贴边，右侧边框对齐异常。
- `ssh-connector.ts` 原先对每个 SSH data chunk 直接 `toString('utf-8')`，多字节边框字符跨 chunk 时会产生替换字符；改为 `StringDecoder` 分别处理 stdout/stderr，并在 shell close 时 flush。
- `globals.css` 将 terminal 容器底部 padding 调整为 `24px`，给全屏 TUI 底部状态/输入区留出安全距离。
- 相关文件：`backend/lib/ssh-connector.ts`、`frontend/app/globals.css`。
- 复跑 `npm run typecheck --silent && npm test --silent && npm run build:frontend --silent`：通过。
- 复跑 `npm run build:backend --silent`：通过。
- 本地开发服务已重启，监听 `http://localhost:3000`。

### 终端自动聚焦

- 用户要求 SSH 密码输入完成后自动聚焦到 terminal，避免手动点击后才能输入命令。
- `TerminalClient.tsx` 新增 `focusTerminal`，在 xterm open、WebSocket open、收到 session 消息后通过 `requestAnimationFrame` 调用 `term.focus()`。
- 相关文件：`frontend/components/TerminalClient.tsx`。
- `npm run typecheck --silent && npm run build:frontend --silent`：通过。
