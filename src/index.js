import { DurableObject } from "cloudflare:workers";
import QRCode from "qrcode";

const MAX_TEXT_LENGTH = 20_000;
// JSON may escape every UTF-16 code unit as six ASCII characters.
const MAX_MESSAGE_LENGTH = MAX_TEXT_LENGTH * 6 + 64;
const MAX_CONNECTIONS_PER_ROLE = 64;
const MESSAGE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 30;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{22,64}$/;
const RECEIVER_PROTOCOL_PATTERN = /^receiver\.([a-zA-Z0-9_-]{43})$/;

export class TransferSession extends DurableObject {
  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    if (role !== "receiver" && role !== "sender") {
      return jsonResponse({ error: "Invalid role" }, { status: 400 });
    }

    if (this.ctx.getWebSockets(role).length >= MAX_CONNECTIONS_PER_ROLE) {
      return jsonResponse({ error: "Too many connections" }, { status: 429 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ role });
    this.ctx.acceptWebSocket(server, [role]);
    server.send(JSON.stringify({ type: "ready", role }));

    return new Response(null, {
      status: 101,
      headers: role === "receiver"
        ? { "Sec-WebSocket-Protocol": request.headers.get("Sec-WebSocket-Protocol") }
        : undefined,
      webSocket: client
    });
  }

  async webSocketMessage(socket, message) {
    const attachment = socket.deserializeAttachment();
    if (attachment?.role !== "sender") {
      return;
    }

    const now = Date.now();
    if (!attachment.windowStart || now - attachment.windowStart >= MESSAGE_WINDOW_MS) {
      attachment.windowStart = now;
      attachment.messageCount = 0;
    }
    attachment.messageCount += 1;
    socket.serializeAttachment(attachment);
    if (attachment.messageCount > MAX_MESSAGES_PER_WINDOW) {
      socket.close(1008, "Too many messages");
      return;
    }

    if (typeof message !== "string") {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "消息格式错误" }));
      return;
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      socket.close(1009, "Message too large");
      return;
    }

    let payload;
    try {
      payload = JSON.parse(message);
    } catch {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "消息格式错误" }));
      return;
    }

    if (!payload || payload.type !== "text" || typeof payload.text !== "string") {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "消息内容无效" }));
      return;
    }

    const text = payload.text;
    if (text.length > MAX_TEXT_LENGTH) {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "文本过长" }));
      return;
    }

    if (!text.trim()) {
      socket.send(JSON.stringify({ type: "sent", success: false, error: "请输入要发送的文本" }));
      return;
    }

    const receivers = this.ctx.getWebSockets("receiver").filter((receiver) => receiver.readyState === 1);

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
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/session") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "POST" }
        });
      }

      if (!isSameOriginRequest(request, url)) {
        return jsonResponse({ error: "Cross-origin request denied" }, { status: 403 });
      }

      const receiverToken = createReceiverToken();
      const sessionId = await deriveSessionId(receiverToken);
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
        receiverToken,
        receiveUrl: receiveUrl.href,
        qrSvg
      });
    }

    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/websocket$/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return jsonResponse({ error: "Invalid session ID" }, { status: 400 });
      }
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET" } });
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      if (!isSameOriginRequest(request, url)) {
        return jsonResponse({ error: "Cross-origin request denied" }, { status: 403 });
      }
      const role = url.searchParams.get("role");
      if (role !== "receiver" && role !== "sender") {
        return jsonResponse({ error: "Invalid role" }, { status: 400 });
      }
      if (role === "receiver") {
        // The QR code exposes only the public digest. Receiving requires its preimage.
        // Carry the capability in a subprotocol so it never appears in request URLs.
        const protocol = request.headers.get("Sec-WebSocket-Protocol") || "";
        const token = protocol.match(RECEIVER_PROTOCOL_PATTERN)?.[1];
        if (!token || await deriveSessionId(token) !== sessionId) {
          return jsonResponse({ error: "Invalid receiver credentials" }, { status: 403 });
        }
      }

      const session = env.SESSIONS.getByName(sessionId);
      return session.fetch(request);
    }

    const assetRequest = normalizeAssetRequest(request);
    const response = await env.ASSETS.fetch(assetRequest);
    return withSecurityHeaders(response, url);
  }
};

function normalizeAssetRequest(request) {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    url.pathname = "/index.html";
  }

  return new Request(url, request);
}

function createReceiverToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function deriveSessionId(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function isSameOriginRequest(request, url) {
  const origin = request.headers.get("Origin");
  return (!origin || origin === url.origin) && request.headers.get("Sec-Fetch-Site") !== "cross-site";
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

function withSecurityHeaders(response, url) {
  const headers = new Headers(response.headers);
  const contentType = headers.get("Content-Type") || "";

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (contentType.includes("text/html")) {
    const websocketOrigin = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
    headers.set("Cache-Control", "no-store");
    headers.set("X-Frame-Options", "DENY");
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' https://umami.thus.chat",
        "style-src 'self'",
        "img-src 'self' data:",
        `connect-src 'self' ${websocketOrigin} https://umami.thus.chat`,
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'none'",
        ...(url.protocol === "https:" ? ["upgrade-insecure-requests"] : [])
      ].join("; ")
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
