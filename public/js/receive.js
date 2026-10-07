const params = new URLSearchParams(window.location.search);
const sessionId = params.get("sid");
const textInput = document.getElementById("text-input");
const sendButton = document.getElementById("send-btn");
const sendMessage = document.getElementById("send-message");
const charCount = document.getElementById("char-count");

let socket;
let reconnectTimeout;
let reconnectAttempts = 0;
let messageTimeout;
let sending = false;
let pendingText;
let acknowledgementTimeout;

sendButton.addEventListener("click", sendText);
textInput.addEventListener("input", updateCharacterCount);
textInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        sendText();
    }
});
updateCharacterCount();

if (!sessionId || !/^[a-zA-Z0-9_-]{22,64}$/.test(sessionId)) {
    showStatus("缺少会话参数", "error");
    showMessage("二维码链接无效", "danger");
} else {
    connectSender();
}

function connectSender() {
    window.clearTimeout(reconnectTimeout);
    showStatus("正在连接", "muted");
    sendButton.disabled = true;
    const currentSocket = new WebSocket(buildWebSocketUrl(sessionId, "sender"));
    socket = currentSocket;

    currentSocket.addEventListener("open", () => {
        if (socket !== currentSocket) return;
        reconnectAttempts = 0;
        sendButton.disabled = false;
        showStatus("已连接", "live");
    });

    currentSocket.addEventListener("message", (event) => {
        if (socket !== currentSocket) return;
        const payload = parseMessage(event.data);
        if (!payload || payload.type !== "sent" || !sending) {
            return;
        }

        sending = false;
        window.clearTimeout(acknowledgementTimeout);
        const acknowledgedText = pendingText;
        pendingText = undefined;
        sendButton.disabled = false;
        if (payload.success) {
            showMessage("发送成功", "success");
            if (textInput.value === acknowledgedText) {
                textInput.value = "";
            }
            updateCharacterCount();
        } else {
            showMessage(`发送失败：${payload.error || "未知错误"}`, "danger");
        }
    });

    currentSocket.addEventListener("close", () => {
        if (socket !== currentSocket) return;
        sending = false;
        pendingText = undefined;
        window.clearTimeout(acknowledgementTimeout);
        sendButton.disabled = true;
        showStatus("连接中断，正在重连", "muted");
        const delay = reconnectDelay(reconnectAttempts);
        reconnectAttempts += 1;
        reconnectTimeout = window.setTimeout(connectSender, delay);
    });

    currentSocket.addEventListener("error", () => {
        if (socket !== currentSocket) return;
        showStatus("连接异常", "error");
    });
}

function sendText() {
    if (sending) return;
    const text = textInput.value.trim();
    if (!text) {
        showMessage("请输入要发送的文本", "warning");
        return;
    }

    if (text.length > 20_000) {
        showMessage("文本过长", "warning");
        return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showMessage("连接尚未就绪", "danger");
        return;
    }

    sendButton.disabled = true;
    sending = true;
    pendingText = textInput.value;
    const sendingSocket = socket;
    try {
        sendingSocket.send(JSON.stringify({ type: "text", text }));
        acknowledgementTimeout = window.setTimeout(() => {
            if (socket !== sendingSocket || !sending) return;
            sending = false;
            pendingText = undefined;
            showMessage("未收到发送确认，请检查接收端后重试", "warning");
            sendingSocket.close(1000, "Acknowledgement timeout");
        }, 15_000);
    } catch {
        sending = false;
        pendingText = undefined;
        sendButton.disabled = socket.readyState !== WebSocket.OPEN;
        showMessage("发送失败，请重试", "danger");
    }
}

function showMessage(text, type) {
    sendMessage.className = `alert alert-${type} message-slot mt-3`;
    sendMessage.textContent = text;
    window.clearTimeout(messageTimeout);
    messageTimeout = window.setTimeout(() => sendMessage.classList.add("d-none"), 3000);
}

function updateCharacterCount() {
    charCount.textContent = `${textInput.value.length} / 20000`;
}
