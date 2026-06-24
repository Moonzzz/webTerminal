# webTerminal 安全通道 worklog

## 2026-06-24

### TODO

- [ ] 生产部署补充 HTTPS/WSS、HSTS、反向代理 TLS 配置示例。
- [ ] 增加 Origin 校验和更细的 WebSocket 连接限流。
- [ ] 规划 CSP，降低前端安全会话材料被 XSS 读取的风险。
- [ ] 后续如支持多实例，需要将安全会话改为共享存储或实例亲和。

### 已完成

- [x] 新增应用层安全通道服务，支持短期 RSA-OAEP 握手、AES-GCM 加密、HMAC 签名。
- [x] 登录接口改为只接收加密认证载荷，认证成功后加密返回安全会话材料。
- [x] 新增 cookie 有效时的安全会话补发接口。
- [x] WebSocket 增加加密首帧认证，后续客户端和服务端业务帧双向加密。
- [x] SSH 会话输出改为通过发送抽象返回，由 WebSocket 层统一加密。
- [x] 前端新增 Web Crypto 客户端，接入登录页和终端页。
- [x] 安全通道会话改为页面内存态，terminal 打开时通过登录 cookie 重新签发，避免服务重启后复用过期对称密钥。
- [x] 增加序号、requestId、timestamp、challenge 校验，降低重放风险。
- [x] 移除自定义节点存储中 `password` 字段的读取逻辑，避免刷新后绕过 SSH 密码输入。
- [x] 修复登录成功后的会话接管：认证请求显式携带同源 Cookie，并使用整页跳转重新进入受保护页面，避免客户端路由复用未认证状态。
- [x] SSH 密码输入表单关闭浏览器自动完成，并标记常见密码管理器忽略，避免填充 SSH 密码或提示保存。
- [x] 运行类型检查并通过。

### 关键判断

- 一次性公钥下发本身不能替代 TLS 证书链；该功能定位为应用层加密与防重放补强。
- 登录阶段采用混合加密，避免 RSA 明文长度限制。
- 对称阶段同时使用 AES-GCM 和 HMAC：AES-GCM 提供认证加密，HMAC 显式满足封包加签和快速篡改检测。

### 相关文件

- `secure-channel.md`
- `secure-channel.ts`
- `http-api.ts`
- `ws-server.ts`
- `ssh-session.ts`
- `TerminalClient.tsx`
- `page.tsx`
