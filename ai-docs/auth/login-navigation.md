---
keywords:
  - login
  - websocket
  - hmr
  - navigation
summary: 修复终端 WebSocket 拦截 Next.js HMR，导致登录页无法 hydration 和跳转的问题。
---

# 登录后跳转主页面

## 原始需求

修复登录页面输入正确账号密码后未进入主页面的问题。

## 业务流程

1. 登录页通过安全通道提交用户名和密码。
2. 登录接口写入 HttpOnly 认证 Cookie。
3. 登录成功后执行整页导航，重新经过服务端首页鉴权。

## 故障根因

终端 `WebSocketServer({ server, path })` 会接收所有 HTTP Upgrade，并对非 `/ws/terminal` 请求返回 400，导致 Next.js 的 `/_next/webpack-hmr` 连接失败。React 客户端无法 hydration 后，登录表单退化为浏览器原生刷新。

终端 WebSocket 改为 `noServer` 模式，只接管 `/ws/terminal`；其他 Upgrade 请求交给 Next.js。
