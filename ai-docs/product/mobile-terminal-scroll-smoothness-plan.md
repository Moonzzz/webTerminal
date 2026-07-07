---
keywords:
  - webTerminal
  - mobile terminal
  - touch scroll
  - xterm viewport
  - Edge mobile
summary: 移动端 terminal 滑动滞涩问题分析和修复方案，目标是在保留防下拉刷新的同时恢复更接近原生的顺滑滚动。
---

# 移动端 Terminal 滚动流畅度修复方案

## 问题现象

Edge 移动端当前已修复：

- 快捷栏能正确停在软键盘上方。
- 快捷栏能横向滚动。
- terminal 宽度和 xterm refit 正常。
- terminal 内上下拖动不再轻易触发浏览器下拉刷新。

新的问题是 terminal 内上下滑动存在滞涩感：

- 滑动速度偏慢。
- 慢速拖动时反馈不连续。
- 没有浏览器原生滚动的惯性和像素级平滑。

## 已确认原因

当前 `touch-scroll.ts` 使用的是手动兜底滚动：

- `touchmove` 中阻止浏览器默认滚动。
- 根据手指位移换算为 terminal 行数。
- 调用 xterm `term.scrollLines(wholeLines)`。
- 为减少抖动，当前倍率为 `0.55`，并且累计不到 1 行时不滚动。

这套方案能阻止浏览器下拉刷新，但天然有几个缺陷：

- `scrollLines()` 是按行滚动，不是像素级滚动。
- 不会使用浏览器原生惯性滚动。
- 慢速拖动需要累计超过 1 行才更新画面，用户会感觉卡顿。
- 降低倍率虽然减少抖动，但会让滚动速度变慢。

xterm 本身有 `.xterm-viewport`，其 CSS 是 `overflow-y: scroll`。xterm 内部的 viewport scroll 能处理像素级 `scrollTop` 并同步到 buffer 行位置。更流畅的方向应优先利用这个原生 viewport，而不是始终用 `scrollLines()` 接管。

## 当前策略

不再优先通过继续复杂化 `touch-scroll.ts` 来解决体验问题。

当前主要风险不是缺少某个滚动参数，而是缺少移动端回归测试保护。软键盘、快捷栏、terminal 滚动都共享 touch 和 viewport 机制，在没有 E2E 保护前继续调参数，很容易再次影响其他组件。

后续优先工作：

1. 先落地 Playwright 移动端 E2E harness。
2. 用自动化固定快捷栏横滑、terminal 触摸滑动、viewport 缩高 refit 等关键行为。
3. 再在测试保护下简化 `touch-scroll.ts`，只保留必要职责。

`touch-scroll.ts` 的合理职责边界：

- 忽略快捷栏、输入框、按钮和 selection 状态。
- 将 terminal 区域的垂直触摸转换为 xterm 能处理的滚动输入。
- 阻止浏览器页面滚动或下拉刷新接管 terminal 区域。

不建议继续追加的职责：

- 软键盘布局计算。
- 快捷栏交互。
- 复杂拟真惯性系统。
- 针对单个浏览器不断试错参数。

## 已探索方案

### 方案 A：xterm viewport 原生滚动

核心思路：

- 不再让 `.terminal-container` 全局 `touch-action: none`。
- 让 `.xterm-viewport` 成为移动端主要垂直滚动目标：
  - `touch-action: pan-y`
  - `overscroll-behavior: contain`
  - `-webkit-overflow-scrolling: touch`
- terminal 页面和 body 继续保持 `overscroll-behavior: none`，避免页面级下拉刷新。
- `touch-scroll.ts` 不在所有移动端默认接管，只在检测到 viewport 不可滚动或原生滚动失败时兜底。

预期效果：

- 使用浏览器原生像素级滚动。
- 保留惯性。
- 滚动速度和手指位移一致。
- xterm 自身 viewport 继续负责将 `scrollTop` 映射到 buffer。

实际结果：

- 真机反馈 terminal 内无法触摸滑动。
- 当前 xterm DOM 中触摸主要命中 `.xterm-screen`/canvas，单纯依赖 `.xterm-viewport` 原生滚动不可靠。

### 方案 B：touch-to-wheel 桥接

当前采用的方向。

核心思路：

- 找到 `.xterm-scrollable-element`。
- touchmove 时将手指位移转换为像素级 `WheelEvent`。
- 由 xterm 内部 `SmoothScrollableElement` 处理滚动同步。
- 页面继续阻止浏览器滚动和下拉刷新接管。

预期效果：

- 比 `scrollLines()` 更接近 xterm 原生滚动路径。
- 能恢复触摸滑动。

主要风险：

- 滚动倍率和惯性仍需要体验参数，但不应在没有 E2E 的情况下继续反复调参。
- 依赖 xterm 内部 DOM 类名，xterm 升级时需要回归验证。

### 方案 C：继续扩展 scrollLines 或自定义惯性

不推荐。

核心思路：

- 将倍率从 `0.55` 调回 `1.0` 或根据速度动态调整。
- touchend 后用 `requestAnimationFrame` 模拟惯性滚动。
- 降低 1 行阈值或允许更频繁的小步滚动。

预期效果：

- 代码改动小。
- 能改善“太慢”的问题。

主要风险：

- 仍是按行跳动，无法真正达到原生滚动顺滑度。
- 动量算法容易和 xterm 输出、复制长按、浏览器手势产生新冲突。

## 实施状态

2026-07-06 已尝试方案 A：

- `.terminal-container` 从 `touch-action: none` 改为 `touch-action: pan-y`。
- `.xterm-viewport` 保持 `overflow-y: scroll`，移动端增加 `touch-action: pan-y` 和 `-webkit-overflow-scrolling: touch`。
- `touch-scroll.ts` 不再默认调用 `term.scrollLines()` 接管每次滑动。
- `touch-scroll.ts` 当前只追踪垂直手势，在 xterm viewport 到达顶部或底部并继续外拉时阻止默认行为，降低页面下拉刷新风险。

真机反馈：方案 A 导致 terminal 内无法触摸滑动。原因是当前 xterm DOM 中触摸命中主要落在 `.xterm-screen`/canvas，上层的 `.xterm-scrollable-element` 才是 xterm 自定义滚动系统；单纯依赖 `.xterm-viewport` 原生滚动无法稳定接管手势。

2026-07-06 已切换到方案 B 的低风险变体：

- `.terminal-container` 恢复 `touch-action: none`，避免浏览器页面滚动和下拉刷新接管。
- `touch-scroll.ts` 垂直拖动时不再调用 `term.scrollLines()`。
- `touch-scroll.ts` 将触摸位移转换为 `WheelEvent` 派发给 `.xterm-scrollable-element`，由 xterm 内部 `SmoothScrollableElement` 处理滚动同步。
- 该路径比按行 `scrollLines()` 更贴近 xterm 原生滚动系统，同时恢复触摸滑动。
- 后续按真机反馈将触摸到 wheel 的倍率调到 `2.4`，并在 touchend 后增加短惯性滚动，支持快速滑动释放后继续滚动。

## 推荐实施步骤

1. 暂停继续手调 `touch-scroll.ts` 复杂度。
2. 优先实现 `mobile-terminal-e2e-regression-plan.md` 中的 Playwright harness。
3. 用 E2E 固定：
   - 快捷栏横向拖动。
   - terminal 纵向拖动。
   - 快速拖动比慢速拖动滚得更远。
   - viewport 缩高后 xterm refit。
4. E2E 稳定后，再考虑简化当前 touch-to-wheel 实现和参数。

## 当前建议结论

当前不建议继续靠真机反馈反复修改 `touch-scroll.ts`。优先落地 Playwright 移动端 E2E harness，自动覆盖快捷栏横滑、terminal 触摸滑动和 viewport 缩高后的 refit；在这些回归用例稳定后，再收敛 `touch-scroll.ts` 的职责和参数。
