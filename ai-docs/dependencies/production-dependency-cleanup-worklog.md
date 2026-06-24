# webTerminal 依赖清理与生产部署结构 worklog

## 2026-06-24

### TODO

- [ ] 跟踪 Next.js 后续版本是否移除对旧 `postcss` 版本的直接固定，届时评估移除 package override。

### 已完成

- [x] 使用 npm registry 确认 `xterm` 包已弃用，推荐迁移到 `@xterm/xterm`。
- [x] 使用 npm registry 确认当前依赖版本，升级 Next.js、React、React DOM、`ssh2`、`ws`、`@xterm/addon-fit` 和类型包。
- [x] 前端终端组件导入从 `xterm` 改为 `@xterm/xterm`，CSS 路径同步切换。
- [x] 移除直接依赖 `xterm`。
- [x] 新增 `tsconfig.backend.json`，生产构建编译后端到 `dist/backend`。
- [x] `npm run build` 统一串联类型检查、前端构建和后端编译。
- [x] `npm run start` 改为运行编译后的 `dist/backend/server.js`。
- [x] Dockerfile 调整为构建依赖、生产依赖、运行层三阶段结构。
- [x] `.dockerignore` 增补 `dist`、tsbuildinfo、coverage 和本地 npm 目录。
- [x] `.gitignore` 增补 `dist` 和通用 tsbuildinfo 忽略规则。
- [x] 新增 `frontend/next.config.mjs`，关闭 Next.js `X-Powered-By` 响应头。
- [x] `config/server.json` 改为使用 `WEBTERMINAL_HOSTNAME` 控制监听地址。
- [x] 使用 package override 将 `postcss` 固定到安全版本范围。
- [x] 更新 README 和部署文档。
- [x] 验证 `npm run build`、`npm audit --omit=dev`、Docker 镜像构建和容器 `/login` 响应。
- [x] 生产镜像改用文件追踪结果，不再安装并复制完整生产 `node_modules`。
- [x] 运行层改为纯 Alpine，只保留 Node 和必要系统库。

### 关键判断

- `xterm` 明确标记为弃用，因此直接迁移到 `@xterm/xterm`，而不是只升级原包版本。
- Next.js 当前稳定版仍直接依赖旧 `postcss` 版本，使用 override 是当前最小范围的修复方式。
- 生产环境不应保留 `tsx` 作为运行入口依赖；后端编译产物更适合 Docker 和普通进程部署。

### 相关文件

- `package.json`
- `package-lock.json`
- `TerminalClient.tsx`
- `globals.css`
- `tsconfig.backend.json`
- `next.config.mjs`
- `Dockerfile`
- `.dockerignore`
- `.gitignore`
- `server.json`
- `README.md`
- `docker-image.md`
- `docker-image-worklog.md`
