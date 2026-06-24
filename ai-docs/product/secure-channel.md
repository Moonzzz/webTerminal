---
keywords:
  - webTerminal
  - secure channel
  - RSA-OAEP
  - AES-GCM
  - HMAC
  - WebSocket authentication
summary: webTerminal 应用层安全通道设计，覆盖登录认证加密、WebSocket 首帧认证、后续消息 AES-GCM 加密、HMAC 签名、TTL 与序号防重放。
---

# webTerminal 安全通道

## 原始需求

- 认证信息，包括登录认证和 ws 通道认证，需要加签、加密传输，防止中间人解密和重放。
- 流程仿照 HTTPS：先下发非对称一次性公钥，再用非对称加密传输认证信息。
- 认证通过后下发对称密钥，后续请求体使用对称密钥加密、加签。

## 设计判断

该能力作为应用层防护实现，不能替代 HTTPS/WSS。

原因是：如果浏览器第一次拿到的一次性公钥本身没有被可信证书链或预置公钥校验，主动中间人仍可替换公钥并代理握手。生产部署仍必须使用 HTTPS/WSS；应用层安全通道用于降低明文请求体、ws 业务帧、重放请求和日志误采集带来的风险。

## 协议流程

### 握手

1. 前端调用 `/api/crypto/handshake`。
2. 后端生成短期 RSA-OAEP 2048 位密钥对、challenge、过期时间。
3. 后端只返回公钥 JWK、challenge 和算法声明，私钥保存在内存中，2 分钟内有效。
4. 握手绑定来源 IP 和 User-Agent，使用一次后立即销毁。

### 登录

1. 浏览器生成一次性客户端 RSA-OAEP 密钥对。
2. 浏览器生成一次性 AES-GCM 内容密钥。
3. 登录载荷包含 username、password、challenge、timestamp、requestId、clientPublicKeyJwk。
4. 登录载荷用 AES-GCM 加密，AES 内容密钥用服务端握手公钥 RSA-OAEP 加密。
5. 后端解密并校验 challenge、timestamp、requestId，再执行原有用户名密码校验和失败锁 IP。
6. 认证成功后，后端生成安全会话：AES-256-GCM 加密密钥、HMAC-SHA-256 签名密钥、会话 ID、过期时间。
7. 安全会话材料用客户端公钥进行混合加密后返回，前端仅保存在当前页面内存中。

### Cookie 会话后补发安全会话

页面刷新后，如果登录 cookie 仍有效，前端通过 `/api/crypto/session` 重新走一次握手并签发新的安全会话。

该接口不接收密码，只在 HttpOnly 登录 cookie 有效时签发新的应用层安全会话。

### WebSocket

1. WebSocket 建连时仍校验原有 HttpOnly 登录 cookie。
2. 连接建立后的第一条业务消息必须是加密封包 `{ type: "auth" }`。
3. 后续 `init`、`input`、`resize`、`ping` 都使用安全会话封包发送。
4. 服务端返回的 `ready`、`session`、`status`、`error`、`output`、`pong` 也统一加密后发送。

## 封包结构

安全封包包含：

- `sessionId`：安全会话 ID。
- `channel`：通道名，当前使用 `ws:client` 和 `ws:server`。
- `sequence`：单调递增序号，用于防重放。
- `requestId`：随机请求 ID。
- `timestamp`：客户端或服务端时间戳，2 分钟 TTL，允许 30 秒未来时钟偏移。
- `iv`：AES-GCM 12 字节随机 IV。
- `ciphertext`：AES-GCM 密文和认证 tag。
- `signature`：HMAC-SHA-256，对封包元数据和密文签名。

AES-GCM 的 AAD 包含 `sessionId`、`channel`、`sequence`、`requestId`、`timestamp`、`iv`，避免元数据被篡改。

## 边界与限制

- 安全会话只保存在页面内存中，刷新后重新签发；若存在 XSS，攻击者仍可能读取运行时内存中的材料，因此后续仍需要 CSP、依赖治理和输出转义。
- 当前安全会话为单进程内存态；服务重启后需要重新签发。
- 应用层公钥下发不能证明服务端身份，生产环境必须由 HTTPS/WSS 提供服务端认证。
- 登录 cookie 仍是页面访问控制边界；安全会话用于保护业务载荷和 ws 帧。
