// toggles dark mode via POST to server; persists in session
document.addEventListener("DOMContentLoaded", () => {
  const toggles = document.querySelectorAll("[data-toggle-dark]");
  toggles.forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await fetch("/toggle-darkmode", { method: "POST" });
        // reload page so server-sent class is applied
        window.location.reload();
      } catch (err) {
        console.error(err);
      }
    });
  });
});
