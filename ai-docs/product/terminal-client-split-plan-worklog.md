---
keywords:
  - webTerminal
  - TerminalClient
  - refactor
  - worklog
summary: TerminalClient.tsx 拆解执行日志，记录本次职责拆分、验证结果和保留边界。
---

# TerminalClient.tsx 拆解执行日志

## TODO

- [x] 保留 terminal 连接和 WebSocket 生命周期在 `TerminalClient.tsx` 内。
- [x] 拆出 terminal 共享类型。
- [x] 拆出快捷键 action catalog 和输入解析。
- [x] 拆出快捷键 localStorage 持久化和 schema 归一化。
- [x] 拆出 xterm buffer 文本读取。
- [x] 拆出移动端 touch scroll 兜底逻辑。
- [x] 拆出 OSC 52 剪贴板处理。
- [x] 拆出移动端 toolbar UI。
- [x] 拆出复制模式 overlay UI。
- [x] 执行类型检查、前端构建、后端构建、测试和 diff 检查。

## 已完成

### 2026-07-03

- 新增 `frontend/components/terminal/` 目录承载 terminal 前端子模块。
- `TerminalClient.tsx` 从约 1475 行收敛到约 656 行。
- `TerminalClient.tsx` 继续作为页面级编排组件，负责 target/password 状态、xterm 初始化、WebSocket 安全通道、输入缓冲、resize 和移动端控制状态组合。
- `types.ts` 统一存放 terminal target、server message 和 shortcut item 类型。
- `shortcut-actions.ts` 统一维护内置快捷键 catalog、默认项、按钮视图和发送序列解析。
- `shortcut-storage.ts` 负责 localStorage 读取、写入、version 1 兼容、version 2 归一化和自定义快捷键转义解析。
- `MobileTerminalToolbar.tsx` 负责移动端底部栏、粘贴面板和快捷键编辑面板 UI，不直接访问 xterm、WebSocket 或 localStorage。
- `TerminalCopyOverlay.tsx` 负责复制模式文本代理层 UI。
- `terminal-buffer.ts` 负责从 normal/alternate buffer 生成可选择文本。
- `touch-scroll.ts` 负责移动端单指纵向 scrollback 兜底和 DOM listener cleanup。
- `osc52-clipboard.ts` 负责 OSC 52 payload 解析和写剪贴板 fallback。
- `terminal-focus.ts` 保留 terminal 聚焦辅助函数。

## 保留边界

- 本次没有抽 `useTerminalSession`，避免同一轮改动 WebSocket 生命周期、加密队列、输入缓冲和 cleanup 顺序。
- 本次没有改变后端协议、SSH 会话管理、安全通道和现有 CSS 行为。
- 本次没有增加移动端真机自动化测试；移动端复制、粘贴、触控滚动和软键盘可见性仍需真机复验。

## 验证

- `npm run typecheck --silent`：通过。
- `npm run build:frontend --silent`：通过。
- `npm run build:backend --silent`：通过。
- `npm test --silent`：通过。
