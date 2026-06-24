---
keywords: [docker, validation, worklog, login]
summary: Docker 镜像构建、容器启动和登录验证的执行记录。
---

# Docker 运行验证开发日志

## TODO

- [x] 检查 Dockerfile、构建脚本、运行配置及默认登录凭据
- [x] 构建生产镜像
- [x] 启动容器并验证运行状态
- [x] 验证登录功能
- [x] 自我审查并汇总结果

## 已完成

- 2026-06-25：确认构建入口为 `npm run docker:build`，默认目标平台为 `linux/amd64`。
- 2026-06-25：确认容器默认监听 3000 端口，登录凭据支持环境变量覆盖。
- 2026-06-25：首次 Docker 构建在拉取 Dockerfile syntax 镜像阶段遇到 Docker Hub `EOF`，重试后进入构建。
- 2026-06-25：第二次 Docker 构建在 `npm ci` 阶段遇到 `ECONNRESET`，定位为容器内 npm registry 未配置镜像源。
- 2026-06-25：修复 `Dockerfile` 构建阶段 npm 配置，新增 `npm_config_registry=https://registry.npmmirror.com`，并将 `npm_config_disturl` 调整为 Node 分发镜像地址。
- 2026-06-25：重新构建 `webterminal:validation` 成功，生产构建包含 typecheck、Next.js build、后端编译及生产 bundle 裁剪。
- 2026-06-25：启动容器 `webterminal-validation`，映射 `3010:3000`，日志显示 `Ready on http://0.0.0.0:3000`。
- 2026-06-25：HTTP 验证通过：未登录访问 `/` 返回 `302 /login`，`/login` 返回 `200 OK`。
- 2026-06-25：登录验证通过：错误密码返回 `401 Invalid username or password`；正确密码返回 `200` 并生成 Cookie；携带 Cookie 调用 `/api/auth/me` 返回 `admin`，访问 `/` 返回 `200`。
- 2026-06-25：验证完成后停止并清理临时容器 `webterminal-validation`，确认无同名容器残留。
- 2026-06-25：自我审查完成；本次仅修改 Dockerfile 的构建下载源配置及新增/更新验证文档，不改动业务登录逻辑。

## 相关文件

- `Dockerfile`
- `scripts/build-docker-image.sh`
- `config/server.json`
- `README.md`
