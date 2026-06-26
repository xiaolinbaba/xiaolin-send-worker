# 安全传输文本内容

安全方便传输文本信息。由 XIAOLIN AI LAB 出品。

网站地址：https://send.thus.chat/

## 这个网站做什么

安全传输文本内容用于在手机与电脑之间临时传输文本。接收设备打开网站后会生成二维码，发送设备扫码进入发送页面，输入文本后通过 WebSocket 实时发送回接收设备。

## 主要特点

- 扫码即可发送文本。
- 不需要登录。
- 不需要安装应用。
- 使用 Cloudflare Workers 和 Durable Objects 实现实时传输。
- 文本显示 60 秒后自动清除。
- 单次文本长度上限为 20,000 字符。
- 接收端预览会模糊部分内容，复制时仍会复制完整文本。

## 数据安全

用户发送的文本只在当前会话中实时中转。当前实现没有数据库，不会持久化保存用户发送的文本。二维码链接包含会话 ID，不应公开分享。

这个工具适合临时传输普通文本，不建议传输密码、私钥、身份证件、支付信息等高敏感数据。

## 出品方

XIAOLIN AI LAB

- 官网：https://www.thus.chat/
- 邮箱：ceo@thus.chat
- GitHub：https://github.com/xiaolinbaba/xiaolin-send-worker
