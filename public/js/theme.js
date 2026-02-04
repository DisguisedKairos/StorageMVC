(function () {
  function applyTheme(theme) {
    if (theme === "dark") {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
    }

    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.textContent = (theme === "dark") ? "☀️ Light Mode" : "🌙 Dark Mode";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const saved = localStorage.getItem("theme") || "light";
    applyTheme(saved);

    // Event delegation so it works even if navbar is rendered later
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("#themeToggle");
      if (!btn) return;

      const nowDark = !document.body.classList.contains("dark-mode");
      const theme = nowDark ? "dark" : "light";
      localStorage.setItem("theme", theme);
      applyTheme(theme);
    });
  });
})();