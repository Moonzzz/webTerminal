---
keywords:
  - webTerminal
  - mobile terminal
  - runtime E2E
  - frontend architecture
  - Playwright
summary: 移动端 terminal 架构收敛与运行时 E2E 修复方案，目标是删除源码 harness、减少测试污染，并通过真实页面运行时验证核心交互。
---

# 移动端 Terminal 架构收敛与运行时 E2E 修复方案

## 原始目标

本轮修复目标：

- 保证移动端 terminal 功能符合预期。
- 让代码结构更优雅，职责独立、边界清晰。
- 避免测试 harness 污染业务源码，减少维护成本和上下文负担。
- 修复移动端 E2E 当前依赖 dev server watcher、容易出现 `EMFILE` 超时的问题。

## 已确认边界

- 删除源码内 `/terminal/test-harness` 页面、测试 harness 组件和后端测试页放行逻辑。
- E2E 只走真实 `/login`、首页和 terminal 页面。
- 测试辅助逻辑只能放在 `e2e/`、Playwright 配置或外部测试夹具中。
- 业务源码不挂 `window.__terminalTestMetrics` 等测试全局变量。
- 不为了测试加入 synthetic wheel 补偿或改变生产运行行为。
- 不改变 WebSocket 协议、安全通道协议或 SSH session manager。
- 不重写已真机验证过的 `touch-scroll` 核心手势算法。

## 架构拆分

### TerminalClient 编排层

`TerminalClient` 保留页面级编排职责：

- 读取 stored target。
- 管理 SSH 密码、复制模式、粘贴面板、快捷键编辑面板等 UI 状态。
- 组合 terminal container、移动端 toolbar、复制 overlay 和密码面板。

它不再直接承载大段 xterm/WebSocket/session 生命周期闭包，也不直接实现 visualViewport 监听。

### 终端布局与高度余量

- 页面由 CSS 占满可用视口，`terminal-client` 使用 Grid 为终端和移动端工具栏分配空间。
- `terminal-container` 无内边距，作为 FitAddon 的测量区域，内部使用纵向 Flex。
- xterm 按整数行自然高度显示且不收缩；下方通过 `::after` 生成透明弹性块，承接不足一行的剩余高度。
- 不增加固定底部留白、额外包装层或手动像素高度计算；透明块不参与鼠标交互。
- 容器的 ResizeObserver 是布局变化触发 fit 的唯一持续入口；通过 requestAnimationFrame 合并调用。
- xterm 的 `onResize` 在行列数实际变化后通知 SSH，初始化期间的尺寸变化在 init 后补齐。

### useTerminalSession

新增 terminal session hook，封装：

- xterm 和 FitAddon 初始化。
- OSC 52 注册。
- WebSocket、安全通道、输入缓冲、keepalive。
- resize/refit 与后端 resize 消息。
- ResizeObserver、timer、listener、WebSocket 和 xterm cleanup。

对上层暴露语义接口：

- `containerRef`
- `sendShortcutItem(item, options?)`
- `pasteText(text)`
- `focusTerminal()`
- `readCopyText()`

内部保留现有 `pendingInput`、`sendQueue`、`receiveQueue`、`disposed` 和 cleanup 顺序，避免拆分协议细节时引入重复连接或释放顺序问题。

### useTerminalViewport

新增 viewport hook，统一处理：

- 监听 `window.visualViewport.resize` 和 `window.visualViewport.scroll`。
- 向 `.terminal-page` 写入 `--terminal-visual-viewport-top`、`--terminal-visual-viewport-height`、`--terminal-visual-viewport-width`。
- 仅处理移动端可视视口的 CSS 变量兜底；容器尺寸变化由 ResizeObserver 感知，不直接触发 fit。
- 卸载时清理 CSS 变量和 listener。

生产代码只保留这一份 viewport 逻辑，避免页面和测试组件复制实现。

### touch-scroll adapter

`touch-scroll` 保持当前 touch-to-wheel 行为，但收敛依赖边界：

- 将 xterm DOM 类名查询隔离到 `getXtermScrollTarget()` 或 adapter 内。
- 对外保留安装/清理模型：`setupMobileTouchScroll(...)` 返回 `dispose()`。
- 明确职责只包括：忽略 toolbar/input/selection、将 terminal 垂直 touch 转为 xterm wheel、阻止页面滚动或下拉刷新接管。
- 不继续追加软键盘布局、toolbar 交互或复杂拟真惯性职责。

## 运行时 E2E 方案

### 测试入口

移动端 E2E 走真实用户路径：

1. 打开 `/login`。
2. 使用测试环境账号登录。
3. 在首页输入 allowed target。
4. 进入 terminal 页面。
5. 在真实页面上执行 viewport、toolbar、touch 和 terminal 行为断言。

### 测试夹具

- 测试账号、端口、allowed target 通过 env 注入。
- E2E server 不直接使用 watcher 型 `npm run dev`，避免 Next watcher 文件句柄问题。
- 完整 terminal 输出、scrollback 和 resize 通过外部 SSH fixture 或等价运行时夹具验证。
- 夹具代码放在 `e2e/` 或测试脚本中，不进入 `frontend/` 业务源码。

### 覆盖场景

- 登录后可进入真实 terminal 页面。
- 移动端 toolbar 不遮挡 terminal。
- 快捷栏可横向滑动，拖动不误触快捷键。
- tap 快捷键走真实 terminal 输入路径。
- viewport resize 后 xterm refit。
- terminal 区域 touchmove 不导致页面滚动。
- 外部 fixture 覆盖 terminal 输出、scrollback 和 resize。

系统软键盘、Edge/Chrome 下拉刷新和惯性体验仍需要真机 checklist 补充，因为浏览器模拟不能完整复现系统键盘和浏览器手势。

## 清理项

- 删除源码 test harness。
- 删除后端 E2E 测试页放行。
- 删除测试运行时全局变量和 synthetic 行为补偿。
- 移除固定本机 dev origin。
- 移除个人 `.codex` 配置。
- E2E 配置和 fixture 通过 env 管理，不污染生产路径。

## 验收标准

- `TerminalClient` 明显变薄，主要负责编排。
- visualViewport 逻辑只有一份实现。
- `touch-scroll` 的 xterm 内部 DOM 依赖被局部隔离。
- 业务源码没有测试专用页面、测试全局变量或测试补偿行为。
- `npm run typecheck` 通过。
- `npm test` 通过。
- `npm run test:e2e:mobile` 不再因 dev server watcher/`EMFILE` 超时。
- 移动端 E2E 覆盖真实页面上的 toolbar 横滑、tap 快捷键、viewport resize 和 terminal 区域阻止页面滚动。
- 完整 terminal 输出、scrollback、resize 由外部 fixture 或后续明确测试项覆盖，不再依赖源码 harness。
