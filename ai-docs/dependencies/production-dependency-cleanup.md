---
keywords:
  - webTerminal
  - dependency cleanup
  - @xterm/xterm
  - Next.js
  - production build
  - Docker
summary: webTerminal 依赖清理与生产部署结构说明，记录过期依赖替换、生产编译启动、Docker 打包和安全审计策略。
---

# webTerminal 依赖清理与生产部署结构

## 原始需求

- 修复项目依赖包。
- 去除过期依赖。
- 使用推荐包。
- 调整为生产部署方式。
- 优化项目结构、打包、运行和部署方式。

## 依赖策略

- 终端组件从已弃用的 `xterm` 迁移到推荐包 `@xterm/xterm`。
- `@xterm/addon-fit` 升级到 `0.11.x`，与 `@xterm/xterm` 当前稳定版配套。
- Next.js、React、React DOM、`ssh2`、`ws` 升级到当前稳定版本范围。
- 类型依赖对齐 React 19、Node 22 和 `ws` 8。
- `postcss` 通过 package override 固定到安全版本范围，规避 Next.js 间接依赖中的已知审计问题；后续待 Next.js 上游直接依赖安全版本后可移除 override。

## 生产结构

- 开发环境继续使用 `node --import tsx backend/server.ts`，便于直接运行 TypeScript。
- 生产构建统一执行 `npm run build`：
  - `npm run typecheck` 做全量类型检查。
  - `npm run build:frontend` 生成 Next.js 生产构建。
  - `npm run build:backend` 编译后端到 `dist/backend`。
- 生产启动使用 `npm run start`，实际执行 `node dist/backend/server.js`。

## Docker 部署

- Alpine `builder` 阶段安装完整依赖并执行项目构建。
- `@vercel/nft` 从编译后的自定义 server 入口追踪实际运行依赖，生成独立生产文件包。
- 纯 Alpine `runner` 只保留 Node 可执行文件、必要系统库、配置、Next.js 运行产物和后端编译产物。
- 运行镜像不包含 npm、Yarn、开发依赖、完整 `node_modules`、构建缓存和源码。
- 容器默认监听 `0.0.0.0:3000`，可通过 `WEBTERMINAL_HOSTNAME` 和 `PORT` 覆盖。
- SSH 私钥目录不进入镜像，生产环境通过挂载提供。

## 验证标准

- `npm run build` 通过。
- `npm audit --omit=dev` 无漏洞。
- `npm run docker:build -- webterminal:dependency-cleanup-test --progress=plain` 完成。
- 使用构建后的镜像启动容器，访问 `/login` 返回 200。
