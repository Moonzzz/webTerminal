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
- [ ] 真机复测软键盘弹出后的底部输入可见性；若仍有遮挡，再增加 visualViewport 键盘适配。
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

相关文件：

- `TerminalClient.tsx`
- `globals.css`
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
