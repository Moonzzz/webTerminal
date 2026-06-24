---
keywords: [docker, image, container, login, validation]
summary: 构建生产镜像，启动容器并验证服务启动及登录功能。
---

# Docker 运行验证

## 原始需求

构建 Docker 镜像，启动容器，验证服务能够正常启动且登录功能可用。

## 验证流程

1. 使用项目 Dockerfile 构建生产镜像。
2. 使用独立测试凭据启动容器并检查运行状态与日志。
3. 通过 HTTP 与登录安全通道协议验证未登录保护、错误凭据和正确凭据登录。
