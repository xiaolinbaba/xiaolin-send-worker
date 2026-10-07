for (const element of document.querySelectorAll("[data-current-year]")) {
    element.textContent = String(new Date().getFullYear());
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
    const element = document.getElementById("connection-status");
    element.textContent = text;
    element.className = `status-pill status-${state}`;
}

function reconnectDelay(attempts) {
    return Math.min(1000 * 2 ** Math.min(attempts, 3), 8000);
}
