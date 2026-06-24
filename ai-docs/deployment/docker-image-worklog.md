# webTerminal Docker 镜像构建 worklog

## 2026-06-24

### TODO

- [ ] 持续关注 Next.js 对 `postcss` 的依赖，待上游直接升级到安全版本后移除 package override。

### 已完成

- [x] 新增 Dockerfile，包含依赖安装、类型检查、前端构建和生产运行阶段。
- [x] 新增 `.dockerignore`，排除本地依赖、构建缓存、环境文件和 SSH 私钥目录。
- [x] 新增 Docker 镜像打包脚本，默认目标平台为 `linux/amd64`。
- [x] macOS 构建路径使用 `docker buildx build --platform linux/amd64 --load`。
- [x] package 脚本新增 `docker:build`。
- [x] README 增加 Docker 构建和运行说明。
- [x] 执行脚本语法检查、npm 脚本帮助入口检查、TypeScript 类型检查和 Next.js 生产构建，均通过。
- [x] 简化 Dockerfile 为 builder/runner 两阶段，合并构建命令，并在运行层一次性复制构建后的应用目录。
- [x] Docker 内 npm 安装阶段新增 USTC Node dist 镜像配置。
- [x] 新增后端编译配置，生产启动改为 `node dist/backend/server.js`。
- [x] Dockerfile 调整为 builder/prod-deps/runner 三阶段，运行层只保留生产依赖、配置、Next.js 构建产物和后端编译产物。
- [x] 移除生产镜像对 `tsx` 和开发依赖的运行时依赖。
- [x] `config/server.json` 监听地址改用 `WEBTERMINAL_HOSTNAME`，避免读取容器自动注入的 `HOSTNAME`。
- [x] 执行完整 Docker 镜像构建验证，并启动容器验证 `/login` 返回 200。
- [x] 调研 Next.js standalone 和自定义 server 的兼容边界，确认不能直接替换现有业务入口。
- [x] 新增生产文件追踪脚本，从编译后的自定义 server 入口计算运行依赖。
- [x] Docker 构建上下文改为显式复制源码目录，并补齐 `.dockerignore`。
- [x] builder 改用 Node 22 + Alpine 3.24，runner 改用纯 Alpine 3.24。
- [x] runner 只保留 Node 可执行文件、Node 许可证、`libstdc++` 和生产文件包，不再携带 npm、Yarn 和完整 `node_modules`。
- [x] 排除前端源码、缓存、类型文件、source map、开发依赖和 Sharp/libvips。
- [x] 补充 Next 自定义 server 动态解析的 webpack 别名文件及 Babel runtime 元数据。
- [x] `linux/amd64` 镜像由 558 MB 降至 183 MB，减少约 67%。
- [x] 验证纯 Alpine 容器启动成功，`/login` 和 Next 静态资源返回 200，未登录首页及终端页返回 302。

### 验证边界

- 纯 Alpine 运行结构和裁剪依赖已在隔离容器内完成启动与 HTTP 验证。
- 最后一次仅移除 `.d.ts` 的镜像构建成功；重启该最终摘要镜像时执行环境 Docker 授权额度耗尽。该改动不涉及运行代码，额外通过生产产物边界检查确认无类型文件、source map、缓存或被排除依赖残留。

### 关键判断

- 生产环境应运行编译后的后端 JS，不再通过 `tsx` 实时转译 TypeScript，降低启动路径和镜像依赖面。
- Docker 容器内会自动存在 `HOSTNAME` 环境变量，配置层显式改用 `WEBTERMINAL_HOSTNAME` 或默认 `0.0.0.0`，避免绑定到容器 hostname。
- 用户提供的 `https://mirrors.ustc.edu.cn/node/` 是 Node.js 分发镜像，更适合配置为 `npm_config_disturl`；npm 包 registry 如需切换，应单独配置 npm registry 地址。
- Next.js standalone 不追踪自定义 server，现阶段保留单进程业务入口，并使用 `@vercel/nft` 独立生成最小生产文件集合。
- 当前没有使用 `next/image`，关闭运行时图片优化后可安全移除 Sharp/libvips；未来引入 `next/image` 时必须同步恢复图片优化依赖。
- 仅靠本地目录启动会回退解析到项目根完整依赖，不能证明生产包完整；必须在隔离容器中验证。

### 相关文件

- `Dockerfile`
- `.dockerignore`
- `build-docker-image.sh`
- `package.json`
- `README.md`
- `tsconfig.backend.json`
- `server.json`
- `create-production-bundle.mjs`
- `next.config.mjs`
