const qrcodeElement = document.getElementById("qrcode");
const statusElement = document.getElementById("connection-status");
const refreshButton = document.getElementById("refresh-btn");
const textContainer = document.getElementById("text-container");
const textInput = document.getElementById("received-text");
const copyButton = document.getElementById("copy-btn");
const copyMessage = document.getElementById("copy-message");
const countdownElement = document.getElementById("countdown");

let socket;
let countdownInterval;
let clearTextTimeout;
let reconnectTimeout;
let activeSessionId;
let reconnectAttempts = 0;

refreshButton.addEventListener("click", () => {
    closeSocket();
    createSession();
});

copyButton.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(textInput.value);
        copyMessage.classList.remove("d-none");
        window.setTimeout(() => copyMessage.classList.add("d-none"), 3000);
    } catch {
        showStatus("复制失败", "error");
    }
});

createSession();

async function createSession() {
    showStatus("正在创建会话", "muted");
    qrcodeElement.textContent = "正在生成二维码";
    textContainer.classList.add("d-none");

    try {
        const response = await fetch("/api/session", { method: "POST" });
        if (!response.ok) {
            throw new Error("Session request failed");
        }

        const session = await response.json();
        activeSessionId = session.sessionId;
        renderQrCode(session.qrSvg);
        connectReceiver(activeSessionId);
    } catch (error) {
        showStatus(error.message === "Session request failed" ? "会话创建失败" : "二维码生成失败", "error");
        qrcodeElement.textContent = "请刷新页面后重试";
    }
}

function connectReceiver(sessionId) {
    closeSocket();
    activeSessionId = sessionId;
    socket = new WebSocket(buildWebSocketUrl(sessionId, "receiver"));

    socket.addEventListener("open", () => {
        reconnectAttempts = 0;
        showStatus("等待手机发送", "live");
    });

    socket.addEventListener("message", (event) => {
        const payload = parseMessage(event.data);
        if (!payload || payload.type !== "text") {
            return;
        }

        showReceivedText(payload.text, payload.expiresIn || 60);
    });

    socket.addEventListener("close", () => {
        if (activeSessionId !== sessionId) {
            return;
        }

        showStatus("连接中断，正在重连", "muted");
        const delay = Math.min(1000 * 2 ** reconnectAttempts, 8000);
        reconnectAttempts += 1;
        reconnectTimeout = window.setTimeout(() => connectReceiver(sessionId), delay);
    });

    socket.addEventListener("error", () => {
        showStatus("连接异常", "error");
    });
}

function showReceivedText(text, expiresIn) {
    textContainer.classList.remove("d-none");
    textInput.value = text;
    startCountdown(expiresIn);

    window.clearTimeout(clearTextTimeout);
    clearTextTimeout = window.setTimeout(() => {
        textInput.value = "";
        textContainer.classList.add("d-none");
        window.clearInterval(countdownInterval);
    }, expiresIn * 1000);
}

function startCountdown(totalSeconds) {
    let seconds = totalSeconds;
    window.clearInterval(countdownInterval);
    countdownElement.textContent = `${seconds}秒后自动清除`;

    countdownInterval = window.setInterval(() => {
        seconds -= 1;
        countdownElement.textContent = `${Math.max(seconds, 0)}秒后自动清除`;

        if (seconds <= 0) {
            window.clearInterval(countdownInterval);
        }
    }, 1000);
}

function renderQrCode(qrSvg) {
    if (typeof qrSvg !== "string" || !qrSvg.includes("<svg")) {
        throw new Error("QR code payload is unavailable");
    }

    qrcodeElement.innerHTML = qrSvg;
    const svg = qrcodeElement.querySelector("svg");
    if (svg) {
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "发送页面二维码");
    }
}

function buildWebSocketUrl(sessionId, role) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL(`${protocol}//${window.location.host}/api/sessions/${encodeURIComponent(sessionId)}/websocket`);
    url.searchParams.set("role", role);
    return url.href;
}

function parseMessage(data) {
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function showStatus(text, state) {
    statusElement.textContent = text;
    statusElement.className = `status-pill status-${state}`;
}

function closeSocket() {
    activeSessionId = undefined;
    window.clearTimeout(reconnectTimeout);

    if (socket && socket.readyState <= WebSocket.OPEN) {
        socket.close(1000, "refresh");
    }

    socket = undefined;
}
