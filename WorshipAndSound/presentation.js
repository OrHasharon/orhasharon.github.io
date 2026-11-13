// The "מצגת" tab: for each upcoming meeting — the songs in order, whether the sermon (the speaker's PDF) is in,
// and quick actions: a personal upload link for the speaker (sermon.html?t=<token>, sent on WhatsApp), upload from
// here, take the sermon off, the PowerPoint, the projection screen. The screen (screen.js) pulls the sermon by itself.
// Storage + RPCs: sermon.sql (Uriya runs it once). Until then the tab still shows the order, PowerPoint and screen.
// Prayer requests are typed here (table prayer_requests, signed-in team only; prayers_pptx.sql) and carry on to the
// next meetings until updated. The sermon may be a PowerPoint: the download copies its slides in as they are.
// The verse and parasha slides stay on the projection computer.
// Uses sb / state / esc / toast / isAdmin / WA_ICON / $ from ws.js, setlist / itemsFor / loadSetlist / canEditSetlist /
// openSetlist / buildPptx / quietItem from setlist.js, upcomingMeetings / meetingKind from schedule.js.

const PT = { info: {}, prayers: [], loaded: false, missing: false, prayMissing: false, busy: false, clearArm: null };
const PT_MAX = 50 * 1024 * 1024;
const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ptKindOf = (f) => /\.pptx$/i.test(f.name || "") || f.type === PPTX_TYPE ? "pptx" : /pdf$/i.test(f.type || f.name || "") ? "pdf" : "";

async function ptLoad() {
  if (!setlist.ready) await loadSetlist();
  const gone = (error) => !!error && ["PGRST205", "42P01", "PGRST202", "42883"].includes(error.code);
  const [s, p] = await Promise.all([
    sb.from("sermon_links").select("meeting_date, token, file_path, file_name, uploaded_at"),
    sb.from("prayer_requests").select("meeting_date, body, updated_at, updated_by").order("meeting_date"),
  ]);
  PT.missing = gone(s.error);
  PT.prayMissing = gone(p.error);
  PT.info = {};
  for (const r of s.data || []) PT.info[r.meeting_date] = r;
  PT.prayers = p.data || [];
  PT.loaded = true;
}

// prayer requests carry on: a meeting shows the latest text saved for it or for an earlier meeting
const prayersRow = (iso) => [...PT.prayers].reverse().find((r) => r.meeting_date <= iso) || null;
const prayerLines = (body) => (body || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
async function prayerLinesFor(iso) {
  if (!PT.loaded) await ptLoad().catch(() => {});
  return prayerLines(prayersRow(iso)?.body);
}

const ptCanManage = (iso) => isAdmin || canEditSetlist(iso);
const ptDay = (iso) => iso.split("-").reverse().slice(0, 2).join("/");
const ptWhen = (ts) => new Date(ts).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// whichever tab shows these cards right now
function ptRefresh() {
  if (state.tab === "deck") renderPresTab();
  else if (state.tab === "next" && typeof renderNextTab === "function") renderNextTab();
}

function renderPresTab() {
  const el = $("deck");
  if (!PT.loaded) { el.innerHTML = `<p class="status">טוען…</p>`; ptLoad().then(() => state.tab === "deck" && renderPresTab()); return; }
  const meetings = upcomingMeetings(state.meetings).slice(0, 6);
  if (!meetings.length) { el.innerHTML = `<p class="status">אין מפגשים קרובים בלוח</p>`; return; }
  el.innerHTML = `
    <p class="hint pt-intro">המצגת של כל מפגש: השירים מהסשן, מצגת הדרשה שהדובר/ת מעלה בלינק אישי, ובקשות התפילה.</p>
    ${ptWarnings()}
    <div class="pt-list">${meetings.map((m) => ptCard(m)).join("")}</div>`;
}

function ptWarnings() {
  return `${PT.missing ? `<p class="db-warning">העלאת הדרשה תיפתח אחרי הרצת sermon.sql ב-Supabase.</p>` : ""}
    ${PT.prayMissing ? `<p class="db-warning">בקשות התפילה ומצגת PowerPoint לדרשה ייפתחו אחרי הרצת prayers_pptx.sql ב-Supabase.</p>` : ""}`;
}

// one meeting's presentation: songs (not in the "next" tab, the card above shows them), the sermon, prayer requests
function ptCard(m, { next = false } = {}) {
  const iso = m.iso, items = itemsFor(iso).filter((i) => i.songs);
  const info = PT.info[iso], can = ptCanManage(iso);
  const songs = next ? "" : items.length
    ? `<ol class="pt-songs">${items.map((i) => `<li>${quietItem(i.songs) ? "🍞 " : ""}${esc(i.songs.title)}</li>`).join("")}</ol>`
    : `<p class="pt-empty">אין עדיין שירים בסשן${can ? ` · <button class="link-btn" data-pt="session" data-iso="${iso}">פתיחת הסשן</button>` : ""}</p>`;
  const sermon = PT.missing ? "" : info?.file_name
    ? `<p class="pt-sermon ok">${/\.pptx$/i.test(info.file_path || info.file_name) ? "📽️" : "📄"} ${esc(info.file_name)} <small>· הועלה ${ptWhen(info.uploaded_at)}</small></p>`
    : `<p class="pt-sermon missing">📽️ עוד לא הועלתה מצגת דרשה</p>`;
  const armed = PT.clearArm?.iso === iso;
  const accept = `application/pdf,.pdf${PT.prayMissing ? "" : `,${PPTX_TYPE},.pptx`}`;
  const manage = can && !PT.missing ? `
      <button class="btn" data-pt="link" data-iso="${iso}">🔗 לינק לדובר/ת</button>
      <label class="btn ghost pt-upload">⬆️ העלאת מצגת דרשה<input type="file" accept="${accept}" data-pt-file="${iso}" hidden></label>
      ${info?.file_name ? `<button class="btn ghost${armed ? " pt-danger" : ""}" data-pt="clear" data-iso="${iso}">${armed ? "לחיצה נוספת להסרה" : "הסרת הדרשה"}</button>` : ""}` : "";
  return `<article class="meeting-card pt-card${next ? " pt-next" : ""}">
    <h3 class="pt-title">${next ? "📽️ המצגת לאסיפה" : `${esc(meetingKind(m))} · ${ptDay(iso)}`}</h3>
    ${songs}
    <div class="pt-section"><div class="pt-label">דרשה</div>${sermon}</div>
    <div class="pt-actions">
      ${manage}
      <button class="btn ghost" data-pt="pptx" data-iso="${iso}" ${items.length ? "" : "disabled"}>📽️ הורדת מצגת</button>
      <button class="btn ghost" data-pt="screen" data-iso="${iso}">🖥️ מסך הקרנה</button>
    </div>
    ${ptPrayersHtml(iso, can, next)}
  </article>`;
}

function ptPrayersHtml(iso, can, open) {
  if (PT.prayMissing) return "";
  const row = prayersRow(iso), lines = prayerLines(row?.body);
  const from = row ? (row.meeting_date === iso ? `עודכן ${ptWhen(row.updated_at)}` : `ממשיך מהאסיפה של ${ptDay(row.meeting_date)}`) : "";
  const summary = `🙏 בקשות תפילה ${lines.length ? `(${lines.length})` : "· אין עדיין"}${from ? ` <small>· ${from}</small>` : ""}`;
  const body = can
    ? `<textarea class="pt-pray-text" data-pt-pray="${iso}" rows="${Math.min(12, Math.max(5, lines.length + 2))}" placeholder="שורה לכל בקשה">${esc(row?.body || "")}</textarea>
       <div class="pt-pray-bar"><button class="btn" data-pt="pray-save" data-iso="${iso}">שמירה</button>
       <small class="hint">שורה לכל בקשה · שורה שמתחילה ב-<b>-</b> היא תת-סעיף · <b>*כוכביות*</b> סביב שמות = בכתום במצגת. נשאר גם לאסיפות הבאות עד שמעדכנים.</small></div>`
    : lines.length ? `<ul class="pt-pray-list">${lines.map((l) => `<li${/^-/.test(l) ? ' class="sub"' : ""}>${esc(l.replace(/^-\s*/, "")).replace(/\*([^*]+)\*/g, "<b>$1</b>")}</li>`).join("")}</ul>` : `<p class="pt-empty">אין בקשות.</p>`;
  return `<details class="pt-section pt-pray"${open ? " open" : ""}><summary class="pt-label">${summary}</summary>${body}</details>`;
}

async function ptSavePrayers(iso, btn) {
  const ta = document.querySelector(`[data-pt-pray="${iso}"]`);
  if (!ta) return;
  btn.disabled = true;
  const { error } = await sb.from("prayer_requests").upsert({ meeting_date: iso, body: ta.value.trim(), updated_at: new Date().toISOString(), updated_by: (typeof user !== "undefined" && user?.email) || null }, { onConflict: "meeting_date" });
  btn.disabled = false;
  if (error) { console.error(error); toast("השמירה נכשלה", { error: true }); return; }
  await ptLoad();
  toast("בקשות התפילה נשמרו ✓");
  ptRefresh();
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
    `מעלים את קובץ ה-PowerPoint (או PDF), בלי התחברות. המצגת נכנסת כמו שהיא למצגת האסיפה, ואפשר להעלות שוב כדי להחליף.\nתודה!`;
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
    <p class="hint">לינק אישי למפגש הזה: מעלים PowerPoint או PDF בלי התחברות, והדרשה נכנסת לבד למצגת. שלחו רק לדובר/ת.</p>
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
  const kind = ptKindOf(file);
  if (!kind || (kind === "pptx" && PT.prayMissing)) { toast(PT.prayMissing ? "צריך קובץ PDF (PowerPoint ייפתח אחרי prayers_pptx.sql)" : "צריך קובץ PowerPoint (.pptx) או PDF", { error: true }); return; }
  if (file.size > PT_MAX) { toast("הקובץ גדול מ-50MB", { error: true }); return; }
  PT.busy = true;
  toast("מעלה את מצגת הדרשה…");
  try {
    const token = PT.info[iso]?.token || (await ptToken(iso));
    if (!token) return;
    const path = `${token}/${Date.now()}-sermon.${kind}`;
    const up = await sb.storage.from("sermons").upload(path, file, { contentType: kind === "pptx" ? PPTX_TYPE : "application/pdf", upsert: false });
    if (up.error) throw up.error;
    const at = await sb.rpc("sermon_attach", { t: token, path, fname: file.name });
    if (at.error) throw at.error;
    PT.info[iso] = { ...PT.info[iso], file_path: path, file_name: file.name, uploaded_at: new Date().toISOString() };
    toast("מצגת הדרשה הועלתה ✓");
  } catch (err) { console.error(err); toast("ההעלאה נכשלה", { error: true }); }
  finally { PT.busy = false; ptRefresh(); }
}

async function ptClear(iso) {
  if (PT.clearArm?.iso !== iso) {
    clearTimeout(PT.clearArm?.timer);
    PT.clearArm = { iso, timer: setTimeout(() => { PT.clearArm = null; ptRefresh(); }, 4000) };
    ptRefresh(); return;
  }
  clearTimeout(PT.clearArm.timer); PT.clearArm = null;
  const { error } = await sb.rpc("sermon_clear", { d: iso });
  if (error) { toast("ההסרה נכשלה", { error: true }); ptRefresh(); return; }
  PT.info[iso] = { ...PT.info[iso], file_path: null, file_name: null, uploaded_at: null };
  toast("הדרשה הוסרה. מחשב הקרנה שכבר טען אותה ישאיר אותה עד שתוסר שם (✕ בסרגל).");
  ptRefresh();
}

// ---------- the speaker's PowerPoint inside the downloaded deck (setlist.js buildPptx) ----------
// The meeting's sermon file, if it is a .pptx: { buf, name } or null
async function sermonPptxFor(iso) {
  if (!PT.loaded) await ptLoad().catch(() => {});
  const info = PT.info[iso];
  if (!info?.file_path || !/\.pptx$/i.test(info.file_path)) return null;
  const url = sb.storage.from("sermons").getPublicUrl(info.file_path).data.publicUrl;
  const res = await fetch(url);
  if (!res.ok) throw new Error("sermon fetch " + res.status);
  return { buf: await res.arrayBuffer(), name: info.file_name };
}

// Copy every slide of another .pptx into `zip` as it is: its own layouts, master, theme, pictures, video and
// animations come along (PowerPoint's "keep source formatting"). Speaker notes and comments are left out.
// Returns the new slide paths (in order) and the copied masters, which buildPptx lists in presentation.xml.
async function importPptxSlides(zip, buf, prefix = "srm") {
  const src = await JSZip.loadAsync(buf);
  const rd = (p) => src.file(p) ? src.file(p).async("string") : Promise.resolve(null);
  const attr = (tag, a) => (tag.match(new RegExp(`\\b${a}="([^"]*)"`)) || [])[1];
  const pres = await rd("ppt/presentation.xml"), prels = await rd("ppt/_rels/presentation.xml.rels");
  const srcCt = await rd("[Content_Types].xml");
  const relTarget = (rid) => { for (const m of prels.matchAll(/<Relationship\b[^>]*>/g)) if (attr(m[0], "Id") === rid) return attr(m[0], "Target"); };
  const slidePaths = [...pres.matchAll(/<p:sldId [^>]*?r:id="([^"]+)"/g)].map((m) => resolvePart("ppt/presentation.xml", relTarget(m[1])));
  const map = new Map(), added = [];

  function resolvePart(from, target) {
    if (target.startsWith("/")) return target.slice(1);
    const parts = from.split("/").slice(0, -1);
    for (const s of target.split("/")) { if (s === "..") parts.pop(); else if (s && s !== ".") parts.push(s); }
    return parts.join("/");
  }
  function relative(from, to) {
    const a = from.split("/").slice(0, -1), b = to.split("/");
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
  }
  async function copy(p) {
    if (map.has(p)) return map.get(p);
    const cut = p.lastIndexOf("/"), dir = p.slice(0, cut), base = p.slice(cut + 1);
    let np = `${dir}/${prefix}${base}`;
    for (let n = 2; zip.file(np); n++) np = `${dir}/${prefix}${n}${base}`;
    map.set(p, np);
    const file = src.file(p);
    if (!file) return np;
    zip.file(np, await file.async(/\.(xml|rels|vml)$/i.test(p) ? "string" : "uint8array"));
    added.push([p, np]);
    const rels = await rd(`${dir}/_rels/${base}.rels`);
    if (rels) {
      let out = rels;
      for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        const tag = m[0], type = attr(tag, "Type") || "", target = attr(tag, "Target") || "";
        if (attr(tag, "TargetMode") === "External") continue;
        if (/\/(notesSlide|comments|commentAuthors)$/.test(type) || /comment/i.test(type)) { out = out.replace(tag, ""); continue; }
        const to = await copy(resolvePart(p, target));
        out = out.replace(tag, tag.replace(`Target="${target}"`, `Target="${relative(np, to)}"`));
      }
      const ncut = np.lastIndexOf("/");
      zip.file(`${np.slice(0, ncut)}/_rels/${np.slice(ncut + 1)}.rels`, out);
    }
    return np;
  }
  const slides = [];
  for (const p of slidePaths) slides.push(await copy(p));

  // content types: the same type for each copy; file extensions this deck didn't have yet
  let ct = await zip.file("[Content_Types].xml").async("string");
  for (const [p, np] of added) {
    const ov = srcCt.match(new RegExp(`<Override [^>]*PartName="/${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`));
    if (ov) { ct = ct.replace("</Types>", `<Override PartName="/${np}" ContentType="${attr(ov[0], "ContentType")}"/></Types>`); continue; }
    const ext = (np.match(/\.([^./]+)$/) || [])[1];
    if (ext && !new RegExp(`Extension="${ext}"`, "i").test(ct)) {
      const def = srcCt.match(new RegExp(`<Default [^>]*Extension="${ext}"[^>]*>`, "i"));
      if (def) ct = ct.replace("<Default ", `<Default Extension="${ext}" ContentType="${attr(def[0], "ContentType")}"/><Default `);
    }
  }
  zip.file("[Content_Types].xml", ct);
  const masters = added.map(([, np]) => np).filter((np) => /^ppt\/slideMasters\/[^/]+\.xml$/.test(np));
  return { slides, masters };
}

// master + layout ids share one number space (from 2^31) across the whole deck: give the copied masters fresh ones
async function registerMasters(zip, presXml, presRels, masters) {
  if (!masters.length) return { presXml, presRels };
  let max = 2147483648;
  const bump = (xml) => { for (const m of xml.matchAll(/\bid="(\d{10})"/g)) max = Math.max(max, Number(m[1])); };
  bump(presXml);
  for (const f of Object.keys(zip.files).filter((f) => /^ppt\/slideMasters\/[^/]+\.xml$/.test(f))) bump(await zip.file(f).async("string"));
  let list = "";
  for (const [n, path] of masters.entries()) {
    const xml = (await zip.file(path).async("string")).replace(/(<p:sldLayoutId\b[^>]*?\bid=")\d+(")/g, (_, a, b) => `${a}${++max}${b}`);
    zip.file(path, xml);
    const rid = `rIdSrm${n + 1}`;
    presRels = presRels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="${path.replace("ppt/", "")}"/></Relationships>`);
    list += `<p:sldMasterId id="${++max}" r:id="${rid}"/>`;
  }
  presXml = presXml.replace("</p:sldMasterIdLst>", list + "</p:sldMasterIdLst>");
  return { presXml, presRels };
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
  if (a === "pray-save") { ptSavePrayers(iso, b); return; }
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
