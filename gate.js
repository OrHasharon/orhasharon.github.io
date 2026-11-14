// Entry to the community site by phone number (WorshipAndSound/site_access.sql). The list of numbers is kept in
// Supabase and never reaches the browser: site_enter() answers yes/no for one number and logs the attempt with the
// device and IP address. A device that entered is remembered, and re-checked quietly on every visit (a number
// removed from the list is locked out on its next visit). Admins (and the worship team) sign in with Google in
// WorshipAndSound, which opens the site too (it sets oh-access = "ws").
// Until site_access.sql runs, the old entry code still works (the function doesn't exist yet → 404).
(function () {
  const KEY = "oh-access", PHONE = "oh-phone", DEV = "oh-dev";
  const OLD_HASH = "cbd02d97b0731d88c78d30c20d90492b2d4c3f2f983931c38fef2dedc7ce48d4"; // sha-256 of the old code
  const API = "https://pualpwrkztjzhgpaqudm.supabase.co/rest/v1/rpc/site_enter";
  const ANON = "sb_publishable_TFMMqLxLWHatd3lXYrUlTQ_aO7MvaQ9";
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  // ---------- what device is this (as far as a browser can tell) ----------
  async function deviceName() {
    const ua = navigator.userAgent;
    let h = {};
    try { h = (await navigator.userAgentData?.getHighEntropyValues(["model", "platform", "platformVersion"])) || {}; } catch {}
    let os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iPad"
      : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
    if (os === "Windows" && h.platformVersion) os = parseInt(h.platformVersion, 10) >= 13 ? "Windows 11" : "Windows 10";
    let model = (h.model || (ua.match(/Android [\d.]+; ([^;)]+)[;)]/) || [])[1] || "").trim();
    if (model === "K") model = ""; // Chrome's reduced user agent hides the model
    if (/^SM-/.test(model)) model = "Samsung Galaxy " + model;
    else if (/^Pixel/.test(model)) model = "Google " + model;
    const browser = /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera"
      : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
    let id = get(DEV);
    if (!id) { id = Math.random().toString(36).slice(2, 8); set(DEV, id); } // tells two devices of the same kind apart
    return [os, model, browser, `${screen.width}×${screen.height}`, "#" + id].filter(Boolean).join(" · ");
  }

  // → { ok, name, reason } | { missing: true } (no function yet) | null (offline / error)
  async function check(phone, kind) {
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { apikey: ANON, "Content-Type": "application/json", "Content-Profile": "or_hasharon_worship" },
        body: JSON.stringify({ p_phone: phone, p_device: await deviceName(), p_kind: kind }),
      });
      if (r.status === 404) return { missing: true };
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const access = get(KEY), saved = get(PHONE);
  if (access === "ws") return; // signed in to WorshipAndSound
  if (saved) {
    // open straight away; the quiet re-check only closes the site when the number was taken off the list
    check(saved, "visit").then((r) => {
      if (r && r.ok === false && r.reason === "unknown") { set(PHONE, null); set(KEY, null); lock("המספר שלך כבר לא ברשימה. אפשר לפנות לאוריה."); }
    });
    return;
  }
  if (access === "1") {
    // entered with the old code: fine until the phone list exists, then the phone is asked for once
    document.documentElement.classList.add("locked");
    check("", "probe-none").then((r) => {
      if (r && !r.missing) { set(KEY, null); lock(); }
      else document.documentElement.classList.remove("locked"); // old era, or offline: don't lock people out
    });
    return;
  }
  lock();

  function lock(message) {
    document.documentElement.classList.add("locked");
    const show = () => {
      if (document.getElementById("gate")) return;
      const box = document.createElement("div");
      box.id = "gate";
      box.innerHTML = `<form class="gate-box">
        <img src="/logo.png" alt="" class="gate-logo">
        <h1>קהילת אור השרון</h1>
        <label for="gate-phone">מספר טלפון</label>
        <input id="gate-phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" placeholder="050-0000000">
        <button type="submit" class="btn">כניסה</button>
        <p class="gate-err" role="alert"${message ? "" : " hidden"}>${message || ""}</p>
        <a class="gate-admin" href="/WorshipAndSound/">כניסת מנהל (Gmail)</a>
      </form>`;
      document.body.prepend(box);
      const input = box.querySelector("input"), err = box.querySelector(".gate-err"), btn = box.querySelector("button");
      const fail = (t) => { err.textContent = t; err.hidden = false; input.select(); };
      box.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) return fail("צריך להקליד מספר טלפון");
        btn.disabled = true; btn.textContent = "בודק…";
        const r = await check(v, "login");
        btn.disabled = false; btn.textContent = "כניסה";
        let ok = false;
        if (r?.missing) ok = (await sha256(v)) === OLD_HASH; // before site_access.sql: the old code
        else if (r?.ok) { ok = true; set(PHONE, v); }
        if (ok) {
          set(KEY, r?.missing ? "1" : "phone");
          document.documentElement.classList.remove("locked");
          box.remove();
        } else if (!r) fail("אין חיבור כרגע. נסו שוב בעוד רגע.");
        else if (r.reason === "blocked") fail("יותר מדי ניסיונות. נסו שוב בעוד שעה.");
        else if (r.reason === "invalid") fail("המספר לא נראה תקין");
        else fail("המספר לא ברשימה. אפשר לפנות לאוריה כדי להצטרף.");
      });
      input.focus();
    };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", show) : show();
  }
})();
