# 代码审核记录

审核日期：2026-10-07。范围包括全部 Worker、前端 JavaScript、HTML/CSS、静态说明文件、图标脚本、依赖及 Wrangler 配置。

## 已修复的问题

| 问题 | 影响 | 修复 |
| --- | --- | --- |
| 接收角色无需独立鉴权 | 拿到发送二维码的人可改用 receiver 角色读取后续文本 | 接收端持有 256 位随机凭证；公开会话 ID 为凭证的 SHA-256 摘要，只有提交正确原像才允许接收连接 |
| 缺少跨站握手检查 | 其他网站可通过浏览器建立会话连接或触发二维码生成 | 检查 Origin 和 Sec-Fetch-Site；缺省 Origin 的非浏览器客户端仍可使用发送接口 |
| JSON null、二进制及超大消息处理不足 | null 引发异常，超大消息在长度检查前已经解析 | 类型与原始帧长度前置校验，保留完整的 20,000 字符及 JSON 转义支持 |
| 单会话连接和消息数量无界 | 恶意连接或消息洪泛增加转发和解析消耗 | 每角色最多 64 个连接；每发送连接每 10 秒最多 30 条消息，计数通过附件保留至休眠恢复 |
| 统计页面 URL 包含 sid | 发送能力可能进入统计数据 | Umami 配置排除 URL 查询和片段；已核对当前公开脚本确实支持这两个选项 |
| QR SVG 直接注入 innerHTML | 扩大未来异常 SVG 的执行面 | 用 SVG 图像 URL 渲染，保留尺寸和二维码内容，不插入活动 SVG DOM |
| CSP 允许内联执行，未显式允许同源 WebSocket | 防护较弱，部分浏览器可能阻断连接 | 移除 unsafe-inline，按当前 origin 显式允许 ws/wss，本地 HTTP 不启用 upgrade-insecure-requests |
| 会话页面缓存及 Referer 参数传播 | 页面恢复旧状态，同源请求可能附带会话参数 | HTML no-store、no-referrer、防嵌套头；接收凭证使用 WebSocket 子协议，始终不写入 URL |
| 多次刷新请求、旧 socket 事件发生竞态 | 旧请求覆盖新二维码，旧回调覆盖文本或重复重连 | 取消旧请求，检查当前请求及 socket 身份，清理重连定时器 |
| 后台计时器暂停后文本过期延迟 | 页面恢复时仍显示过期文本 | 使用实际截止时间，在恢复可见及复制前再次检查；清除文本时同时取消计时器 |
| 快捷键重复发送及发送确认清空新草稿 | 同一文本重复提交，输入的新内容被误清空 | 只允许一个待确认发送，成功时只清空已提交的输入，确认等待 15 秒后保留输入并重建连接 |
| 提示定时器重叠及重复公共函数 | 后续提示提前消失，维护代码重复 | 重用公共 URL/消息/状态/重连工具，复用提示定时器 |
| 图标脚本重复绘制 | 对已填满背景再次填相同颜色 | 删除无效果的圆形绘制；重新生成的 favicon.ico 与原文件一致 |
| 本地敏感配置忽略范围过窄 | 环境配置变体可能误提交 | 忽略 .env* 和 .dev.vars*，保留可提交的 .env.example |
| 开发工具链高危依赖公告 | 本地测试/构建工具含易受攻击的间接依赖 | 更新 Wrangler 4.x 锁文件，指定 sharp 0.35.5+ 补丁覆盖；完整 npm audit 为 0 个已知漏洞 |

接收凭证和用户文本均未持久化。接收鉴权使用公开摘要验证原像，不比较两个明文秘密，也无需新增部署密钥或数据库。

## 已获得授权的 UI 修复

用户明确允许修复缩放与滚动适配问题。移除禁止缩放的 viewport 设置，以最小高度和自然纵向滚动替代固定页面高度及整体 overflow:hidden，保留现有配色、组件和内容。

## 验证结果

- `npm run check`：通过全部现有 JavaScript 语法检查。
- `npm test`：9 项真实 Workers/Durable Objects 测试及 6 项前端回归测试通过。
- Workers 测试覆盖接收鉴权、跨站检查、会话隔离、Unicode、20,000 字符及完整转义边界、异常 JSON/null/二进制、超大帧、消息洪泛、连接上限和休眠恢复；检查传输后 DO 持久化存储为空。
- 前端回归覆盖快速刷新竞态、旧 socket 回调、后台恢复时过期清除、快捷键重复发送、新草稿保留、发送确认超时、无效二维码参数。
- 浏览器实测本地两个页面连接并传输中文、emoji、换行和 HTML 标签文本；二维码图像加载正常，发送成功后正常清空输入。
- 手机视口 375×320：文档高度 431，纵向 overflow 为 auto，允许滚动访问底部；viewport 保留正常缩放设置。
- `npm run favicon`：生成文件无差异。
- `npm audit`：完整依赖树 0 个已知漏洞，生产依赖另行检查。
- `npm run deploy -- --dry-run --outdir dist`：打包通过。该检查不部署生产，也不代表生产环境已完成验收。
- 源码凭据模式检查未命中私钥或常见 Token 格式；这不是对所有可能凭据形式的绝对保证。

## 需进一步沟通的建议

1. **服务器端会话有效期**：当前清除期限针对接收页面文本，会话本身没有固定失效时间。引入固定有效期需要确认扫码链接多久过期、活动会话是否续期，以及过期提示。
2. **公网 API 的全局/IP 级限流**：当前连接和消息限制属于单会话/单连接保护，重新连接或创建大量不同会话仍可绕开。Cloudflare Rate Limiting/WAF 等网关规则需要结合账户、流量和正常使用阈值配置。
3. **隐私与可观测性**：日志已启用，traces.enabled 未开启。若需要增加链路追踪，先确定会话 URL、接收握手头、采样及保留策略；统计脚本作为页面中可执行的第三方脚本仍处于信任边界内。

## 发布注意

接收鉴权升级后，部署时已打开的旧版接收页面需要刷新，以获取独立凭证。普通扫码、发送、复制及 60 秒清除流程维持原有用途；浏览器冻结期间无法执行清除代码，恢复页面或复制时会重新检查期限。已经复制到系统剪贴板的内容由用户自行管理。

## 参考依据

- [Cloudflare WebSocket/休眠及请求校验](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare 官方测试集成](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
- [CSP connect-src 的 WebSocket 浏览器差异](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src)
- [Umami 统计脚本隐私配置](https://docs.umami.is/docs/tracker-configuration)
- [sharp 补丁公告](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
