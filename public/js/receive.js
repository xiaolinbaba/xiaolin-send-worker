const params = new URLSearchParams(window.location.search);
const sessionId = params.get("sid");
const statusElement = document.getElementById("connection-status");
const textInput = document.getElementById("text-input");
const sendButton = document.getElementById("send-btn");
const sendMessage = document.getElementById("send-message");
const charCount = document.getElementById("char-count");

let socket;
let reconnectTimeout;
let reconnectAttempts = 0;

sendButton.addEventListener("click", sendText);
textInput.addEventListener("input", updateCharacterCount);
textInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        sendText();
    }
});
updateCharacterCount();

if (!sessionId) {
    showStatus("缺少会话参数", "error");
    showMessage("二维码链接无效", "danger");
} else {
    connectSender();
}

function connectSender() {
    showStatus("正在连接", "muted");
    sendButton.disabled = true;
    socket = new WebSocket(buildWebSocketUrl(sessionId, "sender"));

    socket.addEventListener("open", () => {
        reconnectAttempts = 0;
        sendButton.disabled = false;
        showStatus("已连接", "live");
    });

    socket.addEventListener("message", (event) => {
        const payload = parseMessage(event.data);
        if (!payload || payload.type !== "sent") {
            return;
        }

        sendButton.disabled = false;
        if (payload.success) {
            showMessage("发送成功", "success");
            textInput.value = "";
            updateCharacterCount();
        } else {
            showMessage(`发送失败：${payload.error || "未知错误"}`, "danger");
        }
    });

    socket.addEventListener("close", () => {
        sendButton.disabled = true;
        showStatus("连接中断，正在重连", "muted");
        const delay = Math.min(1000 * 2 ** reconnectAttempts, 8000);
        reconnectAttempts += 1;
        reconnectTimeout = window.setTimeout(connectSender, delay);
    });

    socket.addEventListener("error", () => {
        showStatus("连接异常", "error");
    });
}

function sendText() {
    const text = textInput.value.trim();
    if (!text) {
        showMessage("请输入要发送的文本", "warning");
        return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showMessage("连接尚未就绪", "danger");
        return;
    }

    sendButton.disabled = true;
    socket.send(JSON.stringify({ type: "text", text }));
}

function buildWebSocketUrl(currentSessionId, role) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = new URL(`${protocol}//${window.location.host}/api/sessions/${encodeURIComponent(currentSessionId)}/websocket`);
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

function showMessage(text, type) {
    sendMessage.className = `alert alert-${type} mt-3`;
    sendMessage.textContent = text;
    window.setTimeout(() => sendMessage.classList.add("d-none"), 3000);
}

function updateCharacterCount() {
    charCount.textContent = `${textInput.value.length} / 20000`;
}
