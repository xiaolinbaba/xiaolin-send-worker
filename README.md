# xiaolin-send-worker

一个部署在 Cloudflare Workers 上的临时文本传输工具。

打开接收页面后，页面会生成一个二维码；手机扫码进入发送页面，输入文本后会通过 WebSocket 实时发送回接收页面。适合在电脑和手机之间临时传输一小段文字、链接、验证码或命令。

## 功能

- 接收端生成一次性会话二维码
- 发送端扫码后输入文本
- 通过 Cloudflare Durable Objects 维持同一个会话的 WebSocket 连接
- 文本在接收页面显示 60 秒后自动清除
- 不需要登录，不需要数据库

## 数据安全说明

这个仓库是公开仓库，代码中不包含私钥、Token 或任何需要保密的配置。

传输的数据只通过当前会话的 WebSocket 做实时中转，不写入数据库，也不会保存到仓库或静态文件中。Durable Object 只负责把同一个会话中的发送端和接收端连接起来；当前实现没有把用户发送的文本持久化存储。

需要注意：这个工具适合临时传输普通文本，不建议发送长期敏感信息、密码、私钥、身份证件等高敏感数据。二维码链接里包含会话 ID，拿到链接的人可以向该接收端发送文本，因此不要把二维码或链接公开分享。

## 技术栈

- Cloudflare Workers
- Cloudflare Durable Objects
- Worker static assets
- Browser WebSocket API

## 本地开发

```bash
npm install
npm run dev
```

打开 `http://localhost:8787`。

## 部署

```bash
npm install
npm run deploy
```

Cloudflare Workers Git 集成建议配置：

- Build command: `npm install`
- Deploy command: `npm run deploy`
- Root directory: 仓库根目录

计划使用域名：`send.thus.chat`
