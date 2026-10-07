const qrcodeElement = document.getElementById("qrcode");
const refreshButton = document.getElementById("refresh-btn");
const receivedTextElement = document.getElementById("received-text");
const copyButton = document.getElementById("copy-btn");
const copyMessage = document.getElementById("copy-message");
const countdownElement = document.getElementById("countdown");

let socket;
let receivedTextValue = "";
let countdownInterval;
let clearTextTimeout;
let reconnectTimeout;
let activeSession;
let sessionRequestController;
let copyMessageTimeout;
let textExpiresAt = 0;
let reconnectAttempts = 0;

refreshButton.addEventListener("click", createSession);

document.addEventListener("visibilitychange", updateCountdown);

copyButton.addEventListener("click", async () => {
    updateCountdown();
    if (!receivedTextValue) {
        return;
    }
    const textToCopy = receivedTextValue;
    try {
        await navigator.clipboard.writeText(textToCopy);
        if (receivedTextValue !== textToCopy) {
            return;
        }
        copyMessage.classList.remove("d-none");
        window.clearTimeout(copyMessageTimeout);
        copyMessageTimeout = window.setTimeout(() => copyMessage.classList.add("d-none"), 3000);
    } catch {
        showStatus("复制失败", "error");
    }
});

createSession();

async function createSession() {
    sessionRequestController?.abort();
    const controller = new AbortController();
    sessionRequestController = controller;
    closeSocket();
    reconnectAttempts = 0;
    showStatus("正在创建会话", "muted");
    qrcodeElement.textContent = "正在生成二维码";
    clearReceivedText("等待接收文本");

    try {
        const response = await fetch("/api/session", { method: "POST", signal: controller.signal });
        if (!response.ok) {
            throw new Error("Session request failed");
        }

        const session = await response.json();
        if (sessionRequestController !== controller || controller.signal.aborted) {
            return;
        }
        renderQrCode(session.qrSvg);
        connectReceiver(session);
    } catch (error) {
        if (sessionRequestController !== controller || controller.signal.aborted) {
            return;
        }
        showStatus(error.message === "Session request failed" ? "会话创建失败" : "二维码生成失败", "error");
        qrcodeElement.textContent = "请刷新页面后重试";
    }
}

function connectReceiver(session) {
    closeSocket();
    activeSession = session;
    const currentSocket = new WebSocket(buildWebSocketUrl(session.sessionId, "receiver"), `receiver.${session.receiverToken}`);
    socket = currentSocket;

    currentSocket.addEventListener("open", () => {
        if (socket !== currentSocket) return;
        reconnectAttempts = 0;
        showStatus("等待手机发送", "live");
    });

    currentSocket.addEventListener("message", (event) => {
        if (socket !== currentSocket) return;
        const payload = parseMessage(event.data);
        if (!payload || payload.type !== "text") {
            return;
        }

        showReceivedText(payload.text, payload.expiresIn || 60);
    });

    currentSocket.addEventListener("close", () => {
        if (socket !== currentSocket || activeSession !== session) {
            return;
        }

        showStatus("连接中断，正在重连", "muted");
        const delay = reconnectDelay(reconnectAttempts);
        reconnectAttempts += 1;
        reconnectTimeout = window.setTimeout(() => connectReceiver(session), delay);
    });

    currentSocket.addEventListener("error", () => {
        if (socket !== currentSocket) return;
        showStatus("连接异常", "error");
    });
}

function showReceivedText(text, expiresIn) {
    if (typeof text !== "string" || text.length > 20_000) return;
    clearReceivedText("等待接收文本");
    receivedTextValue = text;
    receivedTextElement.textContent = text;
    copyButton.disabled = false;
    const seconds = Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(expiresIn, 60) : 60;
    textExpiresAt = Date.now() + seconds * 1000;
    updateCountdown();
    countdownInterval = window.setInterval(updateCountdown, 1000);

    window.clearTimeout(clearTextTimeout);
    clearTextTimeout = window.setTimeout(() => {
        clearReceivedText("等待接收文本");
    }, seconds * 1000);
}

function clearReceivedText(statusText) {
    window.clearTimeout(clearTextTimeout);
    window.clearInterval(countdownInterval);
    window.clearTimeout(copyMessageTimeout);
    textExpiresAt = 0;
    receivedTextValue = "";
    receivedTextElement.textContent = "";
    copyButton.disabled = true;
    countdownElement.textContent = statusText;
    copyMessage.classList.add("d-none");
}

function updateCountdown() {
    if (!textExpiresAt) return;
    const seconds = Math.ceil((textExpiresAt - Date.now()) / 1000);
    if (seconds <= 0) {
        clearReceivedText("等待接收文本");
        return;
    }
    countdownElement.textContent = `${seconds}秒后自动清除`;
}

function renderQrCode(qrSvg) {
    if (typeof qrSvg !== "string" || !qrSvg.includes("<svg")) {
        throw new Error("QR code payload is unavailable");
    }

    const image = document.createElement("img");
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`;
    image.alt = "发送页面二维码";
    qrcodeElement.replaceChildren(image);
}

function closeSocket() {
    activeSession = undefined;
    window.clearTimeout(reconnectTimeout);

    const oldSocket = socket;
    socket = undefined;
    if (oldSocket && oldSocket.readyState <= WebSocket.OPEN) {
        oldSocket.close(1000, "refresh");
    }
}
