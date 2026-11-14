// admin.html (admins): who may enter the community site by phone number, and the entry log (site_access.sql).
// Shows each listed number's last entry and devices, and every attempt with a number that is NOT on the list.
const siteAcc = { loaded: false, loading: false, missing: false, phones: [], logs: [], err: "", views: [], viewsMissing: false, vq: "" };

const normPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.startsWith("972") ? "0" + d.slice(3) : d; };
const fmtPhone = (p) => (/^05\d{8}$/.test(p) ? p.slice(0, 3) + "-" + p.slice(3) : p);
const fmtWhen = (t) => {
  const d = new Date(t);
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
};

async function loadSiteAccess() {
  siteAcc.loading = true;
  const [ph, lg] = await Promise.all([
    sb.from("site_phones").select("*").order("name"),
    sb.from("site_logins").select("*").order("at", { ascending: false }).limit(3000),
  ]);
  const e = ph.error || lg.error;
  siteAcc.missing = !!e && /PGRST205|42P01|does not exist|schema cache/i.test(`${e.code} ${e.message}`);
  siteAcc.err = e && !siteAcc.missing ? e.message : "";
  siteAcc.phones = ph.data || [];
  // who opened which video (site_views.sql); until it runs, the views box says so
  const vw = await sb.from("site_views").select("*").order("at", { ascending: false }).limit(5000);
  siteAcc.viewsMissing = !!vw.error;
  siteAcc.views = vw.data || [];
  siteAcc.logs = lg.data || [];
  siteAcc.loaded = true; siteAcc.loading = false;
}

// one device = its short id (#abc123, kept in the browser by gate.js); the same device on another network (home
// Wi-Fi / cellular) is still one device, with several IP addresses
const devKey = (device) => (String(device || "").match(/#(\w+)$/) || [])[1] || String(device || "");
// group log rows: per phone → { last, count, devices: Map(device id → {device, ips: Set, last, count}) }
function groupLogs(rows) {
  const by = new Map();
  for (const r of rows) {
    let g = by.get(r.phone);
    if (!g) by.set(r.phone, (g = { phone: r.phone, last: r.at, lastRow: r, count: 0, devices: new Map() }));
    g.count += r.hits || 1;
    const k = devKey(r.device);
    const d = g.devices.get(k);
    if (d) { d.count += r.hits || 1; if (r.ip) d.ips.add(r.ip); }
    else g.devices.set(k, { device: r.device, ips: new Set(r.ip ? [r.ip] : []), last: r.at, count: r.hits || 1 });
  }
  return by;
}

const devList = (g) => g ? `<ul class="sa-devs">${[...g.devices.values()].map((d) =>
  `<li><bdi dir="ltr" class="sa-dev">${esc(d.device || "מכשיר לא ידוע")}</bdi><br>${fmtWhen(d.last)}${d.count > 1 ? ` · ${d.count} פעמים` : ""} · <bdi dir="ltr">IP ${esc([...d.ips].join(", ") || "?")}</bdi></li>`).join("")}</ul>` : "";

async function renderSiteAccess() {
  const el = document.getElementById("site-access");
  if (!el) return;
  if (!siteAcc.loaded) {
    el.innerHTML = `<p class="hint">טוען…</p>`;
    if (!siteAcc.loading) { await loadSiteAccess(); renderSiteAccess(); }
    return;
  }
  if (siteAcc.missing) {
    el.innerHTML = `<h2>כניסה לאתר הקהילה בטלפון</h2><p class="db-warning">כדי להפעיל, צריך להריץ ב-Supabase את הקובץ <b dir="ltr">site_access.sql</b>. עד אז האתר נשאר עם הקוד הישן.</p>`;
    return;
  }
  const ok = groupLogs(siteAcc.logs.filter((r) => r.ok));
  const listed = new Set(siteAcc.phones.map((p) => p.phone));
  const isAdminPhone0 = (ph) => typeof siteAdminPhones !== "undefined" && siteAdminPhones.has(ph);
  // attempts with a number that is on the list by now (or is an admin's) aren't "unknown" any more: left out
  const bad = [...groupLogs(siteAcc.logs.filter((r) => !r.ok && !listed.has(r.phone) && !isAdminPhone0(r.phone))).values()];
  const nameOf = (ph) => siteAcc.phones.find((p) => p.phone === ph)?.name || "";
  // admins aren't checked (admin.html fills siteAdminPhones from the managers list)
  const isAdminPhone = (ph) => typeof siteAdminPhones !== "undefined" && siteAdminPhones.has(ph);
  const multi = [...ok.values()].filter((g) => g.devices.size > 1 && listed.has(g.phone) && !isAdminPhone(g.phone));
  const weekAgo = Date.now() - 7 * 864e5;
  const badWeek = bad.filter((g) => new Date(g.last) > weekAgo).length;
  // the report: numbers that entered from more than one device, at the very top of the page (#sa-report)
  const reportHtml = multi.length
    ? `<div class="sa-alert" role="alert"><b>⚠ ${multi.length === 1 ? "מספר אחד נכנס" : `${multi.length} מספרים נכנסו`} לאתר מיותר ממכשיר אחד</b>
      <ul>${multi.map((g) => `<li>${esc(nameOf(g.phone) || "בלי שם")} · <bdi dir="ltr">${esc(fmtPhone(g.phone))}</bdi> · <b>${g.devices.size} מכשירים</b>${devList(g)}</li>`).join("")}</ul></div>`
    : `<div class="sa-ok">✓ אין מספר שנכנס לאתר מיותר ממכשיר אחד${typeof siteAdminPhones !== "undefined" && siteAdminPhones.size ? " (בלי המנהלים)" : ""}.</div>`;
  renderViews(nameOf, isAdminPhone);
  const report = document.getElementById("sa-report");
  if (report) report.innerHTML = reportHtml + chartsHtml(siteAcc.logs.filter((r) => r.ok && !isAdminPhone(r.phone)), nameOf);
  const q = (...parts) => esc(parts.join(" ").toLowerCase() + " " + parts.map((x) => String(x || "").replace(/\D/g, "")).join(" "));
  el.innerHTML = `<h2>כניסה לאתר הקהילה בטלפון</h2>
    <p class="hint">רק מספרים שברשימה נכנסים לאתר. מכשיר שנכנס נזכר, ונבדק שוב בכל ביקור: מספר שיוסר ננעל בביקור הבא.
    דפדפן לא חושף את דגם המחשב (למשל Lenovo), אז נרשמים מערכת ההפעלה, הדפדפן, גודל המסך, דגם הטלפון כשאפשר (למשל Samsung Galaxy), מזהה קצר של המכשיר (#…) וכתובת ה-IP.</p>
    ${siteAcc.err ? `<p class="db-warning">${esc(siteAcc.err)}</p>` : ""}
    ${report ? "" : reportHtml}
    <input type="search" class="sa-search" id="sa-search" placeholder="🔍 חיפוש לפי שם או מספר" value="${esc(siteAcc.q || "")}">
    <form class="add-user sa-add"><input name="name" required placeholder="שם"><input name="phone" type="tel" required dir="ltr" placeholder="050-0000000"><button class="btn" type="submit">הוספת מספר</button></form>
    <div class="duty-table users-table"><table><thead><tr><th>שם</th><th>טלפון</th><th>כניסה אחרונה</th><th>מכשירים</th><th></th></tr></thead><tbody>
    ${siteAcc.phones.length ? siteAcc.phones.map((p) => { const g = ok.get(p.phone); return `<tr data-q="${q(p.name, p.phone)}"${g && g.devices.size > 1 && !isAdminPhone(p.phone) ? ' class="sa-multi"' : ""}>
      <td><input class="sa-name" data-sa-name="${esc(p.phone)}" value="${esc(p.name)}"></td>
      <td dir="ltr" class="sa-nw">${esc(fmtPhone(p.phone))}</td>
      <td>${g ? fmtWhen(g.last) : "עוד לא נכנס/ה"}</td>
      <td>${g ? `<details${g.devices.size > 1 ? " open" : ""}><summary>${g.devices.size > 1 ? "⚠ " : ""}${g.devices.size} ${g.devices.size === 1 ? "מכשיר" : "מכשירים"}</summary>${devList(g)}</details>` : "—"}</td>
      <td><button class="link-btn" data-sa-del="${esc(p.phone)}">הסרה</button></td></tr>`; }).join("") : `<tr><td colspan="5">אין עדיין מספרים. הוסיפו את הראשון למעלה.</td></tr>`}
    </tbody></table></div>
    <h3>ניסיונות כניסה עם מספרים שלא ברשימה</h3>
    <p class="hint">${bad.length ? `${bad.length} מספרים שונים${badWeek ? `, ${badWeek} מהם בשבוע האחרון` : ""}.` : "אין. אף אחד לא ניסה להיכנס עם מספר שלא ברשימה."}</p>
    ${bad.length ? `<div class="duty-table users-table"><table><thead><tr><th>מספר שהוקלד</th><th>ניסיון אחרון</th><th>ניסיונות</th><th>מכשיר ו-IP</th><th></th></tr></thead><tbody>
      ${bad.map((g) => `<tr data-q="${q(g.phone)}"><td dir="ltr" class="sa-nw">${esc(fmtPhone(g.phone))}</td><td>${fmtWhen(g.last)}</td><td>${g.count}</td>
        <td><details><summary>${g.devices.size} ${g.devices.size === 1 ? "מכשיר" : "מכשירים"}</summary>${devList(g)}</details></td>
        <td class="sa-nw"><button class="link-btn" data-sa-allow="${esc(g.phone)}">הוספה לרשימה</button> · <button class="link-btn" data-sa-forget="${esc(g.phone)}">הסרה</button></td></tr>`).join("")}
    </tbody></table></div>` : ""}
    <p><button class="link-btn" data-sa-refresh>רענון</button></p>`;
  siteFilter();
}

// ---------- charts (top of the admin page): entries per person, entries per day. Admins left out. ----------
// one entry = one row of the log (a device's visits within 30 minutes are one row)
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const niceMax = (m) => { if (m <= 5) return Math.max(1, m); const p = 10 ** Math.floor(Math.log10(m)); const f = m / p; return (f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
function chartsHtml(rows, nameOf) {
  if (!rows.length) return `<div class="ch-box"><h2>כניסות לאתר</h2><p class="adm-hint">עוד אין כניסות להציג (בלי המנהלים).</p></div>`;
  const per = new Map();
  for (const r of rows) per.set(r.phone, (per.get(r.phone) || 0) + 1);
  const people = [...per].map(([ph, n]) => ({ ph, n, label: nameOf(ph) || fmtPhone(ph) })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "he"));
  const TOP = 15, top = people.slice(0, TOP), maxP = Math.max(...top.map((u) => u.n));
  const days = [];
  const today = new Date(); today.setHours(12, 0, 0, 0);
  for (let i = 29; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push({ key: dayKey(d), d, n: 0, who: new Set() }); }
  const byKey = new Map(days.map((x) => [x.key, x]));
  for (const r of rows) { const x = byKey.get(dayKey(new Date(r.at))); if (x) { x.n++; x.who.add(r.phone); } }
  const maxD = niceMax(Math.max(...days.map((x) => x.n)));
  const total30 = days.reduce((a, x) => a + x.n, 0);
  const people30 = new Set(rows.filter((r) => byKey.has(dayKey(new Date(r.at)))).map((r) => r.phone)).size;
  const dm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const ticks = [maxD, maxD / 2, 0].filter((t, i, a) => Number.isInteger(t) && a.indexOf(t) === i);
  const word = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  return `<div class="ch-box">
    <h2>כניסות לאתר</h2>
    <p class="adm-hint">${word(total30, "כניסה", "כניסות")} של ${word(people30, "אדם", "אנשים")} ב-30 הימים האחרונים · בלי המנהלים</p>
    <h3>כניסות לפי אדם</h3>
    <div class="ch-hbars">${top.map((u) => `<div class="ch-row" tabindex="0" data-tip="${esc(u.label)}: ${word(u.n, "כניסה", "כניסות")}">
      <span class="ch-lbl">${esc(u.label)}</span>
      <span class="ch-track"><span class="ch-bar" style="width:${Math.max(2, (u.n / maxP) * 92)}%"></span><span class="ch-val">${u.n}</span></span></div>`).join("")}</div>
    ${people.length > TOP ? `<p class="adm-hint">ועוד ${people.length - TOP} אנשים (בטבלה למטה)</p>` : ""}
    <h3>כניסות לפי יום · 30 ימים אחרונים</h3>
    <div class="ch-cols-wrap">
      <div class="ch-grid">${ticks.map((t) => `<div class="ch-gl" style="bottom:${(t / maxD) * 100}%"><span>${t}</span></div>`).join("")}</div>
      <div class="ch-cols">${days.map((x) => `<div class="ch-slot" tabindex="0" data-tip="${dm(x.d)}: ${word(x.n, "כניסה", "כניסות")}${x.who.size ? ` · ${word(x.who.size, "אדם", "אנשים")}` : ""}">${x.n ? `<span class="ch-col" style="height:${(x.n / maxD) * 100}%"></span>` : ""}</div>`).join("")}</div>
    </div>
    <div class="ch-x">${days.map((x, i) => `<span>${i % 5 === 4 || i === 29 ? dm(x.d) : ""}</span>`).join("")}</div>
    <details class="ch-table"><summary>הצגה כטבלה</summary><div class="duty-table"><table><thead><tr><th>יום</th><th>כניסות</th><th>אנשים</th></tr></thead><tbody>
      ${days.slice().reverse().map((x) => `<tr><td>${dm(x.d)}</td><td>${x.n}</td><td>${x.who.size}</td></tr>`).join("")}</tbody></table></div></details>
  </div>`;
}
// ---------- views: who opened which video (admins left out) ----------
const fmtVDate = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "");
function renderViews(nameOf, isAdminPhone) {
  const el = document.getElementById("sa-views");
  if (!el) return;
  if (siteAcc.viewsMissing) {
    el.innerHTML = `<h2>צפיות בסרטונים</h2><p class="db-warning">כדי לראות מי פתח איזה סרטון, צריך להריץ ב-Supabase את <b dir="ltr">site_views.sql</b>. הרישום מתחיל מרגע ההרצה.</p>`;
    return;
  }
  const rows = siteAcc.views.filter((r) => !isAdminPhone(r.phone));
  const vids = new Map();
  for (const r of rows) {
    let v = vids.get(r.video_id);
    if (!v) vids.set(r.video_id, (v = { id: r.video_id, title: r.title || "", vdate: r.vdate, vtype: r.vtype, last: r.at, opens: 0, people: new Map() }));
    v.opens += r.hits || 1;
    const p = v.people.get(r.phone);
    if (p) p.n += r.hits || 1; else v.people.set(r.phone, { name: nameOf(r.phone) || r.name || fmtPhone(r.phone), last: r.at, n: r.hits || 1 });
  }
  const list = [...vids.values()].sort((a, b) => (b.vdate || "").localeCompare(a.vdate || "") || b.last.localeCompare(a.last));
  const label = (v) => (v.vtype === "hallel" ? "הלל" : v.title || "סרטון") + (v.vdate ? " · " + fmtVDate(v.vdate).slice(0, 5) : "");
  const top = [...list].sort((a, b) => b.people.size - a.people.size || b.opens - a.opens).slice(0, 10);
  const maxN = Math.max(1, ...top.map((v) => v.people.size));
  const word = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const q = (v) => esc([v.title, v.vtype === "hallel" ? "הלל" : "דרשה", fmtVDate(v.vdate), fmtVDate(v.vdate).slice(0, 5), ...[...v.people.values()].map((p) => p.name)].join(" ").toLowerCase());
  el.innerHTML = `<h2>צפיות בסרטונים</h2>
    <p class="adm-hint">מי פתח איזה סרטון באתר (לא כמה זמן צפה) · ${word(list.length, "סרטון", "סרטונים")}, ${word(new Set(rows.map((r) => r.phone)).size, "אדם", "אנשים")} · בלי המנהלים</p>
    ${list.length ? `<h3>הסרטונים הנצפים ביותר (לפי מספר אנשים)</h3>
    <div class="ch-hbars">${top.map((v) => `<div class="ch-row" tabindex="0" data-tip="${esc(label(v))}: ${word(v.people.size, "אדם", "אנשים")}, ${word(v.opens, "פתיחה", "פתיחות")}">
      <span class="ch-lbl">${esc(label(v))}</span>
      <span class="ch-track"><span class="ch-bar" style="width:${Math.max(2, (v.people.size / maxN) * 92)}%"></span><span class="ch-val">${v.people.size}</span></span></div>`).join("")}</div>
    <input type="search" class="sa-search" id="sv-search" placeholder="🔍 חיפוש לפי תאריך (14/11), שם הסרטון או שם של אדם" value="${esc(siteAcc.vq)}">
    <div class="duty-table users-table"><table><thead><tr><th>תאריך</th><th>סרטון</th><th>אנשים</th><th>מי פתח</th></tr></thead><tbody>
    ${list.map((v) => `<tr data-vq="${q(v)}"><td class="sa-nw">${fmtVDate(v.vdate) || "—"}</td><td>${esc(v.vtype === "hallel" ? "הלל" : v.title)}</td><td>${v.people.size}</td>
      <td><details><summary>${word(v.people.size, "אדם", "אנשים")}</summary><ul class="sa-devs">${[...v.people.values()].sort((a, b) => b.last.localeCompare(a.last)).map((p) =>
        `<li><span class="sa-dev">${esc(p.name)}</span> · ${fmtWhen(p.last)}${p.n > 1 ? ` · ${p.n} פעמים` : ""}</li>`).join("")}</ul></details></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="adm-hint">עוד אף אחד לא פתח סרטון מאז שהרישום התחיל.</p>`}`;
  viewsFilter();
}
function viewsFilter() {
  const v = (siteAcc.vq || "").trim().toLowerCase();
  // the search box lives in the views box; a person's name also finds every video they opened
  document.querySelectorAll("#sa-views tr[data-vq]").forEach((tr) => {
    tr.hidden = !!v && !tr.dataset.vq.includes(v);
    const d = tr.querySelector("details"); if (d) d.open = !!v && !tr.hidden; // while searching, the names show
  });
}
document.addEventListener("input", (e) => { if (e.target.id === "sv-search") { siteAcc.vq = e.target.value; viewsFilter(); } });

// one tooltip for both charts: hover, keyboard focus or a tap
(function chartTip() {
  let tip = null;
  const show = (el, x, y) => {
    if (!tip) { tip = document.createElement("div"); tip.className = "ch-tip"; tip.setAttribute("role", "tooltip"); document.body.append(tip); }
    tip.textContent = el.dataset.tip; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(innerWidth - w - 8, Math.max(8, x - w / 2)) + "px";
    tip.style.top = Math.max(8, y - h - 12) + "px";
  };
  const hide = () => { if (tip) tip.hidden = true; };
  const at = (e) => e.target.closest?.("#sa-report [data-tip], #sa-views [data-tip]");
  document.addEventListener("pointerover", (e) => { const el = at(e); el ? show(el, e.clientX, e.clientY) : hide(); });
  document.addEventListener("pointermove", (e) => { const el = at(e); if (el) show(el, e.clientX, e.clientY); });
  document.addEventListener("focusin", (e) => { const el = at(e); if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); } else hide(); });
  document.addEventListener("scroll", hide, { passive: true });
})();

// search: hides the rows that don't match (name, or digits of the number), in both tables; no re-render, so typing keeps focus
function siteFilter() {
  const v = (siteAcc.q || "").trim().toLowerCase(), d = v.replace(/\D/g, "");
  document.querySelectorAll("#site-access tr[data-q]").forEach((tr) => {
    const t = tr.dataset.q;
    tr.hidden = !!v && !(t.includes(v) || (d.length >= 2 && t.includes(d)));
  });
}
document.addEventListener("input", (e) => { if (e.target.id === "sa-search") { siteAcc.q = e.target.value; siteFilter(); } });

async function siteAddPhone(name, raw) {
  const phone = normPhone(raw);
  if (phone.length < 9 || phone.length > 12) { toast("מספר טלפון לא תקין"); return false; }
  const { error } = await sb.from("site_phones").insert({ phone, name: name.trim(), added_by: user?.email || null });
  toast(error ? (error.code === "23505" ? "המספר כבר ברשימה" : "ההוספה נכשלה") : `${name.trim() || fmtPhone(phone)} נוסף/ה`);
  await loadSiteAccess(); renderSiteAccess();
  return !error;
}

document.addEventListener("submit", async (e) => {
  if (!e.target.matches(".sa-add")) return;
  e.preventDefault();
  e.stopImmediatePropagation(); // not the users form (it's also .add-user, for the look)
  const f = new FormData(e.target);
  await siteAddPhone(f.get("name"), f.get("phone"));
}, true);

document.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-sa-del]"), allow = e.target.closest("[data-sa-allow]"), forget = e.target.closest("[data-sa-forget]");
  if (del) {
    const p = siteAcc.phones.find((x) => x.phone === del.dataset.saDel);
    if (!confirm(`להסיר את ${p?.name || fmtPhone(del.dataset.saDel)}? המכשירים שלו/ה יינעלו בביקור הבא.`)) return;
    const { error } = await sb.from("site_phones").delete().eq("phone", del.dataset.saDel);
    toast(error ? "ההסרה נכשלה" : "הוסר/ה");
    await loadSiteAccess(); renderSiteAccess();
  } else if (forget) {
    // a recognized number (e.g. a typo of a member's): remove its failed attempts from the log
    const ph = forget.dataset.saForget;
    if (!confirm(`להסיר את הניסיונות של ${fmtPhone(ph)} מהרשימה?`)) return;
    const { data, error } = await sb.from("site_logins").delete().eq("phone", ph).eq("ok", false).select("id");
    if (!error && !data?.length) toast("צריך להריץ ב-Supabase את site_logins_delete.sql");
    else toast(error ? "ההסרה נכשלה" : "הוסר");
    await loadSiteAccess(); renderSiteAccess();
  } else if (allow) {
    const name = prompt(`שם עבור ${fmtPhone(allow.dataset.saAllow)}:`);
    if (name !== null) await siteAddPhone(name, allow.dataset.saAllow);
  } else if (e.target.closest("[data-sa-refresh]")) {
    await loadSiteAccess(); renderSiteAccess();
  }
});

document.addEventListener("change", async (e) => {
  const n = e.target.closest("[data-sa-name]");
  if (!n) return;
  const { error } = await sb.from("site_phones").update({ name: n.value.trim() }).eq("phone", n.dataset.saName);
  toast(error ? "השמירה נכשלה" : "נשמר");
  if (!error) { const p = siteAcc.phones.find((x) => x.phone === n.dataset.saName); if (p) p.name = n.value.trim(); }
});
