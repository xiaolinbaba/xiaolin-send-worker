import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function harness(script, search = "") {
  const elements = new Map();
  const requests = [];
  const sockets = [];
  const timers = new Map();
  const copied = [];
  let clock = 100_000;
  let timerId = 0;

  class Element {
    listeners = new Map();
    textContent = "";
    value = "";
    className = "";
    children = [];
    disabled = true;
    classList = {
      add: (name) => { this.className = [...new Set([...this.className.split(" "), name])].join(" "); },
      remove: (name) => { this.className = this.className.split(" ").filter((item) => item !== name).join(" "); }
    };
    addEventListener(type, callback) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(callback);
      this.listeners.set(type, listeners);
    }
    emit(type, event = {}) {
      return Promise.all((this.listeners.get(type) || []).map((callback) => callback(event)));
    }
    replaceChildren(...children) { this.children = children; }
  }
  class Socket extends Element {
    static OPEN = 1;
    readyState = 0;
    messages = [];
    constructor(url, protocol) {
      super();
      this.url = url;
      this.protocol = protocol;
      sockets.push(this);
    }
    async open() { this.readyState = 1; await this.emit("open"); }
    send(data) { this.messages.push(JSON.parse(data)); }
    close(code, reason) { this.readyState = 3; this.closeCode = code; this.closeReason = reason; }
    message(payload) { return this.emit("message", { data: JSON.stringify(payload) }); }
  }
  const document = new Element();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  document.getElementById = get;
  document.querySelectorAll = () => [];
  document.createElement = () => new Element();
  const setTimer = (callback, delay) => {
    const id = ++timerId;
    timers.set(id, { callback, delay });
    return id;
  };
  const window = {
    location: { protocol: "https:", host: "send.example", search },
    setTimeout: setTimer, setInterval: setTimer,
    clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id)
  };
  const context = vm.createContext({
    document, window, WebSocket: Socket, URL, URLSearchParams, AbortController,
    Date: class extends Date { static now() { return clock; } },
    navigator: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }))
  });
  for (const file of ["common", script]) {
    vm.runInContext(readFileSync(new URL(`../public/js/${file}.js`, import.meta.url), "utf8"), context);
  }
  return {
    get, sockets, requests, timers, copied, document,
    advance: (milliseconds) => { clock += milliseconds; },
    runTimer: async (delay) => {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected a ${delay}ms timer`);
      timers.delete(entry[0]);
      await entry[1].callback();
    },
    session: async (index, sessionId) => {
      requests[index].resolve({ ok: true, json: async () => ({ sessionId, receiverToken: "r".repeat(43), qrSvg: `<svg>${sessionId}</svg>` }) });
      await new Promise(setImmediate);
    }
  };
}

test("rapid refresh cancels older requests and only connects the newest session", async () => {
  const page = harness("index");
  void page.get("refresh-btn").emit("click");
  assert.equal(page.requests[0].options.signal.aborted, true);
  await page.session(1, "new".repeat(11));
  await page.session(0, "old".repeat(11));
  assert.equal(page.sockets.length, 1);
  assert.match(page.sockets[0].url, /newnew/);
  assert.equal(page.sockets[0].protocol, `receiver.${"r".repeat(43)}`);
  assert.ok(!page.sockets[0].url.includes("r".repeat(43)));
  assert.match(decodeURIComponent(page.get("qrcode").children[0].src), /<svg>newnew/);
});

test("stale socket events cannot overwrite new data or schedule a reconnect", async () => {
  const page = harness("index");
  await page.session(0, "first".repeat(8));
  const first = page.sockets[0];
  await first.open();
  void page.get("refresh-btn").emit("click");
  await page.session(1, "second".repeat(7));
  await page.sockets[1].open();
  await first.message({ type: "text", text: "stale", expiresIn: 60 });
  await first.emit("error");
  await first.emit("close");
  assert.equal(page.get("received-text").textContent, "");
  assert.equal(page.get("connection-status").textContent, "等待手机发送");
  assert.equal(page.timers.size, 0);
});

test("expiration uses elapsed time and removes text on returning from a suspended tab", async () => {
  const page = harness("index");
  await page.session(0, "a".repeat(43));
  await page.sockets[0].open();
  await page.sockets[0].message({ type: "text", text: "<script>literal</script>", expiresIn: 60 });
  assert.equal(page.get("received-text").textContent, "<script>literal</script>");
  page.advance(20_000);
  await page.document.emit("visibilitychange");
  assert.equal(page.get("countdown").textContent, "40秒后自动清除");
  page.advance(41_000);
  await page.document.emit("visibilitychange");
  await page.get("copy-btn").emit("click");
  assert.equal(page.get("received-text").textContent, "");
  assert.equal(page.get("copy-btn").disabled, true);
  assert.equal(page.timers.size, 0);
  assert.equal(page.copied.length, 0);
});

test("keyboard repeats send once and acknowledgement preserves newly typed text", async () => {
  const page = harness("receive", `?sid=${"s".repeat(43)}`);
  const socket = page.sockets[0];
  await socket.open();
  page.get("text-input").value = "first message";
  const shortcut = { ctrlKey: true, key: "Enter" };
  await page.get("text-input").emit("keydown", shortcut);
  await page.get("text-input").emit("keydown", shortcut);
  assert.equal(socket.messages.length, 1);
  page.get("text-input").value = "next message";
  await socket.message({ type: "sent", success: true });
  assert.equal(page.get("text-input").value, "next message");
  assert.equal(page.get("send-btn").disabled, false);
  await page.get("send-btn").emit("click");
  await socket.message({ type: "sent", success: true });
  assert.equal(page.get("text-input").value, "");
  assert.equal(socket.messages.length, 2);
});

test("missing acknowledgements retain input and close the connection before retry", async () => {
  const page = harness("receive", `?sid=${"s".repeat(43)}`);
  await page.sockets[0].open();
  page.get("text-input").value = "pending";
  await page.get("send-btn").emit("click");
  await page.runTimer(15_000);
  assert.equal(page.get("text-input").value, "pending");
  assert.equal(page.sockets[0].readyState, 3);
  assert.match(page.get("send-message").textContent, /未收到发送确认/);
});

test("invalid QR parameters never open a websocket or start reconnect loops", () => {
  for (const search of ["", "?sid=short", `?sid=${"%2F".repeat(32)}`]) {
    const page = harness("receive", search);
    assert.equal(page.sockets.length, 0);
    assert.equal(page.get("send-btn").disabled, true);
    assert.match(page.get("send-message").textContent, /二维码链接无效/);
  }
});
