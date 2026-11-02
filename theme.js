// Light / dark switch shared by the main site and WorshipAndSound. Dark (the night sky) is the default.
(function () {
  const KEY = "oh-theme";
  const root = document.documentElement;
  let theme = "dark";
  try { theme = localStorage.getItem(KEY) || "dark"; } catch {}
  root.dataset.theme = theme;

  function paint(btn) {
    const light = root.dataset.theme === "light";
    btn.setAttribute("aria-checked", String(light));
    btn.title = light ? "מעבר למצב כהה" : "מעבר למצב בהיר";
  }

  document.addEventListener("DOMContentLoaded", () => {
    const host = document.querySelector(".header-inner");
    if (!host) return;
    const btn = document.createElement("button");
    btn.className = "theme-switch";
    btn.type = "button";
    btn.setAttribute("role", "switch");
    btn.innerHTML = '<span class="ts-icon ts-moon">🌙</span><span class="ts-knob"></span><span class="ts-icon ts-sun">☀️</span>';
    btn.addEventListener("click", () => {
      root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
      try { localStorage.setItem(KEY, root.dataset.theme); } catch {}
      paint(btn);
    });
    paint(btn);
    host.appendChild(btn);
  });
})();
