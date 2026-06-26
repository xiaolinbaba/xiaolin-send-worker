for (const element of document.querySelectorAll("[data-current-year]")) {
    element.textContent = String(new Date().getFullYear());
}
