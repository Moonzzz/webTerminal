---
keywords:
  - webTerminal
  - allowList
  - custom SSH target
  - terminal gateway
  - frontend backend layering
summary: webTerminal 移除预配置节点后的连接模型，说明用户输入节点地址、后端 allowList 校验、前后端逻辑分层和会话恢复边界；allowList 不返回前端，避免节点信息外泄。
---

# allowList 用户输入节点连接

## 原始需求

- 重构前后端逻辑分层。
- 去除预配置节点。
- 只允许用户输入节点地址。
- 输入节点地址必须在 allowList 中才允许连接。

## 业务流程

1. 用户登录 webTerminal。
2. 用户输入 host、port、username。
3. 前端只做基础格式校验，不读取、不展示、不本地校验 allowList。
4. 终端页临时输入 SSH 密码。
5. WebSocket `init` 消息只发送用户输入的 `target`，不再发送 `nodeId`。
6. 后端 Terminal Session Manager 校验 `target.host:target.port` 必须命中 allowList。
7. 校验通过后，后端用临时密码建立 SSH shell。
8. 校验失败时，后端拒绝连接并向终端返回错误。
9. 页面刷新或断线时，前端携带同一输入 target 和原 session id 尝试恢复。
10. 如原 session 已过期，后端使用同一 target 重新执行 allowList 校验后再新建 SSH 会话。

## 后端分层

当前后端分为：

| 文件 | 职责 |
| --- | --- |
| `ws-server.ts` | WebSocket 建连、登录 cookie 鉴权、安全通道解密、消息分发 |
| `terminal-protocol.ts` | WebSocket 业务消息结构和运行时归一化 |
| `terminal-session-manager.ts` | Terminal session Map、恢复 TTL、回放缓冲、attach/detach 生命周期、allowList 校验 |
| `ssh-connector.ts` | `ssh2` 连接、shell、输入、resize、keepalive、关闭 |
| `config.ts` | 配置加载、环境变量占位、allowList 解析 |
| `http-api.ts` | 登录、退出、当前用户、安全会话；不提供 allowList 查询接口 |

已移除：

- 预配置节点模型。
- `nodeId` 创建 SSH 会话路径。
- 服务端私钥节点读取路径。
- `/api/nodes` 节点列表接口。

## 前端分层

当前前端分为：

| 文件 | 职责 |
| --- | --- |
| `page.tsx` | host/port/username 表单、基础格式校验、节点输入记忆 |
| `TerminalClient.tsx` | SSH 密码临时输入、xterm 生命周期、WebSocket、安全通道、输入缓冲、会话恢复 |
| `[nodeId]/page.tsx` | 只允许 `/terminal/custom`，其他动态路径重定向回首页 |
| `secure-channel.ts` | 浏览器端 Web Crypto 握手、加解密、签名、防重放 |

## 协议变化

WebSocket `init` 消息改为：

```json
{
  "type": "init",
  "target": {
    "name": "root@192.168.1.10:22",
    "host": "192.168.1.10",
    "port": 22,
    "username": "root",
    "password": "temporary-password"
  },
  "resumeSessionId": "optional-session-id",
  "cols": 120,
  "rows": 30
}
```

服务端不接受 `nodeId` 作为 SSH 会话创建依据。

## 安全边界

- allowList 不返回前端，避免节点信息外泄。
- 前端不做 allowList 判断；后端 allowList 校验是唯一准入边界。
- SSH 密码只在终端页临时输入，不写入 localStorage，不写入 URL。
- 首页只记住 host 对应的 port 和 username。
- 预配置私钥节点已移除，服务端不再从配置中读取 SSH 私钥。
- 当前 allowList 为精确 `host:port` 匹配，host 比较忽略大小写。

## 资源影响

- 后端不再保留预配置节点数组和私钥读取逻辑。
- 前端不再渲染节点卡片列表。
- 会话恢复仍保持单进程内存态，不引入数据库或 Redis。
- 资源消耗继续由 SSH 会话数量、回放缓冲和 Next 运行时决定。
