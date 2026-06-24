---
keywords:
  - terminal
  - ssh-password
  - autocomplete
  - viewport
core_features:
  - 禁止 SSH 密码被浏览器自动填充
  - 页面仅保留 xterm 内部滚动条
  - 容器变化时自适应终端行列
  - SSH 输出流式 UTF-8 解码
  - SSH 密码提交后自动聚焦终端
---

# Terminal 密码与视口调整

## 原始需求

- Terminal 页 SSH 密码禁止浏览器自动填充。
- Terminal 页不出现整体滚动条，仅保留终端内部滚动条，并完整渲染终端。

## 业务流程

1. 用户进入 Terminal 页，手动输入本次 SSH 连接密码。
2. SSH 凭据输入不声明为网站密码类型，通过样式保持掩码显示，并标记密码管理器忽略，不读取或保存网站登录凭据。
3. Terminal 页面固定占满浏览器可视区域，外层裁剪溢出。
4. xterm 占满剩余空间；容器尺寸变化时重新计算终端行列并通知后端。
5. SSH 输出按流式 UTF-8 解码，避免边框类多字节字符跨 chunk 时产生乱码。
6. SSH 密码提交后 xterm 初始化并自动聚焦，用户可直接输入命令。
