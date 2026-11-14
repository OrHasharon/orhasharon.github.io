// admin.html (admins): who may enter the community site by phone number, and the entry log (site_access.sql).
// Shows each listed number's last entry and devices, and every attempt with a number that is NOT on the list.
const siteAcc = { loaded: false, loading: false, missing: false, phones: [], logs: [], err: "" };

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
  const bad = [...groupLogs(siteAcc.logs.filter((r) => !r.ok)).values()];
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
  const report = document.getElementById("sa-report");
  if (report) report.innerHTML = reportHtml;
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
        <td>${listed.has(g.phone) ? "נוסף מאז" : `<button class="link-btn" data-sa-allow="${esc(g.phone)}">הוספה לרשימה</button>`}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
    <p><button class="link-btn" data-sa-refresh>רענון</button></p>`;
  siteFilter();
}

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
  const del = e.target.closest("[data-sa-del]"), allow = e.target.closest("[data-sa-allow]");
  if (del) {
    const p = siteAcc.phones.find((x) => x.phone === del.dataset.saDel);
    if (!confirm(`להסיר את ${p?.name || fmtPhone(del.dataset.saDel)}? המכשירים שלו/ה יינעלו בביקור הבא.`)) return;
    const { error } = await sb.from("site_phones").delete().eq("phone", del.dataset.saDel);
    toast(error ? "ההסרה נכשלה" : "הוסר/ה");
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
