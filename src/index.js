import { DurableObject } from "cloudflare:workers";
import QRCode from "qrcode";

const MAX_TEXT_LENGTH = 20_000;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{22,64}$/;

export class TransferSession extends DurableObject {
  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    if (role !== "receiver" && role !== "sender") {
      return Response.json({ error: "Invalid role" }, { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ role });
    this.ctx.acceptWebSocket(server, [role]);
    server.send(JSON.stringify({ type: "ready", role }));

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(socket, message) {
    const attachment = socket.deserializeAttachment();
    if (attachment?.role !== "sender") {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "消息格式错误" }));
      return;
    }

    if (payload.type !== "text" || typeof payload.text !== "string") {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "消息内容无效" }));
      return;
    }

    const text = payload.text;
    if (!text.trim()) {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "请输入要发送的文本" }));
      return;
    }

    if (text.length > MAX_TEXT_LENGTH) {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "文本过长" }));
      return;
    }

    const receivers = this.ctx.getWebSockets("receiver");

    if (receivers.length === 0) {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "接收端已断开连接" }));
      return;
    }

    const outbound = JSON.stringify({ type: "text", text, expiresIn: 60 });
    let delivered = 0;
    for (const receiver of receivers) {
      try {
        receiver.send(outbound);
        delivered += 1;
      } catch {
        // The socket may have closed between lookup and send.
      }
    }

    if (delivered === 0) {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "接收端已断开连接" }));
      return;
    }

    socket.send(JSON.stringify({ type: "sent", success: true }));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/api/session") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "POST" }
        });
      }

      const sessionId = createSessionId();
      const receiveUrl = new URL("/receive.html", url.origin);
      receiveUrl.searchParams.set("sid", sessionId);
      const qrSvg = await QRCode.toString(receiveUrl.href, {
        type: "svg",
        margin: 2,
        width: 260,
        errorCorrectionLevel: "M"
      });

      return jsonResponse({
        sessionId,
        receiveUrl: receiveUrl.href,
        qrSvg
      });
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/websocket$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return Response.json({ error: "Invalid session ID" }, { status: 400 });
      }

      const session = env.SESSIONS.getByName(sessionId);
      return session.fetch(request);
    }

    const response = await env.ASSETS.fetch(request);
    return withSecurityHeaders(response);
  }
};

function createSessionId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function jsonResponse(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...init.headers
    }
  });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  const contentType = headers.get("Content-Type") || "";

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (contentType.includes("text/html")) {
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://umami.thus.chat",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self' https://umami.thus.chat",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'none'",
        "upgrade-insecure-requests"
      ].join("; ")
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
