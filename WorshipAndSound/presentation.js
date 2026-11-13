// The "מצגת" tab: for each upcoming meeting — the songs in order, whether the sermon (the speaker's PDF) is in,
// and quick actions: a personal upload link for the speaker (sermon.html?t=<token>, sent on WhatsApp), upload from
// here, take the sermon off, the PowerPoint, the projection screen. The screen (screen.js) pulls the sermon by itself.
// Storage + RPCs: sermon.sql (Uriya runs it once). Until then the tab still shows the order, PowerPoint and screen.
// The week's slides (verse, parasha, prayer requests) stay on the projection computer on purpose (privacy).
// Uses sb / state / esc / toast / isAdmin / WA_ICON / $ from ws.js, setlist / itemsFor / loadSetlist / canEditSetlist /
// openSetlist / buildPptx / quietItem from setlist.js, upcomingMeetings / meetingKind from schedule.js.

const PT = { info: {}, loaded: false, missing: false, busy: false, clearArm: null };
const PT_MAX = 40 * 1024 * 1024;

async function ptLoad() {
  if (!setlist.ready) await loadSetlist();
  const { data, error } = await sb.from("sermon_links").select("meeting_date, token, file_name, uploaded_at");
  PT.missing = !!error && ["PGRST205", "42P01", "PGRST202", "42883"].includes(error.code);
  PT.info = {};
  for (const r of data || []) PT.info[r.meeting_date] = r;
  PT.loaded = true;
}

const ptCanManage = (iso) => isAdmin || canEditSetlist(iso);
const ptDay = (iso) => iso.split("-").reverse().slice(0, 2).join("/");
const ptWhen = (ts) => new Date(ts).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function renderPresTab() {
  const el = $("deck");
  if (!PT.loaded) { el.innerHTML = `<p class="status">טוען…</p>`; ptLoad().then(() => state.tab === "deck" && renderPresTab()); return; }
  const meetings = upcomingMeetings(state.meetings).slice(0, 6);
  if (!meetings.length) { el.innerHTML = `<p class="status">אין מפגשים קרובים בלוח</p>`; return; }
  el.innerHTML = `
    <p class="hint pt-intro">המצגת של כל מפגש: השירים מהסשן, והמסר שהדובר/ת מעלה בלינק אישי — הוא מופיע לבד על מסך ההקרנה.</p>
    ${PT.missing ? `<p class="db-warning">העלאת המסר תיפתח אחרי שאוריה יריץ את sermon.sql ב-Supabase. בינתיים: סדר השירים, PowerPoint ומסך ההקרנה עובדים.</p>` : ""}
    <div class="pt-list">${meetings.map(ptCard).join("")}</div>`;
}

function ptCard(m) {
  const iso = m.iso, items = itemsFor(iso).filter((i) => i.songs);
  const info = PT.info[iso], can = ptCanManage(iso);
  const songs = items.length
    ? `<ol class="pt-songs">${items.map((i) => `<li>${quietItem(i.songs) ? "🍞 " : ""}${esc(i.songs.title)}</li>`).join("")}</ol>`
    : `<p class="pt-empty">אין עדיין שירים בסשן${can ? ` · <button class="link-btn" data-pt="session" data-iso="${iso}">פתיחת הסשן</button>` : ""}</p>`;
  const sermon = PT.missing ? "" : info?.file_name
    ? `<p class="pt-sermon ok">📄 ${esc(info.file_name)} <small>· הועלה ${ptWhen(info.uploaded_at)}</small></p>`
    : `<p class="pt-sermon missing">📄 עוד לא הועלה מסר</p>`;
  const armed = PT.clearArm?.iso === iso;
  const manage = can && !PT.missing ? `
      <button class="btn" data-pt="link" data-iso="${iso}">🔗 לינק לדובר/ת</button>
      <label class="btn ghost pt-upload">העלאה מכאן<input type="file" accept="application/pdf,.pdf" data-pt-file="${iso}" hidden></label>
      ${info?.file_name ? `<button class="btn ghost${armed ? " pt-danger" : ""}" data-pt="clear" data-iso="${iso}">${armed ? "לחיצה נוספת להסרה" : "הסרת המסר"}</button>` : ""}` : "";
  return `<article class="meeting-card pt-card">
    <h3 class="pt-title">${esc(meetingKind(m))} · ${ptDay(iso)}</h3>
    ${songs}
    ${sermon}
    <div class="pt-actions">
      ${manage}
      <button class="btn ghost" data-pt="pptx" data-iso="${iso}" ${items.length ? "" : "disabled"}>📽️ הורדת מצגת</button>
      <button class="btn ghost" data-pt="screen" data-iso="${iso}">🖥️ מסך הקרנה</button>
    </div>
  </article>`;
}

// the speaker's link: the same token every time for a meeting (sermon_link creates it once)
async function ptToken(iso) {
  const { data, error } = await sb.rpc("sermon_link", { d: iso });
  if (error || !data) { toast(error?.code === "42501" ? "אין הרשאה ליצור לינק" : "לא הצלחתי ליצור לינק", { error: true }); return null; }
  PT.info[iso] = { ...(PT.info[iso] || {}), meeting_date: iso, token: data };
  return data;
}
const ptLinkUrl = (token) => location.origin + location.pathname.replace(/[^/]*$/, "") + "sermon.html?t=" + token;

function ptLinkText(m, url) {
  return `היי! 🙏\nלינק להעלאת המסר ל*${meetingKind(m)} ${ptDay(m.iso)}*:\n${url}\n\n` +
    `מעלים קובץ PDF (ב-PowerPoint: שמירה בשם ← PDF), בלי התחברות. הוא יופיע לבד על מסך ההקרנה, ואפשר להעלות שוב כדי להחליף.\nתודה!`;
}

async function ptShowLink(iso) {
  const m = state.meetings.find((x) => x.iso === iso);
  const token = await ptToken(iso);
  if (!token || !m) return;
  const url = ptLinkUrl(token), text = ptLinkText(m, url);
  let d = document.getElementById("pt-dialog");
  if (!d) { d = document.createElement("dialog"); d.id = "pt-dialog"; d.className = "setlist-dialog"; document.body.append(d); }
  d.innerHTML = `<div class="sl-box">
    <button class="sl-close" data-pt="close" aria-label="סגירה">✕</button>
    <h2>🔗 לינק לדובר/ת · ${ptDay(iso)}</h2>
    <p class="hint">לינק אישי למפגש הזה: מעלים PDF בלי התחברות, והמסר מופיע לבד על מסך ההקרנה. שלחו רק לדובר/ת.</p>
    <p class="pt-url" dir="ltr">${esc(url)}</p>
    <div class="sl-actions">
      <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${WA_ICON} שליחה בוואטסאפ</a>
      <button class="btn ghost" type="button" data-pt="copy">📋 העתקת הלינק</button>
    </div>
  </div>`;
  d._url = url;
  if (!d.open) d.showModal();
}

async function ptUpload(iso, file) {
  if (!file || PT.busy) return;
  if (!/pdf$/i.test(file.type || file.name)) { toast("צריך קובץ PDF (ב-PowerPoint: שמירה בשם ← PDF)", { error: true }); return; }
  if (file.size > PT_MAX) { toast("הקובץ גדול מ-40MB", { error: true }); return; }
  PT.busy = true;
  toast("מעלה את המסר…");
  try {
    const token = PT.info[iso]?.token || (await ptToken(iso));
    if (!token) return;
    const path = `${token}/${Date.now()}-sermon.pdf`;
    const up = await sb.storage.from("sermons").upload(path, file, { contentType: "application/pdf", upsert: false });
    if (up.error) throw up.error;
    const at = await sb.rpc("sermon_attach", { t: token, path, fname: file.name });
    if (at.error) throw at.error;
    PT.info[iso] = { ...PT.info[iso], file_name: file.name, uploaded_at: new Date().toISOString() };
    toast("המסר הועלה ✓ · יופיע לבד על מסך ההקרנה");
  } catch (err) { console.error(err); toast("ההעלאה נכשלה", { error: true }); }
  finally { PT.busy = false; renderPresTab(); }
}

async function ptClear(iso) {
  if (PT.clearArm?.iso !== iso) {
    clearTimeout(PT.clearArm?.timer);
    PT.clearArm = { iso, timer: setTimeout(() => { PT.clearArm = null; renderPresTab(); }, 4000) };
    renderPresTab(); return;
  }
  clearTimeout(PT.clearArm.timer); PT.clearArm = null;
  const { error } = await sb.rpc("sermon_clear", { d: iso });
  if (error) { toast("ההסרה נכשלה", { error: true }); renderPresTab(); return; }
  PT.info[iso] = { ...PT.info[iso], file_name: null, uploaded_at: null };
  toast("המסר הוסר. מחשב הקרנה שכבר טען אותו ישאיר אותו עד שיוסר שם (✕ בסרגל).");
  renderPresTab();
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-pt]");
  if (!b) return;
  const a = b.dataset.pt, iso = b.dataset.iso;
  if (a === "close") { document.getElementById("pt-dialog")?.close(); return; }
  if (a === "copy") {
    const url = document.getElementById("pt-dialog")?._url || "";
    navigator.clipboard?.writeText(url).then(() => toast("הלינק הועתק"), () => prompt("הלינק:", url));
    return;
  }
  if (a === "session") { openSetlist(iso); return; }
  if (a === "screen") { window.open("screen.html?d=" + iso, "_blank"); return; }
  if (a === "link") { if (PT.busy) return; PT.busy = true; try { await ptShowLink(iso); } finally { PT.busy = false; } return; }
  if (a === "clear") { ptClear(iso); return; }
  if (a === "pptx") {
    const label = b.textContent; b.disabled = true; b.textContent = "יוצר מצגת…";
    try { await buildPptx(iso); } catch (err) { console.error(err); toast("יצירת המצגת נכשלה"); }
    b.disabled = false; b.textContent = label;
  }
});
document.addEventListener("click", (e) => { if (e.target.id === "pt-dialog") e.target.close(); });
document.addEventListener("change", (e) => {
  const f = e.target.closest?.("[data-pt-file]");
  if (f) { ptUpload(f.dataset.ptFile, f.files[0]); f.value = ""; }
});
