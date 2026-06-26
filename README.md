# xiaolin-send-worker

Cloudflare Workers version of the text transfer tool. The receiver page creates a short-lived WebSocket session and shows a QR code. The sender page opens from the QR code and forwards text to the receiver through a Durable Object.

## Stack

- Cloudflare Workers
- Cloudflare Durable Objects
- Worker static assets
- Browser WebSocket API

## Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:8787`.

## Deploy

```bash
npm install
npm run deploy
```

For Cloudflare Workers Git integration, use:

- Build command: `npm install`
- Deploy command: `npm run deploy`
- Root directory: repository root

## Repository Name Suggestion

Use `xiaolin-send-worker`.

## Domain Suggestions

- Keep the existing domain if you want continuity: `send.nabin.cn`
- Use a Cloudflare-specific subdomain if you want to test first: `cf-send.nabin.cn`
- Use a clearer product name if this becomes public: `text-send.nabin.cn`
