# allowList 用户输入节点连接 worklog

## TODO

- [x] 移除后端预配置节点模型。
- [x] 移除 `nodeId` 创建 SSH 会话路径。
- [x] 拆分后端 WebSocket 协议、Terminal Session Manager、SSH Connector。
- [x] 前端首页改为只输入 host、port、username。
- [x] 移除前端 allowList 获取、展示和本地准入校验。
- [x] 后端保留 allowList 作为唯一准入校验。
- [x] 终端页只允许 `/terminal/custom`。
- [x] 终端 WebSocket init 改为发送 `target`。
- [x] 更新功能文档。
- [x] 运行类型检查和构建验证。

## 已完成改动

- `config.ts`
  - 移除 `NodeConfig`、`configuredNodes` 和私钥节点配置解析。
  - 保留 `allowedTargets` 作为唯一 SSH 目标白名单。
- `http-api.ts`
  - 移除 `/api/nodes` 预配置节点列表。
  - 移除 `/api/targets`，不向前端返回 allowList，避免节点信息外泄。
- `terminal-protocol.ts`
  - 新增 WebSocket 业务消息归一化。
  - `init` 消息只接受 `target`，不接受 `nodeId`。
- `terminal-session-manager.ts`
  - 新增 session Map、恢复、回放缓冲、attach/detach 管理。
  - 在创建 SSH 会话前执行 allowList 服务端校验。
- `ssh-connector.ts`
  - 新增 `ssh2` 连接封装，隔离 shell、输入、resize、keepalive。
- `ws-server.ts`
  - 保留 WebSocket 鉴权、安全通道解密和消息分发职责。
  - 使用 `terminal-protocol`、`terminal-session-manager` 完成业务处理。
- `page.tsx`
  - 移除预配置节点列表 UI。
  - 移除 allowList 获取和展示。
  - 只做 host/port/username 基础格式校验和节点输入记忆。
- `TerminalClient.tsx`
  - 移除 `nodeId` 和 `customNode` 分支。
  - WebSocket init 改为发送 `target`。
- `[nodeId]/page.tsx`
  - 只允许 `custom`，其他路径重定向回首页。
- `globals.css`
  - 删除预配置节点卡片样式。
- `package.json`
  - `build:backend` 在编译前清理 `dist/backend`，避免删除源码文件后残留旧 JS 产物。

## 验证记录

- `npm run typecheck`：通过。
- `npm run build`：通过，包含 Next 前端构建和后端 TypeScript 编译。
- `npm run build:bundle`：通过，生产包 2138 files / 42.2 MiB。
- 构建后确认 `dist/backend/lib` 不再包含旧的 `nodes.js`、`ssh-session.js`。
- 构建后确认 `dist/production/dist/backend/lib` 不再包含旧的 `nodes.js`、`ssh-session.js`。
- 搜索确认前端、后端和生产后端产物均无 `/api/targets` 暴露接口；allowList 只保留在服务端配置解析和服务端校验路径。
