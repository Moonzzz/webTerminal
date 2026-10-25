---
keywords:
  - webTerminal
  - mobile terminal
  - worklog
  - shortcut bar
summary: webTerminal 移动端 terminal 支持探索日志，记录已确认事实、TODO、推荐实现步骤和验证缺口。
---

# 移动端 Terminal 支持 worklog

## TODO

- [x] 实现移动端底部快捷键栏，默认包含 Tab、Esc、Ctrl+C 和方向键。
- [x] 建立内置 shortcut action catalog，统一维护 label、发送序列和模式相关逻辑。
- [x] 增加快捷键栏自定义面板，支持启用/禁用、排序、恢复默认。
- [x] 支持用户新增自定义快捷键按钮，并持久化到浏览器本地。
- [x] 将快捷键栏配置持久化到 localStorage，并处理 schema 版本和异常回退。
- [x] 调整 terminal 移动端布局，底部预留工具栏高度并适配 safe-area。
- [x] 增加移动端上下滑动 scrollback 支持。
- [x] 真机验证 xterm 自带移动端长按/拖选复制能力。
- [x] 增加 terminal 文本代理层，解决移动端长按无法弹出原生选择组件的问题。
- [x] 尝试受限的 visualViewport 键盘适配；真机反馈空白过大后已回退。
- [ ] 真机复测软键盘弹出后的底部输入可见性。
- [x] 修正 visualViewport 二次顶起问题，避免软键盘弹出时产生大段空白。
- [x] 移除 terminal 页面顶部栏，最大化 terminal 展示区域。
- [x] 修复移动端点击快捷键时软键盘被按钮抢焦点关闭的问题。
- [x] 增加 `interactive-widget=resizes-content` viewport 配置，优先让 Android Chrome 随软键盘缩小内容区。
- [x] 探索 terminal 移动端滑动滞涩问题，形成原生 xterm viewport 优先的修复方案。
- [x] 增加粘贴输入框，使用移动端原生文字编辑菜单完成粘贴。
- [x] 确认移动端界面不出现剪切入口。
- [ ] 完成移动端视口验证。

## 已完成

### 2026-06-30：方案探索

- [x] 阅读 terminal 页面入口和 `TerminalClient.tsx`。
- [x] 确认 terminal 输入统一经 `term.onData`、前端缓冲和 WebSocket 发送。
- [x] 确认当前已有 OSC 52 写剪贴板能力，但缺少用户主动复制/粘贴入口。
- [x] 确认当前 terminal 页面是 fixed 全屏布局，页面级滚动被裁剪。
- [x] 确认 xterm 公开 API 支持 selection、paste、scroll 和 terminal modes。
- [x] 形成初版推荐方案：快捷键栏只走前端，配置存 localStorage，触摸滚动使用 CSS 适配加 touch 兜底。

### 2026-07-01：剪贴板方案调整

- [x] 移除剪切能力，不再将“复制后清除 selection”定义为剪切。
- [x] 记录复制降级方案：当 xterm 移动端选择不可用时，可进入可选择 DOM 文本代理层，由系统原生菜单完成选择和复制。
- [x] 调整粘贴方案：通过真实输入框承接移动端原生文字编辑菜单，用户粘贴后再发送到 xterm。
- [x] 明确粘贴不再依赖主动读取 Clipboard API。

### 2026-07-01：复制方案优先级调整

- [x] 将复制方案调整为优先使用 xterm 自带移动端选择能力。
- [x] 文本代理层降级为 xterm 移动端选择不可用或不稳定时的兜底方案。
- [x] 明确第一版实施应先避免触摸滚动兜底干扰 xterm selection/copy 机制。

### 2026-07-01：第一版实现

- [x] 在 `TerminalClient.tsx` 增加内置快捷键 action catalog，默认启用 `Tab`、`Esc`、`Ctrl+C` 和方向键。
- [x] 快捷键发送统一调用 xterm `input()`；方向键根据 `term.modes.applicationCursorKeysMode` 切换普通模式和 application cursor mode 序列。
- [x] 增加快捷键自定义面板，支持启用/禁用、上移/下移和恢复默认。
- [x] 使用版本化 localStorage 配置 `{ version: 1, items: [...] }`，读取失败或未知 action 自动回退。
- [x] 增加移动端底部栏、safe-area padding 和 terminal flex 布局，避免底部栏遮挡 terminal 最后一行。
- [x] 增加触摸滚动兜底：仅移动端单指快速纵向滑动时调用 `term.scrollLines()`，长按、已有选区、横向滑动、多指触控不接管。
- [x] 增加粘贴 textarea，用户通过系统原生文字编辑菜单粘贴后，提交时调用 xterm `paste()`。
- [x] 未增加复制按钮、剪切按钮或主动读取 Clipboard API 的粘贴逻辑。
- [x] 完成类型检查、前端构建和后端构建。
- [x] 生产模式本地服务可启动到 `127.0.0.1:3001`；未登录访问 terminal 页面返回登录跳转。
- [x] 浏览器插件当前无可用实例，未能执行自动化移动端截图和点击验证。

### 2026-07-01：用户自定义快捷键补齐

- [x] 将快捷键配置模型从纯 action id 数组升级为 item 列表，支持内置项和用户自定义项混排。
- [x] 将 localStorage schema 升级到 `version: 2`，兼容旧版 `version: 1` 的 action id 数组。
- [x] 自定义项保存 `label` 和 `input`，读取时过滤空值、未知类型和超长内容。
- [x] 自定义发送内容支持 `\n`、`\r`、`\t`、`\e`、`\xNN` 转义写法。
- [x] 自定义面板新增添加表单、删除按钮，并支持自定义项参与上移/下移排序。
- [x] 重新执行 `npm run typecheck` 和 `npm run build:frontend`，均通过。

### 2026-07-02：继续验证与自定义输入修正

- [x] 重新阅读当前 `TerminalClient.tsx` 和 `globals.css`，确认已包含用户自定义快捷键实现。
- [x] 修正自定义快捷键持久化规范化：读取已保存自定义输入时不再 trim，避免丢失结尾 `\n`、`\r` 等有意义控制字符。
- [x] 重新执行 `npm run typecheck`，通过。
- [x] 重新执行 `npm run build:frontend`，通过。
- [x] 执行 `git diff --check`，通过。
- [x] 确认 `127.0.0.1:3001` 已有服务运行，未登录访问 terminal 页面返回 `/login` 跳转。
- [x] 重新尝试连接浏览器插件，当前可用浏览器实例列表仍为空，无法执行自动化移动端截图和点击验证。

### 2026-07-03：移动端复制和软键盘问题探索

- [x] 记录用户实测问题：移动端长按 terminal 无法弹出系统原生选择组件。
- [x] 记录用户实测问题：移动端软键盘弹出后界面没有上移，底部输入不可见。
- [x] 阅读 xterm CSS 和源码，确认 `.xterm` 默认 `user-select: none`，SelectionService 主要由 `mousedown` 驱动，并会 `preventDefault()` 阻止浏览器原生选择。
- [x] 判断仅依赖 xterm 内建选择能力无法满足移动端原生选择菜单诉求，应将 DOM 文本代理层从降级方案提升为移动端复制主方案。
- [x] 阅读当前布局，确认 terminal 页面 fixed 全屏且未监听 `window.visualViewport`，软键盘弹出后不会主动按可视视口缩高或上移。
- [x] 形成推荐修复路径：复制使用按需打开的文本代理层；软键盘使用 `visualViewport` 计算 keyboard inset，并触发 xterm fit/resize。

### 2026-07-03：移动端复制模式实现

- [x] 在移动端 toolbar 增加“选择”按钮，打开复制模式。
- [x] 在 terminal 容器增加移动端长按入口，长按不移动时打开复制模式；滑动会取消长按，不影响 scrollback 滑动。
- [x] 复制模式从 xterm buffer 生成可选择 DOM 文本层，普通 buffer 输出 scrollback，alternate buffer 输出当前可见区域。
- [x] 复制层使用 `user-select: text` 和 `-webkit-user-select: text`，让移动端系统原生选择/复制菜单接管。
- [x] 关闭复制层后重新聚焦 xterm。
- [x] 按用户反馈调整软键盘处理策略：本次不引入 `visualViewport` 大改，仅恢复移动端 terminal 底部 24px padding，保留原有底部可视间隔。
- [x] 执行 `npm run typecheck`，通过。
- [x] 执行 `npm run build:frontend`，通过。
- [x] 执行 `git diff --check`，通过。

### 2026-07-06：移动端软键盘与快捷键焦点修复

- [x] 记录用户真机反馈：软键盘弹出时内容没有自动顶上去；软键盘打开时点击快捷键会导致键盘收回。
- [x] 在 `TerminalClient.tsx` 增加移动端 `visualViewport` 监听，用于计算软键盘占用区域。
- [x] 在 `globals.css` 的移动端规则中让 `.terminal-page` 根据键盘占用区域调整底部边界，软键盘弹出时由 ResizeObserver 触发 xterm refit。
- [x] 在 `MobileTerminalToolbar.tsx` 中为快捷键按钮增加 touch tap 发送路径，阻止按钮默认抢焦点，避免关闭 xterm 软键盘。
- [x] 保留快捷键栏横向拖动能力，并抑制拖动结束后的合成 click 误触。

### 2026-07-06：移动端显示区域最大化修正

- [x] 记录用户真机反馈：软键盘弹出时顶起高度过高，产生大段空白无法用于展示。
- [x] 将 `visualViewport` 适配从设置页面可视高度改为计算 `window.innerHeight - visualViewport.height - offsetTop` 的键盘底部 inset。
- [x] 移动端 `.terminal-page` 只设置 `bottom: var(--terminal-keyboard-inset)`，避免和浏览器自身 viewport 缩放叠加。
- [x] 移除 terminal 页面顶部栏和返回链接，让 terminal shell 直接占满页面主体。

### 2026-07-06：回退软键盘手动顶起补偿

- [x] 记录用户复测反馈：键盘弹出时仍有很大空白区域。
- [x] 回退 `TerminalClient.tsx` 中写入 `--terminal-keyboard-inset` 的 `visualViewport` 监听逻辑。
- [x] 回退 `globals.css` 中移动端 `.terminal-page` 的 `bottom: var(--terminal-keyboard-inset)`。
- [x] 后续验证暂不运行 `npm run build:frontend`，避免 Next 构建反复改写 `next-env.d.ts`。

### 2026-07-06：键盘上方模拟快捷栏落地

- [x] 在 `layout.tsx` 增加 Next viewport 配置：`width=device-width`、`initial-scale=1`、`viewport-fit=cover`、`interactive-widget=resizes-content`。
- [x] 保持 terminal 页面无顶部栏，terminal client 使用移动端两行 grid 布局，快捷栏作为底部 DOM 区域模拟键盘附件栏。
- [x] 确认没有重新引入键盘 inset bottom 补偿，避免和浏览器原生键盘避让叠加。
- [x] 增加最小 `visualViewport.height` 兜底，只约束 terminal 页面为真实可视高度，让软键盘弹出时快捷栏整体移动到键盘上方。
- [x] 移动端 terminal 和快捷栏拆成独立 grid 行，避免快捷栏覆盖底部 terminal 内容。
- [x] 为快捷键按钮增加 `tabIndex={-1}`，并在捕获阶段阻止 `touchstart`/`pointerdown` 默认聚焦。
- [x] 保留 touch tap 发送快捷键和横向拖动滚动逻辑，拖动结束不发送快捷键。

### 2026-07-06：Edge 移动端交互修正

- [x] 记录用户反馈：Edge 移动端快捷栏位置正确，但快捷栏无法横向滚动，terminal 宽度渲染错误，terminal 内上下拖动抖动且容易触发浏览器下拉刷新。
- [x] 放开快捷键按钮按下阶段的默认行为拦截，仅在 touch tap 结束时发送快捷键并抑制合成 click，恢复快捷栏横向滚动。
- [x] 移动端页面、terminal 容器和快捷栏补充 `min-width: 0`、`width`、`overscroll-behavior` 和 `touch-action` 约束，避免页面级横向撑宽和浏览器下拉刷新。
- [x] `visualViewport` 变化时同步写入可视宽度并触发 xterm fit/resize，修复键盘弹出后 terminal 列宽可能不更新的问题。
- [x] terminal 触摸滚动从开始阶段阻止默认页面滚动，并降低行滚动倍率，减少抖动和误触发浏览器刷新。

### 2026-07-06：terminal 滑动流畅度方案探索

- [x] 记录用户反馈：Edge 移动端三项修复已生效，但 terminal 内滑动有滞涩感，表现为滑动慢且不够流畅。
- [x] 确认当前滞涩主要来自 `touch-scroll.ts` 默认接管 `touchmove`，通过 `term.scrollLines()` 按行滚动，且倍率降为 `0.55`。
- [x] 确认 xterm 自带 `.xterm-viewport` 是 `overflow-y: scroll`，具备更接近原生像素级滚动和惯性滚动的基础。
- [x] 新增 `mobile-terminal-scroll-smoothness-plan.md`，推荐优先恢复 xterm viewport 原生滚动，手动 `scrollLines()` 只作为 fallback。

### 2026-07-06：terminal 原生滚动实施

- [x] 按方案 1 恢复 xterm viewport 原生滚动，移动端 `.terminal-container` 改为允许 `pan-y`。
- [x] 为 `.xterm-viewport` 补充 `touch-action: pan-y`，继续保留移动端惯性滚动和 overscroll contain。
- [x] 将 `touch-scroll.ts` 从按行 `term.scrollLines()` 默认接管改为边界 overscroll 防护，只在 viewport 顶部/底部继续外拉时阻止默认行为。
- [x] 保留横向手势忽略和选区状态忽略，避免影响快捷栏横滑、复制模式和 xterm selection。

### 2026-07-06：terminal 触摸滑动恢复

- [x] 记录用户反馈：方案 1 后 terminal 内无法进行触摸滑动。
- [x] 判断原因：当前触摸命中主要落在 `.xterm-screen`/canvas，单纯放开 `.xterm-viewport` 原生滚动无法稳定触发 xterm 滚动系统。
- [x] 将 `.terminal-container` 恢复为 `touch-action: none`，继续阻止浏览器页面滚动和下拉刷新接管。
- [x] `touch-scroll.ts` 改为 touch-to-wheel 桥接：垂直拖动时派发像素级 `WheelEvent` 给 `.xterm-scrollable-element`，由 xterm 内部 `SmoothScrollableElement` 处理滚动。
- [x] 保留横向手势忽略、选区状态忽略和移动端工具栏忽略。

### 2026-07-06：terminal 快速滑动修正

- [x] 记录用户反馈：touch-to-wheel 后可滑动，但滑动仍然太慢，无法快速滑动。
- [x] 将触摸位移到 wheel delta 的倍率从 `1.15` 调整为 `2.4`，提升手指滑动距离到 xterm 滚动距离的映射速度。
- [x] 增加 touchend 后的短惯性滚动，根据最后移动速度继续派发递减 wheel 事件，让快速滑动释放后继续滚动。
- [x] 为单次触摸 delta 和惯性 delta 增加上限，避免极端事件导致 scrollback 跳跃过大。

### 2026-07-06：移动端回归原因和 E2E 方案分析

- [x] 分析本轮反复修改的根因：软键盘 visual viewport、fixed 布局、terminal grid 高度、快捷栏触摸、xterm 自定义滚动和浏览器下拉刷新共享同一套移动端触摸与视口机制。
- [x] 确认现有 `typecheck`、构建和后端单测无法覆盖软键盘、快捷栏横滑、terminal 触摸滑动和下拉刷新。
- [x] 新增 `mobile-terminal-e2e-regression-plan.md`，提出三层测试策略：手势单测、Playwright 移动端 E2E harness、真机 Edge/Chrome 冒烟。
- [x] 建议新增测试 harness 页面，避免 E2E 依赖登录、secure channel、WebSocket 和真实 SSH。

### 2026-07-06：测试策略收敛

- [x] 记录用户判断：`touch-scroll` 没必要继续复杂化，核心问题是缺少回归测试导致软键盘改动影响快捷栏和 terminal 滚动。
- [x] 将后续优先级调整为先落地 Playwright 移动端 E2E harness，再在测试保护下收敛 `touch-scroll.ts`。
- [x] 更新 `mobile-terminal-scroll-smoothness-plan.md`，明确不再优先通过继续复杂化 `touch-scroll.ts` 解决体验问题。
- [x] 更新 `mobile-terminal-e2e-regression-plan.md`，强调 E2E harness 是优先项，单测只覆盖稳定边界。

### 2026-07-07：Playwright 移动端 E2E harness 落地

- [x] 安装 `@playwright/test` 并下载 Chromium，用于本地移动端 E2E。
- [x] 新增 Playwright 配置，使用 `Pixel 7` 移动端 Chromium 项目和独立 E2E 端口启动 dev server。
- [x] 新增 `test:e2e:mobile` 脚本。
- [x] 新增 `/terminal/test-harness` 页面，仅 `WEBTERMINAL_E2E=1` 下可访问。
- [x] 后端认证层仅在 `WEBTERMINAL_E2E=1` 时放行 `/terminal/test-harness`，避免生产暴露测试页。
- [x] 新增 terminal harness 组件，不连接 SSH/WebSocket，只渲染 xterm、移动端布局、快捷栏和 `setupMobileTouchScroll`。
- [x] harness 暴露 `window.__terminalTestMetrics` 和 `window.__terminalTestControls`，用于断言 rows/cols、viewportY、wheel delta、scroll event、快捷键发送和 resize。
- [x] Playwright 用 CDP `Input.dispatchTouchEvent` 派发 touch 手势，覆盖快捷栏 touch handler 和 terminal touch-scroll 链路。
- [x] 新增移动端 E2E 用例：
  - 移动端布局下快捷栏不遮挡 terminal。
  - 快捷栏横向拖动可滚动且不误发快捷键。
  - 快捷键 tap 会发送输入。
  - terminal 垂直触摸拖动会滚动 scrollback，并阻止页面滚动。
  - 快速拖动产生的滚动输入强度大于慢拖。
  - viewport 缩高后 xterm rows/cols 重新 fit。
- [x] 记录测试限制：headless Chromium 中 synthetic wheel 有时不会被 xterm 内部滚动系统消费；测试页只对未被消费的 synthetic wheel 做 public API 镜像滚动，生产代码不受影响。

### 2026-07-08：运行时 E2E 与架构收敛方案确认

- [x] 复审最近移动端 terminal 改动后确认：源码 harness、测试全局变量和 synthetic wheel 补偿会削弱测试真实性，并增加业务源码维护成本。
- [x] 确认后续策略调整为运行时验证优先：E2E 走真实 `/login`、首页和 terminal 页面，测试辅助只放在 `e2e/`、Playwright 配置或外部测试夹具中。
- [x] 确认删除 `/terminal/test-harness`、`TerminalTestHarness` 和后端测试页放行，不再把测试指标挂到业务运行时全局变量。
- [x] 确认前端按中等解耦推进：`TerminalClient` 收敛为页面编排层，新增 terminal session hook 和 visualViewport hook，`touch-scroll` 仅做 adapter 边界收敛，不重写真机已验证的核心手势算法。
- [x] 新增 `mobile-terminal-runtime-e2e-architecture.md`，记录架构拆分、运行时 E2E 方案、清理项和验收标准。

### 2026-07-08：运行时 E2E 与架构收敛实施

- [x] 删除源码内 `/terminal/test-harness` 页面、`TerminalTestHarness` 组件和后端 E2E 测试页放行逻辑。
- [x] 移动端 E2E 改为真实运行时路径：登录、首页填写自定义 SSH 目标、进入 `/terminal/custom`、输入 SSH 密码后验证 terminal 页面。
- [x] 新增测试侧 SSH fixture 和运行时 server 启动脚本：Playwright 先构建前后端，再启动外部 SSH fixture 和生产模式后端服务，避免 dev watcher/`EMFILE`。
- [x] E2E 测试辅助只保留在 `e2e/` 和 Playwright 配置中，不再在业务源码挂测试页面、测试全局变量或 synthetic wheel 补偿。
- [x] 抽出 `useTerminalSession`，封装 xterm、FitAddon、OSC 52、安全通道、WebSocket、输入缓冲、keepalive、resize 和 cleanup。
- [x] 抽出 `useTerminalViewport`，统一 visualViewport CSS 变量同步和 resize refit 触发。
- [x] `TerminalClient` 收敛为页面编排层，保留目标读取、密码面板、快捷栏、粘贴、复制模式和触摸长按复制状态。
- [x] `touch-scroll` 将 xterm DOM 查询边界收敛为 adapter，并修复 xterm 内部 textarea 被普通输入控件过滤导致 terminal touch-scroll 跳过的问题。
- [x] 移除固定本机 dev origin 和个人 `.codex` 配置。
- [x] 验证通过：`npm run typecheck`、`npm test`、`npm run test:e2e:mobile`。

### 2026-10-25：按需求点执行功能验收

- [x] 重新运行 `npm run typecheck`，通过；`npm test` 现有 1 项测试通过。
- [x] 原有移动端 E2E 6 项全部通过：真实登录与 SSH 连接、布局、快捷栏横滑不误发、Tab 输入、触摸事件与页面防滚动、快速拖动 wheel 强度、viewport refit 与后端 resize。
- [x] E2E 自动完成前后端生产构建并启动外部 SSH fixture，未出现 dev watcher/`EMFILE`。
- [x] 新增中文命名的功能验收用例：复制/粘贴通过真实 SSH 验证，自定义快捷键刷新后保留并发送；两项通过。粘贴断言兼容终端显示自动换行，SSH 接收内容仍严格比较。
- [x] 静态核对：业务源码无测试 harness 页面、旧测试全局变量；visualViewport 监听只在 hook 内实现；未提交改动未涉及终端协议、安全通道或 SSH session manager。
- 首次验收实际触摸滚动未通过：Chromium 移动端模拟中，首个可见 fixture 行在触摸拖动前后均为 134；同位置原生 wheel 对照可滚至 133。原有 wheel 事件计数断言不能代替实际内容滚动验收，修复结果见下节。
- 首次复核命令为 `npm run test:e2e:mobile -- --grep '终端触摸|粘贴经|自定义快捷键刷新'`，结果 2 项通过、1 项失败。
- [ ] 系统软键盘、Edge/Chrome 下拉刷新和惯性体验仍需真机验收；模拟环境下的失败不能直接判定为所有真机均存在同样问题。
- 验收结论：部分通过，不能标记整体验收完成；本轮只补充验收测试与记录，未修改生产行为或增加测试滚动补偿。
- 首次验收日志：`/private/tmp/webterminal-acceptance-e2e.log`、`/private/tmp/webterminal-acceptance-supplement.log`。

### 2026-10-25：修复合成滚轮兼容问题并完成自动化复验

- [x] 独立 Chromium 实验确认：相同 `deltaY=-100`，合成事件的旧字段 `wheelDeltaY=-100`，原生事件的旧字段为 `120`；xterm 优先读取旧字段，导致触摸桥接方向与标准字段不一致，在终端底部被边界截断。
- [x] 在 touch-to-wheel adapter 内屏蔽合成事件的旧 wheel delta 字段，使 xterm 按标准 `deltaY` 归一化；保留原有手势阈值、倍率、惯性算法及事件派发路径。
- [x] 回归用例直接断言触摸双向拖动后可见历史行变化及页面未滚动，移除排查阶段的原生滚轮对照，不添加测试补偿或放宽实际滚动断言。
- [x] `npm run test:e2e:mobile` 全部 9 项通过（22.5 秒），前后端生产构建通过；`npm run typecheck`、`npm test` 及 `git diff --check` 通过。
- 自动化验收通过；系统软键盘、浏览器下拉刷新和惯性手感仍需真机复测。
- 复验日志：`/private/tmp/webterminal-acceptance-fixed.log`。

相关文件：

- `package.json`
- `package-lock.json`
- `playwright.config.ts`
- `mobile-terminal.spec.ts`
- `run-runtime-server.mjs`
- `ssh-fixture.mjs`
- `page.tsx`
- `TerminalTestHarness.tsx`
- `server.ts`
- `TerminalClient.tsx`
- `useTerminalSession.ts`
- `useTerminalViewport.ts`
- `touch-scroll.ts`
- `.gitignore`
- `mobile-terminal-e2e-regression-plan.md`
- `mobile-terminal-support-worklog.md`
- `mobile-terminal-runtime-e2e-architecture.md`

相关文件：

- `TerminalClient.tsx`
- `MobileTerminalToolbar.tsx`
- `globals.css`
- `touch-scroll.ts`
- `mobile-terminal-scroll-smoothness-plan.md`
- `mobile-terminal-e2e-regression-plan.md`
- `layout.tsx`
- `page.tsx`
- `mobile-terminal-support.md`
- `mobile-terminal-support-worklog.md`

## 推荐实施步骤

1. 使用真机验证复制模式：toolbar “选择”、terminal 长按、代理层长按选择、复制菜单。
2. 使用真机复测软键盘弹出后的底部输入可见性；若仍有遮挡，再单独实现 `visualViewport` 适配。
3. 回归验证粘贴输入框原生菜单、底部栏、用户自定义快捷键、localStorage 持久化和移动端滑动。

## 当前验证状态

- 已运行 `npm run typecheck`，通过。
- 已运行 `npm run build:frontend`，通过。
- 已运行 `npm run build:backend`，通过。
- 已启动生产模式本地服务：`http://127.0.0.1:3001`。
- 已通过 HTTP 检查确认未登录访问 terminal 页面返回 `/login` 跳转。
- 浏览器插件当前无可用实例，尚未完成移动端交互和截图验证。
- 2026-07-02 重新验证：`npm run typecheck`、`npm run build:frontend`、`git diff --check` 均通过；浏览器插件仍无可用实例。
- 2026-07-03 用户真机反馈：xterm 内建选择能力在移动端不可用，长按 terminal 不弹系统原生选择组件；软键盘弹出时页面没有跟随可视视口上移。
- 2026-07-03 已实现复制模式，并重新执行 `npm run typecheck`、`npm run build:frontend`、`git diff --check`，均通过。
- 2026-07-06 已实现快捷键 touch 保焦点逻辑；`visualViewport` 手动补偿因真机空白过大已回退，待真机复测浏览器原生键盘行为。
- 2026-07-06 已增加 `interactive-widget=resizes-content` viewport 配置和 `visualViewport.height` 兜底，并重新执行 `npm run typecheck` 通过。
- 2026-07-06 已按 Edge 移动端反馈修复快捷栏横向滚动、terminal 宽度 refit 和 terminal 内触摸滚动防下拉刷新。
- 2026-07-06 已形成 terminal 滑动流畅度修复方案；方案 1 真机不可滑动后，已切换为 touch-to-wheel 桥接恢复触摸滑动，并补充快速滑动惯性。
- 2026-07-06 已完成移动端回归原因分析和 E2E 自动化测试方案，建议后续优先落地测试 harness 和 Playwright 移动端回归。
- 2026-07-06 已按用户反馈收敛策略：不继续复杂化 `touch-scroll`，优先考虑 Playwright 移动端 E2E harness。
- 2026-07-07 已落地 Playwright 移动端 E2E harness；`npm run typecheck`、`npm run test`、`npm run test:e2e:mobile`、`npm run build:frontend` 和 `git diff --check` 已通过。沙箱内 Chromium 因 macOS Mach port 权限无法启动，E2E 需在沙箱外执行；`build:frontend` 后已恢复 `next-env.d.ts`。
