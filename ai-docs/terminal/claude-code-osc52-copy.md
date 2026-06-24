---
keywords:
  - terminal
  - claude-code
  - osc52
  - clipboard
core_features:
  - 支持 Claude Code CLI 通过 OSC 52 写入浏览器剪贴板
  - 保持复制逻辑在前端 terminal 边界内处理
---

# Claude Code CLI OSC 52 复制支持

## 原始需求

- 在 webTerminal 中运行 Claude Code CLI 时，选中文字后 CLI 提示已通过 OSC 52 发送复制内容，但系统剪贴板没有更新。

## 业务流程

1. Claude Code CLI 在远程 SSH 会话内发出 OSC 52 剪贴板序列。
2. 前端 xterm 接收输出流并通过 OSC 52 handler 拦截剪贴板 payload。
3. 前端解析 base64 文本后优先调用浏览器 Clipboard API 写入系统剪贴板。
4. Clipboard API 不可用或被拒绝时，使用隐藏 textarea 执行浏览器原生复制回退。

## 边界

- 复制功能仅在前端 terminal 组件内处理，不改 WebSocket 协议和 SSH 后端。
- 不处理 OSC 52 查询请求。
- 单次 OSC 52 文本按前端上限裁剪，避免异常超大剪贴板内容影响页面。
