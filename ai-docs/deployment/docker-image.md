---
keywords:
  - webTerminal
  - Dockerfile
  - docker buildx
  - linux/amd64
  - container image
summary: webTerminal Docker 镜像构建说明，覆盖 Dockerfile 分层、x86 Linux 镜像目标、macOS buildx 构建策略和运行时配置。
---

# webTerminal Docker 镜像构建

## 原始需求

- 为当前项目添加 Dockerfile。
- 添加 Docker 镜像打包命令脚本。
- 镜像目标为 x86 Linux。
- 当前环境为 macOS 时，需要使用 buildx 构建 x86 Linux 镜像。
- 运行镜像采用 Alpine，只保留生产启动必须的文件和依赖。

## 构建流程

1. `builder` 使用 Node 22 + Alpine 3.24，通过 `npm ci` 安装锁定依赖。
2. builder 执行 `npm run build`，产出 `frontend/.next` 和 `dist/backend`。
3. `build:bundle` 使用 `@vercel/nft` 从 `dist/backend/server.js` 追踪真实运行依赖，生成 `dist/production`。
4. 生产包排除前端源码、构建缓存、类型文件、source map、开发工具和完整 `node_modules`，只额外保留 Next 自定义 server 动态解析所需文件。
5. 当前前端不使用 `next/image`，Next 配置显式关闭运行时图片优化；生产包因此不携带 Sharp/libvips。
6. `runner` 使用纯 Alpine 3.24，只安装 `libstdc++`，从 builder 复制 Node 可执行文件、Node 许可证和 `dist/production`，并以 `node` 用户启动。
7. Docker 内 npm 安装阶段设置 `npm_config_disturl=https://mirrors.ustc.edu.cn/node/`，用于 native 依赖构建时下载 Node 头文件等 Node.js 分发资源。

## 方案边界

当前后端通过自定义 Next server 统一承载登录鉴权、HTTP API、WebSocket/SSH 和前端请求。Next.js standalone 输出不会追踪自定义 server，不能直接替换现有启动入口。因此本项目保留单进程结构，使用 Node File Trace 对实际入口独立追踪，而不是运行 standalone 生成的 `server.js`。

生产依赖追踪可能报告 Next 动态加载和可选依赖告警；镜像构建后必须通过容器启动、登录页、鉴权跳转和静态资源验证，防止动态依赖漏拷贝。

## 体积结果

2026-06-24 的 `linux/amd64` 实测：

- 调整前 `webterminal:latest`：558 MB。
- 最小化镜像：183 MB。
- 运行应用文件层：约 44.1 MB，其中生产文件包逻辑大小约 42.1 MiB。
- 总体减少约 67%。

## 镜像打包脚本

`build-docker-image.sh` 默认构建 `linux/amd64` 镜像：

- macOS：使用 `docker buildx build --platform linux/amd64 --load`。
- x86 Linux：使用 `docker build --platform linux/amd64`。
- 其他架构：使用 `docker buildx build --platform linux/amd64 --load`。

默认镜像名为 `webterminal:latest`，可通过首个参数覆盖：

```bash
npm run docker:build -- webterminal:latest
```

## 运行时配置

镜像默认监听容器内 `0.0.0.0:3000`。应用认证、允许连接目标和 SSH 配置继续复用 `config/server.json` 中的环境变量占位机制。

生产启动命令为：

```bash
node dist/backend/server.js
```

监听地址通过 `WEBTERMINAL_HOSTNAME` 覆盖，端口通过 `PORT` 覆盖。不要使用容器默认注入的 `HOSTNAME` 作为监听地址。

私钥目录 `keys/` 不进入镜像，生产运行时需要通过挂载方式提供私钥或自定义配置文件。
