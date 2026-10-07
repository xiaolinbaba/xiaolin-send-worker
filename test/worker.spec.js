import { env, exports } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import worker from "../src/index.js";

const origin = "https://send.example";
const sockets = new Set();

afterEach(() => {
  for (const socket of sockets) {
    if (socket.readyState === 1) socket.close(1000, "Test complete");
  }
  sockets.clear();
});

async function createSession() {
  const response = await exports.default.fetch(`${origin}/api/session`, { method: "POST" });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return response.json();
}

function upgrade(session, role, headers = {}) {
  return exports.default.fetch(`${origin}/api/sessions/${session.sessionId}/websocket?role=${role}`, {
    headers: { Upgrade: "websocket", Origin: origin, ...headers }
  });
}

function nextEvent(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener(type, listener);
      reject(new Error(`Timed out waiting for ${type}`));
    }, 2000);
    function listener(event) {
      clearTimeout(timeout);
      socket.removeEventListener(type, listener);
      resolve(type === "message" ? JSON.parse(event.data) : event);
    }
    socket.addEventListener(type, listener);
  });
}

async function connect(session, role) {
  const headers = role === "receiver" ? { "Sec-WebSocket-Protocol": `receiver.${session.receiverToken}` } : {};
  const response = await upgrade(session, role, headers);
  expect(response.status).toBe(101);
  if (role === "receiver") {
    expect(response.headers.get("Sec-WebSocket-Protocol")).toBe(headers["Sec-WebSocket-Protocol"]);
  }
  const socket = response.webSocket;
  sockets.add(socket);
  const ready = nextEvent(socket, "message");
  socket.accept();
  expect(await ready).toEqual({ type: "ready", role });
  return socket;
}

async function send(socket, text) {
  const reply = nextEvent(socket, "message");
  socket.send(JSON.stringify({ type: "text", text }));
  return reply;
}

it("issues independent receiver credentials without disclosing them in the QR link", async () => {
  const a = await createSession();
  const b = await createSession();
  expect(a.sessionId).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  expect(a.receiverToken).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  expect(a.sessionId).not.toBe(b.sessionId);
  expect(a.receiverToken).not.toBe(b.receiverToken);
  expect(a.qrSvg).toContain("<svg");
  expect(new URL(a.receiveUrl).searchParams.get("sid")).toBe(a.sessionId);
  expect(a.receiveUrl).not.toContain(a.receiverToken);
  expect((await upgrade(a, "receiver")).status).toBe(403);
  expect((await upgrade(a, "receiver", { "Sec-WebSocket-Protocol": `receiver.${a.sessionId}` })).status).toBe(403);
  expect((await upgrade(a, "receiver", { "Sec-WebSocket-Protocol": `receiver.${b.receiverToken}` })).status).toBe(403);
  await connect(a, "receiver");
});

it("rejects cross-origin session creation and websocket access", async () => {
  const session = await createSession();
  for (const headers of [{ Origin: "https://attacker.example" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }]) {
    expect((await exports.default.fetch(`${origin}/api/session`, { method: "POST", headers })).status).toBe(403);
    expect((await upgrade(session, "sender", headers)).status).toBe(403);
  }
  expect((await exports.default.fetch(`${origin}/api/session`)).status).toBe(405);
  expect((await upgrade(session, "unknown")).status).toBe(400);
  expect((await exports.default.fetch(`${origin}/api/sessions/short/websocket`, { headers: { Upgrade: "websocket" } })).status).toBe(400);
  expect((await exports.default.fetch(`${origin}/api/sessions/${session.sessionId}/websocket?role=sender`)).status).toBe(426);
});

it("delivers Unicode and maximum-length text only to receivers of the same session", async () => {
  const session = await createSession();
  const receiver = await connect(session, "receiver");
  const sender = await connect(session, "sender");
  const otherSession = await createSession();
  await connect(otherSession, "receiver");
  const isolatedSender = await connect(await createSession(), "sender");
  expect(await send(isolatedSender, "isolated")).toMatchObject({ success: false, error: "接收端已断开连接" });
  for (const text of ["你好 👋\n<script>alert(1)</script>", "文".repeat(20_000)]) {
    const received = nextEvent(receiver, "message");
    expect(await send(sender, text)).toEqual({ type: "sent", success: true });
    expect(await received).toEqual({ type: "text", text, expiresIn: 60 });
  }
  // No transmitted text or receiver credential is written to DO storage.
  await runInDurableObject(env.SESSIONS.getByName(session.sessionId), async (_instance, state) => {
    expect((await state.storage.list()).size).toBe(0);
  });
});

it("rejects malformed JSON, null, binary, blank, and oversized text without breaking the session", async () => {
  const session = await createSession();
  const receiver = await connect(session, "receiver");
  const sender = await connect(session, "sender");
  for (const message of ["null", "[]", "{}", "{", "42", new Uint8Array([1, 2, 3]).buffer]) {
    const reply = nextEvent(sender, "message");
    sender.send(message);
    expect(await reply).toMatchObject({ type: "sent", success: false });
  }
  expect(await send(sender, "   \n")).toMatchObject({ success: false, error: "请输入要发送的文本" });
  expect(await send(sender, "x".repeat(20_001))).toMatchObject({ success: false, error: "文本过长" });
  const received = nextEvent(receiver, "message");
  expect(await send(sender, "still connected")).toMatchObject({ success: true });
  expect((await received).text).toBe("still connected");
});

it("accepts fully escaped JSON at the text limit and closes oversized raw frames", async () => {
  const session = await createSession();
  const receiver = await connect(session, "receiver");
  const sender = await connect(session, "sender");
  const received = nextEvent(receiver, "message");
  const reply = nextEvent(sender, "message");
  sender.send(`{"type":"text","text":"${"\\u4e2d".repeat(20_000)}"}`);
  expect(await reply).toMatchObject({ success: true });
  expect((await received).text).toBe("中".repeat(20_000));
  const closed = nextEvent(sender, "close");
  sender.send("x".repeat(120_065));
  const event = await closed;
  expect(event.code).toBe(1009);
  sender.close(1000);
});

it("retains routing and abuse counters through Durable Object hibernation", async () => {
  const session = await createSession();
  const receiver = await connect(session, "receiver");
  const sender = await connect(session, "sender");
  const received = nextEvent(receiver, "message");
  expect(await send(sender, "before hibernation")).toMatchObject({ success: true });
  await received;
  const stub = env.SESSIONS.getByName(session.sessionId);
  await evictDurableObject(stub);
  const after = nextEvent(receiver, "message");
  expect(await send(sender, "after hibernation")).toMatchObject({ success: true });
  expect((await after).text).toBe("after hibernation");
  await runInDurableObject(stub, (_instance, state) => {
    const server = state.getWebSockets("sender")[0];
    expect(server.deserializeAttachment().messageCount).toBe(2);
  });
});

it("closes flooding senders after a bounded message burst", async () => {
  const sender = await connect(await createSession(), "sender");
  for (let i = 0; i < 30; i += 1) {
    expect(await send(sender, "test")).toMatchObject({ success: false });
  }
  const closed = nextEvent(sender, "close");
  sender.send(JSON.stringify({ type: "text", text: "over limit" }));
  expect((await closed).code).toBe(1008);
  sender.close(1000);
});

it("bounds simultaneous connections while preserving the receiver slot", async () => {
  const session = await createSession();
  for (let i = 0; i < 64; i += 1) await connect(session, "sender");
  expect((await upgrade(session, "sender")).status).toBe(429);
  await connect(session, "receiver");
});

it("serves CSP with explicit websocket origins and keeps localhost HTTP working", async () => {
  const assetEnv = { ASSETS: { fetch: () => new Response("<!doctype html><title>test</title>", { headers: { "Content-Type": "text/html" } }) } };
  for (const url of [origin, "http://localhost:8787"]) {
    const response = await worker.fetch(new Request(url), assetEnv);
    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain(url.startsWith("https:") ? "wss://send.example" : "ws://localhost:8787");
    expect(csp.includes("upgrade-insecure-requests")).toBe(url.startsWith("https:"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  }
});
