// public/dark-mode.js
(function () {
  const THEME_KEY = "qr_theme"; // "dark" or "light"

  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
      document.body.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
      document.body.classList.remove("dark");
    }
  }

  function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  }
  function storeTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
  }

  // Init: default LIGHT unless stored
  const stored = getStoredTheme();
  applyTheme(stored || "light");

  window.toggleTheme = function () {
    const current = getStoredTheme() || (document.body.classList.contains("dark") ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    storeTheme(next);

    // update text on buttons annotated with data-theme-toggle
    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
      btn.textContent = next === "dark" ? "Light" : "Dark";
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    const current = getStoredTheme() || (document.body.classList.contains("dark") ? "dark" : "light");
    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
      btn.textContent = current === "dark" ? "Light" : "Dark";
    });
  });
})();
