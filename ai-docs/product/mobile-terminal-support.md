---
keywords:
  - webTerminal
  - mobile terminal
  - shortcut bar
  - clipboard
  - touch scroll
summary: webTerminal 移动端 terminal 支持方案探索，覆盖底部快捷键栏、本地持久化、自定义快捷键、触控滚动和原生复制粘贴能力。
---

# 移动端 Terminal 支持

## 原始需求

在 terminal 页面增加移动端支持：

- 页面底部增加快捷键栏。
- 默认快捷键包含 Tab、Esc、Ctrl+C 和方向键。
- 支持用户自定义快捷键栏，并持久化到浏览器本地。
- 移动端下支持自然上下滑动 terminal。
- 支持 terminal 文字复制和粘贴，不支持剪切。
- 复制优先使用 xterm 自带移动端选择能力，在 terminal 中长按/拖选后复制。
- 粘贴通过长按输入框触发移动端原生文字编辑菜单。

## 实现状态

2026-07-01 已完成第一版前端实现：

- 移动端底部快捷键栏默认包含 `Tab`、`Esc`、`Ctrl+C` 和方向键。
- 快捷键栏支持从内置动作集合中启用/禁用、排序和恢复默认。
- 快捷键栏支持用户新增自定义按钮，保存按钮名称和发送内容。
- 快捷键配置持久化到 localStorage，key 为 `webTerminal-terminal-shortcuts`。
- 快捷键发送统一走 xterm `input()`，方向键兼容 application cursor mode。
- 移动端 terminal 使用底部栏占位布局，工具栏和面板不会覆盖最后一行。
- 增加移动端纵向触摸滚动兜底，长按、已有选区、横向手势和多指手势不会被滚动逻辑接管。
- 复制不增加自定义按钮，不提供剪切入口，优先保留 xterm 自带 selection/copy 能力。
- 粘贴通过真实 textarea 承接系统原生文字编辑菜单，发送时调用 xterm `paste()`。

仍需真机确认：

- iOS/Android 浏览器中长按/拖选 terminal 是否能稳定走 xterm 自带选择和复制流程。
- 若目标移动浏览器无法稳定复制，再评估是否启用 xterm buffer 文本代理层降级方案。

当前验证：

- `npm run typecheck` 通过。
- `npm run build:frontend` 通过。
- `npm run build:backend` 通过。
- 生产模式本地服务可启动到 `http://127.0.0.1:3001`，未登录访问 terminal 页面会跳转 `/login`。
- 当前浏览器插件无可用实例，尚未完成自动化移动端截图和点击验证。

2026-07-03 已按推荐路径修复移动端复制：

- 移动端 toolbar 增加“选择”入口。
- terminal 区域移动端长按可进入复制模式。
- 复制模式按需从 xterm buffer 生成可选择 DOM 文本层，使用移动端系统原生选择/复制菜单，不主动读取剪贴板。
- 普通 buffer 复制 scrollback 文本，alternate buffer 复制当前可见区域。
- 软键盘行为不做 `visualViewport` 大改；恢复移动端 terminal 底部 24px 预留间隔，尽量保留修改前键盘弹出时的可见性。

2026-07-06 已按用户真机反馈继续修复移动端软键盘：

- `layout.tsx` 增加 viewport 配置：`width=device-width`、`initial-scale=1`、`viewport-fit=cover`、`interactive-widget=resizes-content`。
- 移动端 `visualViewport` 键盘 inset 手动顶起方案经真机反馈仍会产生大段空白，已回退。
- terminal 页面不再按键盘 inset 叠加 bottom 补偿；改为使用 `visualViewport.height` 约束页面真实可视高度，Android Chrome 仍优先依赖 `interactive-widget=resizes-content` 缩小内容区。
- 快捷栏保留为 terminal client 底部 grid 区域，软键盘弹出时作为纯 Web 模拟附件栏停在键盘上方。
- terminal client 移动端布局从 flex 改为两行 grid，terminal 和快捷栏各占独立行，避免快捷栏覆盖底部 terminal 内容。
- 快捷键按钮在移动端 touch tap 阶段发送输入，拖动时让快捷栏横向滚动，避免点击 Tab、Esc、Ctrl+C 或方向键时关闭软键盘。
- 快捷键栏横向拖动保留手动 scroll，并避免拖动结束误触发送快捷键。
- Edge 移动端反馈后，terminal 区域禁用页面级触摸滚动和 overscroll，下拉刷新不再接管 terminal 内上下拖动。
- `visualViewport` 变化时同步更新可视宽度并触发 xterm fit/resize，避免键盘弹出后 terminal 列宽沿用旧值。
- terminal 页面顶部栏已移除，terminal 区域直接占满页面主体。

## 已确认现状

当前 terminal 页面实现集中在 `TerminalClient.tsx`：

- 前端使用 Next.js、React、TypeScript、`@xterm/xterm` 和 `@xterm/addon-fit`。
- terminal 页面是固定全屏布局，`.terminal-page`、`.terminal-shell`、`.terminal-client`、`.terminal-container` 都倾向于页面级不滚动。
- xterm 初始化后通过 `term.onData` 收集输入，16ms 批量 flush 到 WebSocket。
- 后端只接收终端输入字节和 resize 事件，因此快捷键、粘贴等都可以复用现有输入通道，不需要改后端协议。
- 已有 OSC 52 handler：远端程序输出 OSC 52 时，前端可写入浏览器剪贴板。
- 首页已有 localStorage 使用模式，按 host 保存端口和用户名记忆。
- xterm 公开 API 支持 `getSelection`、`clearSelection`、`selectAll`、`scrollLines`、`scrollToBottom`、`paste` 和 `modes.applicationCursorKeysMode`。
- xterm 已有内部 selection/copy 机制：桌面端拖选不是普通网页文本 selection，而是 xterm 根据坐标维护选区，并在 copy 事件中写入选中文本。
- 本地 xterm SelectionService 主要围绕鼠标事件实现，未确认目标移动浏览器上的长按/拖选行为，需要在真机或移动端模拟环境优先验证。

## 推荐方案

### 1. 移动端底部快捷键栏

在 terminal 页面底部增加移动端专用工具栏，桌面端默认隐藏：

- 默认按钮：`Tab`、`Esc`、`Ctrl+C`、`Up`、`Down`、`Left`、`Right`。
- 常用扩展动作可进入自定义面板选择：`Ctrl+D`、`Ctrl+Z`、`Ctrl+L`、`Ctrl+U`、`Enter`、`Backspace`、`Home`、`End`、`PgUp`、`PgDn`。
- 用户可新增自定义按钮，填写按钮名称和发送内容，发送内容进入 terminal 时走 xterm `input()`。
- 自定义发送内容支持常见转义写法：`\n`、`\r`、`\t`、`\e`、`\xNN`。
- 粘贴输入框作为工具栏固定辅助入口提供，不混入快捷键配置。
- 工具栏固定在 terminal 底部，并适配 iOS safe-area，terminal 容器底部预留工具栏高度，避免遮挡最后一行。
- 按钮点击后重新聚焦 xterm，避免移动端软键盘/焦点状态丢失。

快捷键发送规则：

- `Tab` 发送 `\t`。
- `Esc` 发送 `\x1b`。
- `Ctrl+C` 发送 `\x03`。
- 方向键根据 xterm 当前模式发送：
  - 普通模式：`ESC [ A/B/C/D`。
  - application cursor mode：`ESC O A/B/C/D`。
- `Home`、`End`、`PgUp`、`PgDn` 使用常见 VT 序列；后续实现时应统一放入 action catalog，不散落在 JSX 里。
- 对需要进入远端程序的数据，优先走 xterm 的输入路径，保持和物理键盘输入一致。

### 2. 用户自定义与本地持久化

使用 localStorage 保存快捷键栏配置，建议 key 为 `webTerminal-terminal-shortcuts`。

配置使用版本化 JSON，避免后续 schema 升级困难：

```json
{
  "version": 2,
  "items": [
    { "type": "built-in", "actionId": "tab" },
    { "type": "built-in", "actionId": "esc" },
    { "type": "custom", "id": "custom-1", "label": "ll", "input": "ls -la\r" }
  ]
}
```

实现规则：

- 首次进入或解析失败时回退默认配置。
- 内置动作只持久化 action id，读取后用内置 action catalog 过滤，丢弃未知项。
- 用户自定义动作只保存名称和发送内容，读取时做类型、长度和空值过滤。
- 自定义面板支持内置项启用/禁用、全部项排序、删除自定义项、恢复默认。
- 兼容旧版 `version: 1` 的 action id 数组配置。

### 3. 移动端自然上下滑动

推荐采用“CSS 适配 + 触摸兜底”的组合：

1. CSS 层：
   - 对 xterm viewport 增加 `-webkit-overflow-scrolling: touch`。
   - 对 terminal 区域设置 `overscroll-behavior: contain`，避免浏览器页面回弹影响终端。
   - 移动端工具栏出现时，通过 CSS 变量控制 terminal 底部 padding。

2. 触摸兜底：
   - 在 terminal 容器上监听单指 `touchstart`/`touchmove`。
   - 根据垂直位移换算行数并调用 `term.scrollLines`。
   - 使用 `term.rows` 和容器高度估算单行高度，保留小数累积，保证慢速滑动不会丢行。
   - 多指触控、明显横向滑动、正在使用 xterm 选择或粘贴输入框时不接管。

这样可以维持页面本身不滚动，同时让用户手势控制 xterm scrollback。

### 4. 复制与粘贴

复制：

- 不再提供自定义“复制/剪切”工具栏动作，复制入口优先使用 terminal 内容上的长按/拖选。
- 第一优先级是 xterm 自带选择能力：保留 xterm selection/copy 机制，尽量让移动端长按、拖动选择、系统复制菜单或浏览器 copy 事件走 xterm 现有流程。
- 实现时先不要新增 DOM 文本代理层；先处理会干扰移动端选择的样式和触摸事件，例如 touch scroll 兜底不能吞掉已经进入选择的手势。
- 若目标移动端无法稳定使用 xterm 自带选择，再启用降级方案：从 xterm buffer 生成可选择 DOM 文本代理层，让系统原生选择/复制菜单接管。
- 前端不主动调用 `navigator.clipboard.writeText` 作为主要复制路径。
- OSC 52 handler 保留，用于远端程序主动写入浏览器剪贴板。

剪切：

- terminal 不提供剪切能力。
- 不把“复制后清除 selection”伪装为剪切。
- 若后续需要清空当前命令行，应作为快捷键动作发送 `Ctrl+U`，不归入剪切板能力。

粘贴：

- 不再通过工具栏按钮直接调用 `navigator.clipboard.readText`。
- 移动端提供一个真实文本输入框作为粘贴入口，可以由工具栏按钮或 terminal 长按空白/输入区域唤起。
- 用户长按该输入框时，使用移动端系统原生文字编辑菜单执行粘贴。
- 用户确认发送后，前端调用 `term.paste(text)`，保留 xterm 的换行归一化和 bracketed paste 行为。
- 发送后清空并收起输入框，重新聚焦 terminal。
- 大段粘贴确认、分块发送可沿用规划中的后续 TODO，本功能第一版先复用现有输入缓冲和 WebSocket backpressure。

## 建议实现边界

第一阶段已只改前端：

- `TerminalClient.tsx`：接入 toolbar、快捷键发送、触摸滚动、xterm selection 适配和粘贴输入框。
- 移动端工具栏、自定义面板和粘贴输入框当前以内聚子组件方式放在 `TerminalClient.tsx` 中。
- 文本代理层只作为 xterm 移动端选择验证失败后的降级组件，不作为第一版默认实现。
- `globals.css`：补充移动端布局、工具栏、安全区域、xterm touch scroll 样式。
- `ai-docs`：同步记录功能实现和验证结果。

暂不改：

- 后端 WebSocket 协议。
- SSH 会话管理。
- 安全通道协议。
- 终端输出处理。

## 风险与待确认点

- xterm 的移动端选择能力需要实测确认；如果目标浏览器不能稳定触发 xterm 选区和复制事件，才考虑文本代理层。
- 2026-07-03 已在移动端实测发现：terminal 内容长按没有弹出移动端原生选择组件，说明仅依赖 xterm 当前选择能力不能满足移动端复制需求。
- 本地 xterm 6.0.0 源码显示 selection 主入口是 `mousedown`，且 `SelectionService.handleMouseDown` 会 `preventDefault()` 阻止浏览器原生文本选择；`.xterm` 默认 `user-select: none`。因此移动端原生长按菜单不出现是预期风险，不是单纯样式遗漏。
- 文本代理层是降级方案，文本来自 xterm buffer，可能无法 100% 还原复杂 TUI 的二维布局和样式。
- 粘贴依赖真实输入框的系统原生菜单，不依赖 Clipboard API `readText` 权限。
- xterm 选择、触摸滚动和粘贴输入框手势存在冲突，需要用长按阈值、移动距离阈值和选择状态隔离。
- 方向键必须兼容 application cursor mode，否则 vim、tmux、部分 TUI 中可能失效。
- 底部工具栏会改变 terminal 可用高度，必须触发 `fitAddon.fit()` 并同步 resize 到后端。
- 移动端软键盘弹出时，当前 fixed 全屏布局只跟随 layout viewport；iOS/Android 浏览器通常需要监听 `window.visualViewport` 才能让 terminal 可视区域跟随键盘上移。
- 2026-07-06 真机反馈显示 `visualViewport` 手动布局补偿会造成过大空白，已回退该补偿。
- 工具栏按钮不要使用 `<button>` 默认 submit 行为，避免嵌套表单或未来扩展时误触。
- 用户自定义快捷键允许保存任意终端输入文本，可能产生误执行命令风险；UI 仅做长度和格式限制，不替用户判断命令安全性。

## 2026-07-03 修复探索

### 问题 1：移动端长按 terminal 无法选择复制

已确认现象：

- 移动端在 terminal 内容上长按没有弹出系统原生选择组件。
- xterm 内部 selection/copy 机制在桌面鼠标拖选可用，但不等价于浏览器 DOM 文本选择。
- xterm 默认 `.xterm { user-select: none }`，SelectionService 通过鼠标事件维护内部选区，并在 `copy` event 中写 clipboard；移动端原生选择菜单需要可选择 DOM 文本或输入控件。

可选方案：

1. 保守降级：增加“复制模式”DOM 文本代理层。
   - 入口：移动端长按 terminal 空白/内容区域，或工具栏增加“选择”按钮。
   - 行为：从 xterm buffer 读取可见区或 scrollback 文本，渲染为覆盖层 `<pre>`，设置 `user-select: text` 和 `-webkit-user-select: text`。
   - 用户在覆盖层中使用系统原生长按选择、拖动手柄、复制菜单。
   - 关闭覆盖层后回到 xterm。
   - 优点：最符合“移动端原生菜单选择&复制”诉求，不依赖 Clipboard API 权限。
   - 缺点：覆盖层文本来自 buffer，复杂 TUI 的二维布局和隐藏/宽字符可能不能 100% 还原。

2. 尝试 xterm 内部 selection + 自定义复制按钮。
   - 长按时用坐标调用 xterm `select()` 或 `selectLines()`，显示自定义浮层按钮“复制”。
   - 点击按钮读取 `term.getSelection()` 并调用 Clipboard API 或隐藏 textarea fallback。
   - 优点：能复用 xterm selection 文本。
   - 缺点：不是移动端原生选择组件；Clipboard API 权限不稳定；与用户最新诉求不完全一致。

3. 开启/复用 xterm accessibility tree。
   - xterm CSS 中 accessibility tree 是 DOM 文本且 `user-select: text`。
   - 但默认 `screenReaderMode` 未开启，且 accessibility tree 主要服务读屏，存在 `pointer-events: none`、透明选区等约束。
   - 不建议作为第一优先级，除非实测能稳定触发原生选择且不影响渲染/性能。

推荐：

- 将原“文本代理层降级方案”提升为移动端复制主方案。
- 不再把 xterm 内建移动端选择作为唯一复制路径；仍保留桌面端 xterm 拖选复制。
- 代理层只在移动端/复制模式打开时挂载，不常驻，减少性能和交互风险。

实施状态：

- 已实现移动端复制模式。
- 入口包括 toolbar “选择”按钮和 terminal 区域长按。
- 复制模式使用 `<pre>` 展示 xterm buffer 文本，启用 `user-select: text` 和 `-webkit-user-select: text`。
- 关闭复制模式后重新聚焦 xterm。

### 问题 2：软键盘弹出后界面没有上移

已确认现状：

- terminal 页面使用 fixed 全屏布局，`.terminal-page` 固定 `inset: 0`，内部高度来自 layout viewport。
- 移动端软键盘弹出时，layout viewport 可能不变，可视区域由 `window.visualViewport.height` 缩小。
- 当前代码没有监听 `visualViewport.resize/scroll`，也没有根据键盘高度调整 terminal client 高度或底部偏移。

推荐方案：

1. 在 `TerminalClient.tsx` 增加 visual viewport 适配 hook。
   - 监听 `window.visualViewport.resize` 和 `window.visualViewport.scroll`。
   - 计算 `keyboardInset = max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop)`。
   - 将 inset 写入 CSS 变量，例如 `--terminal-keyboard-inset`。
   - 键盘弹出时让 `.terminal-client` 或 `.mobile-terminal-bar` 上移/缩高。
   - 更新后调用 `fitAddon.fit()`，并向后端发送 resize。

2. CSS 配合动态 viewport 单位。
   - `.terminal-page` 可增加 `height: 100dvh` 作为现代浏览器兜底。
   - 移动端 `.terminal-client` 使用 CSS 变量控制 `height` 或 `padding-bottom`。
   - 工具栏底部 padding 从 `env(safe-area-inset-bottom)` 扩展为 `max(env(safe-area-inset-bottom), var(--terminal-keyboard-inset, 0px))` 或在容器上做 `transform: translateY(...)`。

3. 粘贴输入框聚焦时主动滚动/定位。
   - `openPastePanel()` 聚焦 textarea 后，用 `requestAnimationFrame` 调整视觉区域。
   - 如果只依赖 `focus()`，iOS Safari 常不能保证 fixed 容器中的底部输入可见。

推荐：

- 用户反馈修改前软键盘弹出时可正常显示，底部显示区域有间隔。
- 本次先不引入 `visualViewport` 大改，避免改变原本可工作的键盘布局路径。
- 已恢复移动端 `.terminal-container` 底部 24px padding，保留底部可视间隔。
- 如果真机验证仍有键盘遮挡，再单独实现 `visualViewport` 适配，并复用现有 fit/resize。

## 验证建议

- 类型检查：`npm run typecheck`。
- 构建验证：`npm run build:frontend` 或完整 `npm run build`。
- 桌面回归：terminal 页面打开、输入、resize、OSC 52 不受影响。
- 移动端视口：
  - iPhone 宽度下快捷键栏显示且不遮挡 terminal 最后一行。
  - Android/iOS 宽度下上下滑动可滚动 scrollback。
  - 横竖屏切换后 terminal rows/cols 同步。
- 快捷键：
  - Tab 补全。
  - Esc 退出模式。
  - Ctrl+C 中断命令。
  - 方向键在 shell、vim/tmux 中可用。
- 自定义：
  - 配置可保存、刷新后恢复。
  - localStorage 内容损坏时回退默认。
  - 恢复默认可用。
  - 新增用户自定义按钮后可显示、发送、排序和删除。
- 复制/粘贴：
  - 优先验证长按/拖选 terminal 可使用 xterm 自带选择能力完成复制。
  - xterm 选择不影响正常 terminal 输入和滑动。
  - 只有 xterm 移动端选择验证失败时，才启用文本代理层降级。
  - 不出现剪切入口。
  - 长按粘贴输入框可唤起系统原生粘贴菜单。
  - 粘贴单行、多行文本后通过 `term.paste` 输入 terminal。
