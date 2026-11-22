// The duty roster editor ("שיבוצים") — shared by duty-send.html (Michal, private key) and admin.html (admins, signed in).
// duty.sql → duty_roster wins over the Google Sheet and data/duty.json: teams per meeting, add / delete meetings, place, kind.
// Also downloads the next 3 months as a PDF (print → "save as PDF") or a 16:9 slide (PNG) for the community presentation.
// Needs schedule.js (loadMeetings, upcomingMeetings, meetingKind, HE_DAYS).
//
//   dutyRosterEditor(el, {
//     save(row)    → Promise<{error?}>  row = {meeting_date, day, place, kind, duty, deleted}
//     teams()      → Promise<[{name, phones}]>  (phones = how many; 0 = red "no phone")
//     teamsHint    — html under the list (where new teams get their phones)
//     onSaved()    — after every save (e.g. refresh the reminders tab)
//   })  → { reload() }
function dutyRosterEditor(el, opts) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const R = { meetings: [], teams: [], open: null };

  function toast(text, err) {
    const t = document.createElement("div");
    t.className = "dr-toast" + (err ? " err" : ""); t.textContent = text; t.setAttribute("role", "status");
    document.body.append(t); setTimeout(() => t.remove(), err ? 4500 : 2200);
  }
  const phoneCount = (t) => (R.teams.find((x) => x.name === t) || {}).phones || 0;
  const places = () => [...new Set(R.meetings.map((m) => m.place).filter(Boolean))];
  const in3Months = () => { const end = new Date(); end.setHours(0, 0, 0, 0); end.setMonth(end.getMonth() + 3); return R.meetings.filter((m) => m.date <= end); };
  const teamsOf = (m) => String(m.duty || "").split(",").map((x) => x.trim()).filter(Boolean);

  async function reload() {
    const [ms, teams] = await Promise.all([loadMeetings(), opts.teams().catch(() => [])]);
    R.meetings = upcomingMeetings(ms);
    R.teams = teams || [];
    render();
  }

  const exportBar = () => `<div class="dr-bar">
      <button class="btn" data-pdf>📄 הורדת PDF</button>
      <button class="btn" data-slide>🖼️ שקופית למצגת</button>
    </div><p class="dr-hint dr-under">השיבוץ של שלושת החודשים הקרובים.</p>`;

  function render() {
    const teamOpts = R.teams.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}${t.phones ? "" : " (בלי טלפון)"}</option>`).join("");
    const card = (m) => {
      const open = R.open === m.iso;
      return `<div class="dr-card" data-iso="${m.iso}">
        <h3><span>${esc(meetingKind(m))} · יום ${esc(m.day)} ${m.dateText.slice(0, 5)}${m.swapped ? " 🔁" : ""}</span><small>${esc(m.place || "")}</small></h3>
        <div class="dr-chips">
          ${teamsOf(m).map((t) => { const ok = t === "כולם" || phoneCount(t);
            return `<span class="dr-chip${ok ? "" : " nophone"}" title="${ok ? "" : "לצוות הזה אין טלפון — לא יקבל תזכורת"}">${esc(t)}
            <button data-del-team="${esc(t)}" aria-label="הסרת ${esc(t)}">✕</button></span>`; }).join("") || `<span class="dr-hint">עוד אין תורנים</span>`}
          <select data-add-team aria-label="הוספת צוות"><option value="">+ צוות</option>${teamOpts}<option value="כולם">כולם</option><option value="__new">✎ צוות חדש…</option></select>
          <button class="dr-link" data-toggle>${open ? "סגירה" : "פרטים"}</button>
        </div>
        ${open ? `<div class="dr-det">
          <div class="row">
            <label>מקום<input data-f="place" list="dr-places" value="${esc(m.place || "")}" maxlength="120"></label>
            <label>סוג המפגש (לא חובה)<input data-f="kind" value="${esc(m.kind || "")}" maxlength="80" placeholder="${esc(meetingKind({ day: m.day }))}"></label>
          </div>
          <div class="row"><button class="btn" data-save>שמירה</button><button class="btn ghost" data-remove>מחיקת המפגש</button></div>
        </div>` : ""}
      </div>`;
    };
    el.innerHTML = `
      ${exportBar()}
      <form class="dr-form" data-dr-add>
        <h3>+ מפגש חדש</h3>
        <label>תאריך<input type="date" name="date" required></label>
        <label>מקום<input name="place" list="dr-places" maxlength="120" placeholder="כפר הבפטיסטים"></label>
        <label>סוג המפגש (לא חובה)<input name="kind" maxlength="80" placeholder="לפי היום: שבת = אסיפה, שישי = קבלת שבת"></label>
        <button class="btn">הוספת המפגש</button>
      </form>
      <datalist id="dr-places">${places().map((p) => `<option value="${esc(p)}">`).join("")}</datalist>
      ${R.meetings.map(card).join("") || `<p>אין מפגשים קרובים.</p>`}
      <p class="dr-hint">צוות באדום = אין לו טלפון, ולכן לא יקבל תזכורת. ${opts.teamsHint || ""}</p>`;
  }

  async function save(m, fields = {}, deleted = false) {
    const n = { ...m, ...fields };
    let r;
    try {
      r = await opts.save({ meeting_date: n.iso, day: n.day, place: n.place || "", kind: n.kind || "", duty: n.duty || "", deleted });
    } catch { r = { error: "network" }; }
    if (r && r.error) {
      toast({ bad_key: "הלינק לא פעיל — פני לליה", bad_date: "תאריך לא תקין", too_long: "הטקסט ארוך מדי", network: "השמירה נכשלה — בדקי חיבור" }[r.error] || "השמירה נכשלה", true);
      return false;
    }
    const ms = await loadMeetings().catch(() => null);
    if (ms) R.meetings = upcomingMeetings(ms);
    render();
    toast(deleted ? "המפגש נמחק" : "נשמר ✓");
    if (opts.onSaved) opts.onSaved(R.meetings);
    return true;
  }
  const meetingOf = (x) => R.meetings.find((m) => m.iso === x.closest("[data-iso]").dataset.iso);
  const setTeams = (m, teams) => save(m, { duty: [...new Set(teams)].join(", ") });

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-pdf]")) return downloadPdf();
    if (e.target.closest("[data-slide]")) return downloadSlide();
    const card = e.target.closest("[data-iso]");
    if (!card) return;
    const m = meetingOf(card);
    const del = e.target.closest("[data-del-team]");
    if (del) return setTeams(m, teamsOf(m).filter((t) => t !== del.dataset.delTeam));
    if (e.target.closest("[data-toggle]")) { R.open = R.open === m.iso ? null : m.iso; return render(); }
    if (e.target.closest("[data-save]")) {
      const v = (f) => card.querySelector(`[data-f="${f}"]`).value.trim();
      R.open = null; return save(m, { place: v("place"), kind: v("kind") });
    }
    if (e.target.closest("[data-remove]")) {
      if (!confirm(`למחוק את המפגש של ${m.dateText.slice(0, 5)}? הוא יוסר מהאתר.`)) return;
      R.open = null; return save(m, {}, true);
    }
  });
  el.addEventListener("change", (e) => {
    const s = e.target.closest("[data-add-team]");
    if (!s || !s.value) return;
    const m = meetingOf(s);
    let t = s.value;
    if (t === "__new") {
      t = (prompt("שם הצוות החדש (למשל: דוד ושרה)") || "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
      if (!t) { s.value = ""; return; }
    }
    setTeams(m, t === "כולם" ? ["כולם"] : [...teamsOf(m).filter((x) => x !== "כולם"), t]);
  });
  el.addEventListener("submit", async (e) => {
    const f = e.target.closest("[data-dr-add]");
    if (!f) return;
    e.preventDefault();
    if (!f.date.value) return;
    const [y, mo, d] = f.date.value.split("-").map(Number);
    const date = new Date(y, mo - 1, d);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (date < today) { toast("התאריך כבר עבר", true); return; }
    if (R.meetings.find((m) => m.iso === f.date.value)) { toast("כבר יש מפגש בתאריך הזה — אפשר לערוך אותו ברשימה", true); return; }
    const day = HE_DAYS[date.getDay()];
    const ok = await save({ iso: f.date.value, day, place: f.place.value.trim() || (day === "שבת" ? "כפר הבפטיסטים" : ""), kind: f.kind.value.trim(), duty: "" });
    if (ok) f.reset();
  });

  // ---------- exports: the next 3 months ----------
  const rangeText = (list) => list.length ? `${list[0].dateText.slice(0, 5)} – ${list[list.length - 1].dateText}` : "";
  function downloadPdf() {
    const list = in3Months();
    if (!list.length) { toast("אין מפגשים בשלושת החודשים הקרובים", true); return; }
    let p = document.getElementById("dr-print");
    if (!p) { p = document.createElement("div"); p.id = "dr-print"; document.body.append(p); }
    p.innerHTML = `<h1>שיבוץ תורנויות · קהילת אור השרון</h1><p>${rangeText(list)}</p>
      <table><thead><tr><th>תאריך</th><th>יום</th><th>מפגש</th><th>מקום</th><th>תורנים</th></tr></thead><tbody>
      ${list.map((m) => `<tr><td>${m.dateText.slice(0, 5)}</td><td>${esc(m.day)}</td><td>${esc(meetingKind(m))}</td><td>${esc(m.place || "")}</td><td>${esc(m.duty || "")}</td></tr>`).join("")}
      </tbody></table>
      <p class="foot">הנחיות לתורנים: orhasharon.github.io/#guide · לא יכולים להגיע? אפשר לבקש החלפה באתר, ב"שיבוץ מלא".</p>`;
    const old = document.title;
    document.title = `שיבוץ תורנויות ${list[0].iso}`;   // the suggested PDF file name
    document.body.classList.add("dr-printing");
    const done = () => { document.body.classList.remove("dr-printing"); document.title = old; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
    setTimeout(done, 1500);
  }

  async function downloadSlide() {
    const list = in3Months();
    if (!list.length) { toast("אין מפגשים בשלושת החודשים הקרובים", true); return; }
    const W = 1920, H = 1080, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d");
    const F = '"Noto Sans Hebrew", sans-serif';
    try { await Promise.all([document.fonts.load(`700 60px ${F}`), document.fonts.load(`400 40px ${F}`)]); } catch {}
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b1020"); g.addColorStop(1, "#1b2442");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.direction = "rtl"; x.textAlign = "right"; x.textBaseline = "middle";
    x.fillStyle = "#e8c169"; x.font = `700 72px ${F}`; x.fillText("שיבוץ תורנויות", W - 110, 120);
    x.fillStyle = "rgba(255,255,255,.72)"; x.font = `400 36px ${F}`; x.fillText(`קהילת אור השרון · ${rangeText(list)}`, W - 110, 192);
    try {
      const logo = new Image(); logo.src = new URL("logo.png", document.baseURI).href;
      await logo.decode();
      const h = 110, w = h * logo.width / logo.height; x.drawImage(logo, 110, 100, w, h);
    } catch {}
    // columns from the right: date, day, meeting, place, teams
    const cols = [W - 110, W - 290, W - 470, W - 760, W - 1090];
    const top = 270, bottom = H - 110, rowH = Math.min(72, (bottom - top) / (list.length + 1));
    const fs = Math.round(Math.min(34, rowH * 0.5));
    x.fillStyle = "rgba(232,193,105,.9)"; x.font = `700 ${fs}px ${F}`;
    ["תאריך", "יום", "מפגש", "מקום", "תורנים"].forEach((t, i) => x.fillText(t, cols[i], top + rowH / 2));
    x.fillStyle = "rgba(232,193,105,.5)"; x.fillRect(110, top + rowH - 2, W - 220, 2);
    const fit = (t, w) => { t = String(t || ""); if (x.measureText(t).width <= w) return t; while (t && x.measureText(t + "…").width > w) t = t.slice(0, -1); return t + "…"; };
    list.forEach((m, i) => {
      const y = top + rowH * (i + 1);
      if (i % 2 === 0) { x.fillStyle = "rgba(255,255,255,.05)"; x.fillRect(110, y, W - 220, rowH); }
      x.fillStyle = "#fff"; x.font = `700 ${fs}px ${F}`;
      x.fillText(m.dateText.slice(0, 5), cols[0], y + rowH / 2);
      x.font = `400 ${fs}px ${F}`;
      x.fillText(fit(m.day, 160), cols[1], y + rowH / 2);
      x.fillText(fit(meetingKind(m), 270), cols[2], y + rowH / 2);
      x.fillText(fit(m.place, 310), cols[3], y + rowH / 2);
      x.fillStyle = "#f3e3b8"; x.font = `600 ${fs}px ${F}`;
      x.fillText(fit(m.duty, cols[4] - 120), cols[4], y + rowH / 2);
    });
    x.fillStyle = "rgba(255,255,255,.55)"; x.font = `400 28px ${F}`;
    x.fillText("הנחיות לתורנים: orhasharon.github.io/#guide", W - 110, H - 60);
    c.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b); a.download = `shibutz-toranuyot-${list[0].iso}.png`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("השקופית ירדה ✓");
    }, "image/png");
  }

  return { reload, toast };
}
