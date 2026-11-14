// Entry code for the community site. Remembered on this device after the first time.
// Signing in to WorshipAndSound (Google login) also opens it, since the site shares this browser storage.
(function () {
  const KEY = "oh-access";
  const HASH = "cbd02d97b0731d88c78d30c20d90492b2d4c3f2f983931c38fef2dedc7ce48d4"; // sha-256 of the code
  let ok = false;
  try { ok = localStorage.getItem(KEY) === "1"; } catch {}
  if (ok) return;
  document.documentElement.classList.add("locked");

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  document.addEventListener("DOMContentLoaded", () => {
    const box = document.createElement("div");
    box.id = "gate";
    box.innerHTML = `<form class="gate-box">
      <img src="logo.png" alt="" class="gate-logo">
      <h1>קהילת אור השרון</h1>
      <label for="gate-code">קוד כניסה</label>
      <input id="gate-code" type="password" inputmode="numeric" autocomplete="off" autofocus>
      <button type="submit" class="btn">כניסה</button>
      <p class="gate-err" hidden>הקוד לא נכון</p>
    </form>`;
    document.body.prepend(box);
    const input = box.querySelector("input"), err = box.querySelector(".gate-err");
    box.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if ((await sha256(input.value.trim())) === HASH) {
        try { localStorage.setItem(KEY, "1"); } catch {}
        document.documentElement.classList.remove("locked");
        box.remove();
      } else {
        err.hidden = false; input.select();
      }
    });
    input.focus();
  });
})();
