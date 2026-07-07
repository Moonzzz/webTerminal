---
keywords:
  - webTerminal
  - mobile terminal
  - regression test
  - touch scroll
  - soft keyboard
  - Playwright
summary: 移动端 terminal 软键盘、快捷栏和触摸滚动反复回归的原因分析，以及自动化端到端测试方案。
---

# 移动端 Terminal 回归原因与 E2E 测试方案

## 背景

本轮修复从“软键盘弹出时快捷栏应停在键盘上方”开始，连续影响了：

- terminal 内容底部是否被快捷栏遮挡。
- 快捷栏横向滑动。
- terminal 宽度和 xterm refit。
- terminal 内上下触摸滑动。
- Edge 移动端下拉刷新。
- terminal 滑动速度和惯性。

这些不是独立问题，而是同一个移动端交互面上的强耦合点。

## 为什么影响如此大

### 1. 软键盘改变的是整个视口模型

移动端浏览器至少有三套相关尺寸：

- layout viewport：CSS `100vh`、fixed 布局常依赖它。
- visual viewport：软键盘弹出后真实可见区域通常由它表示。
- xterm fit 尺寸：由 terminal 容器实际像素宽高决定。

本项目 terminal 页是 fixed 全屏布局。软键盘弹出时如果只改其中一个层面，就容易出现：

- 快捷栏位置正确，但 terminal 没有重新 fit。
- terminal 高度正确，但宽度仍沿用旧列数。
- 页面高度跟随 visual viewport 后，底部快捷栏从 overlay 变成布局参与者，影响 terminal 可用高度。

### 2. 快捷栏既是布局元素，也是触摸手势区域

快捷栏承担两个职责：

- 作为键盘上方模拟附件栏参与页面布局。
- 作为横向滚动条和快捷键按钮处理 touch/click。

为了防止点击按钮关闭软键盘，曾在按下阶段阻止默认行为；这会直接影响横向滚动。后续改为 touchend tap 发送，才恢复横滑。

### 3. xterm 的滚动不是普通 DOM 文本滚动

xterm 6 的 DOM 结构中：

- `.xterm-screen`/canvas 是用户主要触摸命中区域。
- `.xterm-scrollable-element` 是 xterm 内部滚动系统。
- `.xterm-viewport` 存在，但单纯把它当作普通原生滚动容器并不可靠。

因此三种方案表现差异很大：

- `term.scrollLines()`：稳定但按行滚动，慢且没有惯性。
- 依赖 `.xterm-viewport` 原生触摸滚动：在当前 DOM 命中路径下真机不可滑动。
- touch-to-wheel 派发给 `.xterm-scrollable-element`：能恢复 xterm 内部滚动链路，但速度和惯性需要参数调校。

### 4. 防下拉刷新和 terminal 滑动是同一批事件

Edge 移动端的下拉刷新也监听垂直触摸。terminal 内滑动、防页面滚动、防下拉刷新都要争夺同一组 `touchstart/touchmove/touchend`：

- 过早 `preventDefault`：可能破坏快捷栏横滑、点击聚焦或原生滚动。
- 太晚 `preventDefault`：浏览器页面滚动或下拉刷新接管。
- `touch-action` 设置错误：可能让浏览器忽略 JS 兜底，或让终端完全不可滑动。

### 5. 过去缺少移动端交互回归测试

现有验证以 `typecheck`、构建和后端单测为主，无法覆盖：

- 软键盘后 visual viewport 变化。
- touch 手势方向竞争。
- xterm 内部滚动是否发生。
- 快捷栏横向滚动是否仍可用。
- 触摸速度/惯性是否在可接受范围。

所以每次修一个点，只能靠真机反馈发现另一个回归。

## 自动化测试目标

E2E 不要求完全替代真机，但要自动守住关键行为：

- terminal 容器在移动端布局下不被快捷栏遮挡。
- visual viewport 变化后 xterm 会 refit。
- 快捷栏能横向滚动，拖动不会误发快捷键。
- 点击快捷键会发送输入，且不触发按钮焦点抢占路径。
- terminal 内垂直拖动会导致 xterm scrollback 位置变化。
- 快速滑动比慢滑产生更强滚动输入；最终惯性距离仍需真机冒烟补充验证。
- touchmove 会阻止页面级滚动/下拉刷新接管。

## 当前策略调整

本轮问题不应继续通过复杂化 `touch-scroll.ts` 解决。真正的问题是软键盘、快捷栏和 terminal 滚动共享同一组移动端 DOM/CSS/touch 机制，而当前没有自动化回归保护。

后续优先级应调整为：

1. 先落地 Playwright 移动端 E2E harness，自动守住布局、快捷栏横滑和 terminal 滑动。
2. 再在测试保护下收敛 `touch-scroll.ts`，避免继续向其中追加复杂状态和参数。
3. `touch-scroll.ts` 的职责边界应限制为“把 terminal 区域的触摸转成 xterm 可理解的滚动输入，并阻止页面接管”，不再承担软键盘布局、快捷栏交互或过度拟真的惯性系统。

## 测试分层

### 第一层：Playwright 浏览器 E2E

目标是先自动验证真实 DOM、CSS、xterm 和手势事件链路。这一层优先级最高。

Playwright 官方支持设备模拟和移动端上下文参数，例如 `viewport`、`isMobile`、`hasTouch`。但内置 `touchscreen` API 主要覆盖 tap，复杂滑动应在页面内派发 touch events 或使用 Chrome DevTools Protocol。

建议新增脚本：

- `test:e2e:mobile`：运行移动端浏览器回归。

建议测试页面入口：

- 增加仅测试环境可用的 terminal harness 页面，例如 `/terminal/test-harness`。
- 该页面不连接真实 SSH，不需要登录和 WebSocket。
- 页面直接渲染 xterm，写入 300 行固定内容，并挂载同一套移动端布局、快捷栏和 `setupMobileTouchScroll`。
- 只在 `WEBTERMINAL_E2E=1` 时启用，生产不可访问。

为什么需要 harness：

- 现有 `/terminal/custom` 依赖登录、secure channel、WebSocket 和真实 SSH target。
- 移动端手势回归关注前端交互，不应该被 SSH 环境阻塞。
- harness 能稳定生成 scrollback，便于断言滚动是否发生。

建议断言：

- `terminal-container` 的 bottom 不与 `mobile-terminal-bar` 重叠。
- 模拟 visual viewport 变化或移动端 viewport 缩高后，terminal rows/cols 或 canvas 尺寸发生合理变化。
- 拖动 `.terminal-shortcut-scroll` 后 `scrollLeft > 0`。
- 拖动快捷栏不会触发快捷键发送计数。
- tap 快捷键会增加发送计数。
- 在 terminal 区域执行纵向 touch move 后，`.xterm-scrollable-element` 或测试指标里的 scroll position 发生变化。
- 快速滑动后的滚动输入强度大于慢滑；touchend 后的惯性距离在 headless synthetic touch 下不作为强断言。

技术细节：

- 使用 Playwright `devices['Pixel 7']` 或等价配置，启用 `isMobile: true`、`hasTouch: true`。
- 对复杂手势，优先使用 Chrome DevTools Protocol `Input.dispatchTouchEvent`，因为 Playwright 内置 `touchscreen` API 更偏向 tap。
- 也可以在 `page.evaluate` 内构造 `TouchEvent`：
  - `touchstart`
  - 多次 `touchmove`
  - `touchend`
- 记录关键指标到 `window.__terminalTestMetrics`：
  - wheel event count。
  - wheel delta sum。
  - xterm scroll event count。
  - latest viewportY 或 scrollTop。
  - shortcut sent count。
  - rows/cols 和 resize count。

已落地实现：

- `test:e2e:mobile` 使用 Playwright `mobile-chromium` 项目和 `Pixel 7` 设备配置。
- webServer 使用独立端口启动 `npm run dev`，并注入 `WEBTERMINAL_E2E=1`。
- `/terminal/test-harness` 仅在 `WEBTERMINAL_E2E=1` 下由后端认证层放行，页面自身也会在非 E2E 环境返回 404。
- harness 不连接 SSH/WebSocket，只渲染 xterm、同一套移动端布局、`MobileTerminalToolbar` 和 `setupMobileTouchScroll`。
- Playwright 通过 CDP `Input.dispatchTouchEvent` 派发 touchstart/touchmove/touchend，覆盖真实移动端 touch handler 路径。
- headless Chromium 中 synthetic wheel 有时不会被 xterm 内部滚动系统消费；测试页仅对这种不被消费的 synthetic wheel 做 public API 镜像滚动，用于稳定验证 touch-scroll 产生的滚动意图，生产代码不受影响。

最小可落地用例：

- `mobile layout keeps toolbar below terminal`：快捷栏不遮挡 terminal。
- `shortcut bar supports horizontal drag`：快捷栏可横向拖动且不误发。
- `terminal supports vertical touch drag`：terminal 触摸拖动能改变 scrollback。
- `fast terminal drag emits stronger scroll input than slow drag`：快速拖动产生的滚动输入强度明显大于慢拖。
- `viewport resize refits xterm`：移动端高度缩小后 xterm canvas 尺寸或 cols/rows 更新。

### 第二层：轻量单元测试

单测只覆盖稳定的边界逻辑，不建议把 `touch-scroll.ts` 做成复杂状态机再大规模测试。`touch-scroll.ts` 的实现应保持小而可替换，核心行为由 E2E harness 保护。

可测试内容：

- 目标在 `.mobile-terminal-bar` 内时不接管。
- `term.hasSelection()` 时不接管。
- 横向手势不产生 terminal wheel。
- 新 touchstart 会取消上一段惯性。

### 第三层：真机冒烟测试

浏览器模拟不能完全覆盖真实软键盘和 Edge 移动端行为，仍需要真机冒烟。

建议两种执行方式：

1. Android Chrome/Edge + 远程调试
   - 使用 Chrome DevTools Protocol 连接真机浏览器。
   - 运行同一套 Playwright 测试里的核心断言。
   - 重点覆盖软键盘、visual viewport 和下拉刷新。

2. 手动真机 checklist
   - 每次修改软键盘、触摸、快捷栏相关代码时必须执行。
   - checklist 保留在 worklog 或 PR 描述中。

真机 checklist：

- Edge 移动端软键盘弹出后，快捷栏位于键盘上方。
- 快捷栏不遮挡 terminal 最后一行。
- 快捷栏可以横向滑动。
- 快捷栏横滑不误发快捷键。
- 点击 Tab/Esc/Ctrl+C/方向键后软键盘不收起，输入生效。
- terminal 慢滑跟手。
- terminal 快滑能快速滚动，并有合理惯性。
- terminal 顶部继续下拉不触发浏览器刷新。
- 复制模式长按和粘贴输入框不回归。

## 推荐落地步骤

1. 先加测试 harness 页面。
2. 引入 Playwright，新增移动端 E2E：
   - 布局不遮挡。
   - 快捷栏横滑。
   - terminal 慢滑和快滑。
   - 软键盘模拟缩高后 refit。
3. 在 `package.json` 增加：
   - `test:e2e:mobile`
4. 在 E2E 通过后，再考虑简化 `touch-scroll.ts`：
   - 保留必要的 ignore target、selection guard 和 touch-to-wheel。
   - 删除难以验证或收益不明确的复杂参数。
   - 参数调整必须有 E2E 指标支撑。
5. CI 或本地发布前执行：
   - `npm run typecheck`
   - `npm run test`
   - `npm run test:e2e:mobile`
   - `npm run build:frontend`

## 需要警惕的测试盲点

- 浏览器模拟不能真实弹出系统软键盘。
- iOS Safari 的 visual viewport 行为和 Chromium/Edge 不同。
- Playwright 的 synthetic touch 可能无法 100% 复现浏览器下拉刷新。
- xterm 内部 DOM 结构可能随版本变化，测试应优先断言行为指标，而不是深度绑定私有 DOM。

## 当前结论

这次影响大，是因为软键盘、fixed 视口、grid/flex 高度、快捷栏 touch、xterm 自定义滚动和浏览器下拉刷新都共享同一套移动端触摸与视口机制。后续不能只用构建和类型检查验证，应增加移动端 E2E harness，把“快捷栏横滑”和“terminal 触摸滚动”作为每次软键盘改动的必跑回归项。
