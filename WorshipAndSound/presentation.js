// The "מצגת" tab: for each upcoming meeting — the songs in order, whether the sermon (the speaker's PDF) is in,
// and quick actions: a personal upload link for the speaker (sermon.html?t=<token>, sent on WhatsApp), upload from
// here, take the sermon off, the PowerPoint, the projection screen. The screen (screen.js) pulls the sermon by itself.
// Storage + RPCs: sermon.sql (Uriya runs it once). Until then the tab still shows the order, PowerPoint and screen.
// Prayer requests are typed here (table prayer_requests, signed-in team only; prayers_pptx.sql) and carry on to the
// next meetings until updated. The sermon may be a PowerPoint: the download copies its slides in as they are.
// The verse and parasha slides stay on the projection computer.
// Uses sb / state / esc / toast / isAdmin / WA_ICON / $ from ws.js, setlist / itemsFor / loadSetlist / canEditSetlist /
// openSetlist / buildPptx / quietItem from setlist.js, upcomingMeetings / meetingKind from schedule.js.

const PT = { info: {}, prayers: [], texts: [], textsMissing: false, loaded: false, missing: false, prayMissing: false, busy: false, clearArm: null };
const PT_MAX = 50 * 1024 * 1024;
const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ptKindOf = (f) => /\.pptx$/i.test(f.name || "") || f.type === PPTX_TYPE ? "pptx" : /pdf$/i.test(f.type || f.name || "") ? "pdf" : "";

async function ptLoad() {
  if (!setlist.ready) await loadSetlist();
  const gone = (error) => !!error && ["PGRST205", "42P01", "PGRST202", "42883"].includes(error.code);
  const [s, p, x] = await Promise.all([
    sb.from("sermon_links").select("*"), // (uploaded_by once sermon_by.sql has run)
    sb.from("prayer_requests").select("meeting_date, body, updated_at, updated_by").order("meeting_date"),
    sb.from("meeting_texts").select("*").order("meeting_date"),
  ]);
  PT.textsMissing = gone(x.error);
  PT.texts = x.data || [];
  PT.missing = gone(s.error);
  PT.prayMissing = gone(p.error);
  PT.info = {};
  for (const r of s.data || []) PT.info[r.meeting_date] = r;
  // the table can't be read (no select grant: sermon_read.sql) — ask the way the projection screen does, by each
  // upcoming meeting's date code (sermon_for), so the card and the PowerPoint still get the speaker's file
  if (s.error && !PT.missing && typeof guestCodeFor === "function") {
    const dates = upcomingMeetings(state.meetings || []).slice(0, 6).map((m) => m.iso);
    await Promise.all(dates.map(async (iso) => {
      try {
        const { data, error } = await sb.rpc("sermon_for", { c: await guestCodeFor(iso) });
        const r = !error && data?.[0];
        if (r?.path) PT.info[iso] = { meeting_date: iso, file_path: r.path, file_name: r.file_name, uploaded_at: r.uploaded_at };
      } catch {}
    }));
  }
  PT.prayers = p.data || [];
  PT.loaded = true; PT.at = Date.now();
}

// prayer requests carry on: a meeting shows the latest text saved for it or for an earlier meeting
const prayersRow = (iso) => [...PT.prayers].reverse().find((r) => r.meeting_date <= iso) || null;
const prayerLines = (body) => (body || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
async function prayerLinesFor(iso) {
  if (!PT.loaded) await ptLoad().catch(() => {});
  return prayerLines(prayersRow(iso)?.body);
}

// who saved it: the name of the signed-in team member (stored as the name; older rows hold an email)
function myName() {
  const u = typeof user !== "undefined" ? user : null;
  return (typeof myMemberId !== "undefined" && myMemberId && byId(myMemberId)?.name) || u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email || null;
}
function whoName(v) {
  if (!v) return "";
  if (!v.includes("@")) return v;
  const a = (typeof allowed !== "undefined" ? allowed : []).find((x) => (x.email || "").toLowerCase() === v.toLowerCase());
  return (a?.member_id && byId(a.member_id)?.name) || v.split("@")[0];
}
const byLine = (row) => row?.updated_at ? `${row.updated_by ? `ע״י ${esc(whoName(row.updated_by))} · ` : ""}${ptWhen(row.updated_at)}` : "";

// the meeting's presentation (sermon, prayer requests, parasha, the Supper verse): every signed-in team member
// (the database allows the same: is_allowed()); the songs of the session stay with the worship leader (setlist.js)
const ptCanManage = () => typeof user !== "undefined" && !!user;
const ptDay = (iso) => iso.split("-").reverse().slice(0, 2).join("/");
const ptWhen = (ts) => new Date(ts).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// whichever tab shows these cards right now
function ptRefresh() {
  // sections that were open (prayers, parasha) stay open after the redraw
  const open = new Set([...document.querySelectorAll("details[data-key][open]")].map((d) => d.dataset.key));
  if (state.tab === "deck") renderPresTab();
  else if (state.tab === "next" && typeof renderNextTab === "function") renderNextTab();
  document.querySelectorAll("details[data-key]").forEach((d) => { if (open.has(d.dataset.key)) d.open = true; });
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
    ${PT.prayMissing ? `<p class="db-warning">בקשות התפילה ומצגת PowerPoint לדרשה ייפתחו אחרי הרצת prayers_pptx.sql ב-Supabase.</p>` : ""}
    ${PT.textsMissing ? `<p class="db-warning">פרשת השבוע וסעודת האדון ייפתחו אחרי הרצת meeting_texts.sql ב-Supabase.</p>` : ""}`;
}

// one meeting's presentation: songs (not in the "next" tab, the card above shows them), the sermon, prayer requests
// what was uploaded meanwhile (the speaker's link, someone else's upload) shows up without a page refresh: the cards
// reload their data in the background when it is more than a minute old
function ptFreshen() {
  if (!PT.loaded || PT.reloading || Date.now() - (PT.at || 0) < 60000) return;
  PT.reloading = true;
  ptLoad().catch(() => {}).finally(() => { PT.reloading = false; ptRefresh(); });
}
function ptCard(m, { next = false } = {}) {
  ptFreshen();
  const iso = m.iso, items = itemsFor(iso).filter((i) => i.songs);
  const info = PT.info[iso], can = ptCanManage(iso);
  const songs = next ? "" : items.length
    ? `<ol class="pt-songs">${items.map((i) => `<li>${quietItem(i.songs) ? "🍞 " : ""}${esc(i.songs.title)}</li>`).join("")}</ol>`
    : `<p class="pt-empty">אין עדיין שירים בסשן${can ? ` · <button class="link-btn" data-pt="session" data-iso="${iso}">פתיחת הסשן</button>` : ""}</p>`;
  const sermon = PT.missing ? "" : info?.file_name
    ? `<p class="pt-sermon ok">${/\.pptx$/i.test(info.file_path || info.file_name) ? "📽️" : "📄"} ${esc(info.file_name)} <small>· הועלה${info.uploaded_by ? ` ע״י ${esc(whoName(info.uploaded_by))}` : ""} ${ptWhen(info.uploaded_at)}</small></p>`
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
      <button class="btn ghost" data-pt="viewlink" data-iso="${iso}" title="לינק לצפייה בלבד: מי שפותח רואה את מה שמוקרן, בלי אפשרות לשלוט">🔗 לינק לצפייה</button>
    </div>
    ${ptPrayersHtml(iso, can, next)}
    ${ptTextsHtml(iso, can, next)}
  </article>`;
}

function ptPrayersHtml(iso, can, open) {
  if (PT.prayMissing) return "";
  const row = prayersRow(iso), lines = prayerLines(row?.body);
  const from = row ? (row.meeting_date === iso ? `עודכן ${byLine(row)}` : `ממשיך מהאסיפה של ${ptDay(row.meeting_date)}${row.updated_by ? ` · ע״י ${esc(whoName(row.updated_by))}` : ""}`) : "";
  const summary = `🙏 בקשות תפילה ${lines.length ? `(${lines.length})` : "· אין עדיין"}${from ? ` <small>· ${from}</small>` : ""}`;
  const body = can
    ? `<textarea class="pt-pray-text" data-pt-pray="${iso}" rows="${Math.min(12, Math.max(5, lines.length + 2))}" placeholder="שורה לכל בקשה">${esc(row?.body || "")}</textarea>
       <div class="pt-pray-bar"><button class="btn" data-pt="pray-save" data-iso="${iso}">שמירה</button>
       <small class="hint">שורה לכל בקשה · שורה שמתחילה ב-<b>-</b> היא תת-סעיף · <b>*כוכביות*</b> סביב שמות = בכתום במצגת. נשאר גם לאסיפות הבאות עד שמעדכנים.</small></div>`
    : lines.length ? `<ul class="pt-pray-list">${lines.map((l) => `<li${/^-/.test(l) ? ' class="sub"' : ""}>${esc(l.replace(/^-\s*/, "")).replace(/\*([^*]+)\*/g, "<b>$1</b>")}</li>`).join("")}</ul>` : `<p class="pt-empty">אין בקשות.</p>`;
  return `<details class="pt-section pt-pray" data-key="pray-${iso}"${open ? " open" : ""}><summary class="pt-label">${summary}</summary>${body}</details>`;
}

// ---------- the week's parasha + the Lord's Supper verse (table meeting_texts, meeting_texts.sql) ----------
// The parasha belongs to its own meeting; the Supper verse carries on to later meetings until someone changes it.
const TEXT_FIELDS = ["parasha", "parasha_refs", "reading_ref", "reading", "communion_verse", "communion_ref"];
const textsRow = (iso) => PT.texts.find((r) => r.meeting_date === iso) || null;
const communionRow = (iso) => [...PT.texts].reverse().find((r) => r.meeting_date <= iso && (r.communion_verse || "").trim()) || null;
async function meetingTextsFor(iso) {
  if (!PT.loaded) await ptLoad().catch(() => {});
  const r = textsRow(iso) || {}, c = communionRow(iso) || {};
  return { parasha: r.parasha || "", parasha_refs: r.parasha_refs || "", passages: passagesOf(r), parasha_file_path: r.parasha_file_path || "",
    communion_verse: c.communion_verse || "", communion_ref: c.communion_ref || "" };
}

function ptTextsHtml(iso, can, open) {
  if (PT.textsMissing) return "";
  return ptSupperHtml(iso, can, open) + ptParashaHtml(iso, can, open);
}

// the Lord's Supper verse (carries on to later meetings until changed)
function ptSupperHtml(iso, can, open) {
  const c = communionRow(iso);
  // who wrote the verse = communion_by (set only when the verse itself changes); a verse saved before 20.11.2026 has
  // no record of its writer: say so rather than show nothing
  const cBy = !c ? "" : c.communion_by ? `ע״י ${esc(whoName(c.communion_by))}${c.communion_at ? ` · ${ptWhen(c.communion_at)}` : ""}` : "לא נרשם מי כתב ומתי";
  const from = c ? ` <small>· ${c.meeting_date !== iso ? `ממשיך מ-${ptDay(c.meeting_date)} · ` : ""}${cBy}</small>` : "";
  const summary = `🍞 סעודת האדון <small>· ${c ? (c.communion_ref ? esc(c.communion_ref) : "יש פסוק") : "הפסוק הקבוע של המצגת"}</small>${c ? from : ""}`;
  if (!can) {
    return `<details class="pt-section pt-pray" data-key="supper-${iso}"${open ? " open" : ""}><summary class="pt-label">${summary}</summary>
      ${c ? `<p>${esc(c.communion_verse)} <small>${esc(c.communion_ref || "")}</small></p>` : `<p class="pt-empty">הפסוק הקבוע של המצגת.</p>`}</details>`;
  }
  return `<details class="pt-section pt-pray" data-key="supper-${iso}"${open ? " open" : ""}><summary class="pt-label">${summary}</summary>
    <div class="pt-form" data-pt-supper="${iso}">
      <label>הפסוק<textarea name="communion_verse" rows="4" placeholder="ריק = הפסוק הקבוע של המצגת">${esc(c?.communion_verse || "")}</textarea></label>
      <label>מקור<input name="communion_ref" value="${esc(c?.communion_ref || "")}" placeholder="למשל: (קור״א י״א 26)"></label>
      <div class="pt-pray-bar"><button class="btn" data-pt="supper-save" data-iso="${iso}">שמירה</button></div>
    </div></details>`;
}

// the week's parasha: typed text or an uploaded presentation (as it is)
function ptParashaHtml(iso, can, open) {
  const r = textsRow(iso) || {};
  const refs = parashaRefs(r), passages = passagesOf(r);
  const hasParasha = !!(r.parasha || r.reading || r.parasha_refs || r.parasha_file_path);
  const summary = `📖 פרשת השבוע <small>· ${r.parasha_file_path ? "מצגת: " + esc(r.parasha_file_name || "") : hasParasha ? esc(r.parasha || "יש קריאה") : "אין פרשה"}</small>`;
  if (!can) {
    return `<details class="pt-section pt-pray" data-key="texts-${iso}"${open ? " open" : ""}><summary class="pt-label">${summary}</summary>
      ${r.parasha_file_path ? `<p>📽️ ${esc(r.parasha_file_name || "")}</p>` : hasParasha ? `<p><b>${esc(r.parasha || "")}</b> ${esc(r.parasha_refs || "").replace(/\n/g, " · ")}</p>` : `<p class="pt-empty">אין פרשה.</p>`}</details>`;
  }
  return `<details class="pt-section pt-pray" data-key="texts-${iso}"${open ? " open" : ""}><summary class="pt-label">${summary}</summary>
    <div class="pt-form" data-pt-texts="${iso}">
      <p class="hint">מופיע אחרי השיר האחרון ולפני ברכת הילדים. בלי שם פרשה ובלי פסוקים = אין שקופיות.</p>
      <div class="pt-label">📽️ או: מצגת לפרשה</div>
      ${r.parasha_file_path
        ? `<p class="pt-sermon ok">${/\.pptx$/i.test(r.parasha_file_path) ? "📽️" : "📄"} ${esc(r.parasha_file_name || "")}${r.parasha_file_at ? ` <small>· הועלה${r.parasha_file_by ? ` ע״י ${esc(whoName(r.parasha_file_by))}` : ""} ${ptWhen(r.parasha_file_at)}</small>` : ""}</p>
           <p class="hint">המצגת נכנסת כמו שהיא, במקום שקופיות הפרשה והפסוקים.${/\.pdf$/i.test(r.parasha_file_path) ? " קובץ PDF מוצג רק במסך ההקרנה (ב-PowerPoint להורדה נכנס רק קובץ PowerPoint)." : ""}</p>
           <div class="pt-pray-bar"><label class="btn ghost pt-upload">⬆️ החלפת המצגת<input type="file" accept="application/pdf,.pdf,${PPTX_TYPE},.pptx" data-pt-parasha-file="${iso}" hidden></label>
           <button class="btn ghost" type="button" data-pt="parasha-clear" data-iso="${iso}">הסרת המצגת</button></div>`
        : `<div class="pt-pray-bar"><label class="btn ghost pt-upload">⬆️ העלאת מצגת לפרשה<input type="file" accept="application/pdf,.pdf,${PPTX_TYPE},.pptx" data-pt-parasha-file="${iso}" hidden></label>
           <small class="hint">PowerPoint או PDF. נכנס כמו שהוא, במקום השקופיות של הטקסט שלמטה</small></div>`}
      <div class="pt-parasha-text"${r.parasha_file_path ? " hidden" : ""}>
      ${(r.parasha || r.parasha_refs || r.reading) && r.updated_by ? `<p class="pt-by">הטקסט של הפרשה עודכן ${byLine(r)}</p>` : ""}
      <label>שם הפרשה<input name="parasha" value="${esc(r.parasha || "")}" placeholder="למשל: פרשת חיי שרה"></label>
      <label>קטע מהתורה<input name="torah" value="${esc(refs.torah)}" placeholder="למשל: בראשית כ״ג 1 – כ״ה 18"></label>
      <label><span>הפטרה <small>(לא חובה)</small></span><input name="haftara" value="${esc(refs.haftara)}" placeholder="למשל: מלכים א׳ א׳ 1-31"></label>
      <label><span>קטע מהברית החדשה <small>(לא חובה)</small></span><input name="brit" value="${esc(refs.brit)}" placeholder="למשל: מתי ב׳ 1-23"></label>
      <div class="pt-label">פסוקים להצגה</div>
      <div class="pt-passages">${(passages.length ? passages : [{ ref: "", text: "" }]).map(passageHtml).join("")}</div>
      <button class="btn ghost pt-add" type="button" data-pt="passage-add">➕ קטע</button>
      <div class="pt-pray-bar"><button class="btn" data-pt="texts-save" data-iso="${iso}">שמירה</button></div>
      </div>
    </div></details>`;
}

// one passage to show: where it's from + the verses (a long one splits into several slides)
function passageHtml(p, n) {
  return `<div class="pt-passage">
    <div class="pt-passage-head"><input name="p_ref" value="${esc(p.ref || "")}" placeholder="מאיפה? למשל: בראשית כ״ג 1-4">
      ${n ? `<button class="link-btn" type="button" data-pt="passage-del" title="הסרת הקטע">✕</button>` : ""}</div>
    <textarea name="p_text" rows="5" placeholder="הפסוקים (ארוך מתחלק לבד לכמה שקופיות)">${esc(p.text || "")}</textarea>
  </div>`;
}

async function ptSaveTexts(iso, btn) {
  const f = document.querySelector(`[data-pt-texts="${iso}"]`);
  if (!f) return;
  const val = (n) => f.querySelector(`[name="${n}"]`).value.trim();
  const row = { meeting_date: iso };
  row.parasha = val("parasha");
  row.parasha_refs = Object.keys(REF_LABELS).filter((k) => val(k)).map((k) => `${REF_LABELS[k]}: ${val(k)}`).join("\n");
  const passages = [...f.querySelectorAll(".pt-passage")].map((d) => ({ ref: d.querySelector('[name="p_ref"]').value.trim(), text: d.querySelector('[name="p_text"]').value.trim() })).filter((p) => p.ref || p.text);
  row.reading = passages.length ? JSON.stringify(passages) : "";
  row.reading_ref = passages[0]?.ref || "";
  const was = textsRow(iso) || {};
  if (["parasha", "parasha_refs", "reading", "reading_ref"].some((k) => (row[k] || "") !== (was[k] || ""))) {
    Object.assign(row, { updated_at: new Date().toISOString(), updated_by: myName() });
  }
  await ptSaveRow(row, btn);
}

// the Supper verse, saved (and signed) only when it was changed — a verse carried on from an earlier meeting isn't
// copied into this one under someone else's name
async function ptSaveSupper(iso, btn) {
  const f = document.querySelector(`[data-pt-supper="${iso}"]`);
  if (!f) return;
  const verse = f.querySelector('[name="communion_verse"]').value.trim(), ref = f.querySelector('[name="communion_ref"]').value.trim();
  const prev = communionRow(iso);
  if (verse === (prev?.communion_verse || "").trim() && ref === (prev?.communion_ref || "").trim()) { toast("אין שינוי בפסוק"); return; }
  await ptSaveRow({ meeting_date: iso, communion_verse: verse, communion_ref: ref, communion_by: myName(), communion_at: new Date().toISOString() }, btn);
}

async function ptSaveRow(row, btn) {
  btn.disabled = true;
  let { error } = await sb.from("meeting_texts").upsert(row, { onConflict: "meeting_date" });
  if (error && ["42703", "PGRST204"].includes(error.code) && "communion_by" in row) { // communion_by.sql hasn't run yet
    delete row.communion_by; delete row.communion_at;
    ({ error } = await sb.from("meeting_texts").upsert(row, { onConflict: "meeting_date" }));
  }
  btn.disabled = false;
  if (error) { console.error(error); toast("השמירה נכשלה", { error: true }); return; }
  await ptLoad();
  toast("נשמר ✓");
  ptRefresh();
}

async function ptSavePrayers(iso, btn) {
  const ta = document.querySelector(`[data-pt-pray="${iso}"]`);
  if (!ta) return;
  btn.disabled = true;
  const { error } = await sb.from("prayer_requests").upsert({ meeting_date: iso, body: ta.value.trim(), updated_at: new Date().toISOString(), updated_by: myName() }, { onConflict: "meeting_date" });
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
  return `היי!\nלינק להעלאת המסר ל*${meetingKind(m)} ${ptDay(m.iso)}*:\n${url}\n\n` +
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
    let at = await sb.rpc("sermon_attach", { t: token, path, fname: file.name, by: myName() });
    if (at.error && at.error.code === "PGRST202") at = await sb.rpc("sermon_attach", { t: token, path, fname: file.name }); // sermon_by.sql not run yet
    if (at.error) throw at.error;
    PT.info[iso] = { ...PT.info[iso], file_path: path, file_name: file.name, uploaded_at: new Date().toISOString(), uploaded_by: myName() };
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

// ---------- the week's parasha as an uploaded presentation (meeting_texts.parasha_file_*, parasha_deck.sql) ----------
// Stored in the sermons bucket, in the meeting's speaker folder; it goes into the deck as it is (like the sermon),
// in place of the parasha + reading slides.
async function ptParashaSet(iso, file) {
  const row = { meeting_date: iso, parasha_file_path: file?.path || null, parasha_file_name: file?.name || null,
    parasha_file_at: file ? new Date().toISOString() : null, parasha_file_by: file ? myName() : null };
  let { error } = await sb.from("meeting_texts").upsert(row, { onConflict: "meeting_date" });
  if (error && ["42703", "PGRST204"].includes(error.code)) { delete row.parasha_file_by; ({ error } = await sb.from("meeting_texts").upsert(row, { onConflict: "meeting_date" })); }
  if (error && ["42703", "PGRST204"].includes(error.code)) { toast("צריך להריץ ב-Supabase את parasha_deck.sql", { error: true }); return false; }
  if (error) { console.error(error); toast("השמירה נכשלה", { error: true }); return false; }
  return true;
}
async function ptParashaUpload(iso, file) {
  if (!file || PT.busy) return;
  const kind = ptKindOf(file);
  if (!kind) { toast("צריך קובץ PowerPoint (.pptx) או PDF", { error: true }); return; }
  if (file.size > PT_MAX) { toast("הקובץ גדול מ-50MB", { error: true }); return; }
  PT.busy = true;
  toast("מעלה את מצגת הפרשה…");
  try {
    const token = PT.info[iso]?.token || (await ptToken(iso));
    if (!token) return;
    const path = `${token}/${Date.now()}-parasha.${kind}`;
    const up = await sb.storage.from("sermons").upload(path, file, { contentType: kind === "pptx" ? PPTX_TYPE : "application/pdf", upsert: false });
    if (up.error) throw up.error;
    if (await ptParashaSet(iso, { path, name: file.name })) { await ptLoad(); toast("מצגת הפרשה הועלתה ✓"); }
  } catch (err) { console.error(err); toast("ההעלאה נכשלה", { error: true }); }
  finally { PT.busy = false; ptRefresh(); }
}
async function ptParashaClear(iso) {
  if (!confirm("להסיר את מצגת הפרשה? (השקופיות של הטקסט יחזרו)")) return;
  if (await ptParashaSet(iso, null)) { await ptLoad(); toast("מצגת הפרשה הוסרה"); }
  ptRefresh();
}
// the parasha deck for the downloaded PowerPoint, if it is a .pptx: { buf, name } or null
async function parashaPptxFor(iso) {
  if (!PT.loaded) await ptLoad().catch(() => {});
  const r = textsRow(iso);
  if (!r?.parasha_file_path || !/\.pptx$/i.test(r.parasha_file_path)) return null;
  const res = await fetch(sb.storage.from("sermons").getPublicUrl(r.parasha_file_path).data.publicUrl);
  if (!res.ok) throw new Error("parasha fetch " + res.status);
  return { buf: await res.arrayBuffer(), name: r.parasha_file_name };
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
// animations come along (PowerPoint's "keep source formatting"), and the speaker notes. Comments are left out.
// Returns the new slide paths (in order) and the copied masters, which buildPptx lists in presentation.xml.
async function importPptxSlides(zip, buf, prefix = "srm", { skipEmpty = false } = {}) {
  const src = await JSZip.loadAsync(buf);
  const rd = (p) => src.file(p) ? src.file(p).async("string") : Promise.resolve(null);
  const attr = (tag, a) => (tag.match(new RegExp(`\\b${a}="([^"]*)"`)) || [])[1];
  const pres = await rd("ppt/presentation.xml"), prels = await rd("ppt/_rels/presentation.xml.rels");
  const srcCt = await rd("[Content_Types].xml");
  const relTarget = (rid) => { for (const m of prels.matchAll(/<Relationship\b[^>]*>/g)) if (attr(m[0], "Id") === rid) return attr(m[0], "Target"); };
  let slidePaths = [...pres.matchAll(/<p:sldId [^>]*?r:id="([^"]+)"/g)].map((m) => resolvePart("ppt/presentation.xml", relTarget(m[1])));
  if (skipEmpty) { // the sermon: empty slides are left out (isEmptySlideXml, deck.js)
    const keep = [];
    for (const p of slidePaths) if (!isEmptySlideXml((await rd(p)) || "")) keep.push(p);
    slidePaths = keep;
  }
  const map = new Map(), added = [];
  // speaker notes come along too (as is): each notes page is linked to this deck's own notes master (a deck has one)
  const destRels = (await zip.file("ppt/_rels/presentation.xml.rels")?.async("string")) || "";
  const nmTag = [...destRels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => /\/notesMaster"/.test(t));
  const destNotesMaster = nmTag ? resolvePart("ppt/presentation.xml", attr(nmTag, "Target")) : null;

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
        if (/\/(comments|commentAuthors)$/.test(type) || /comment/i.test(type)) { out = out.replace(tag, ""); continue; }
        if (/\/notesSlide$/.test(type) && !destNotesMaster) { out = out.replace(tag, ""); continue; }
        if (/\/notesMaster$/.test(type) && destNotesMaster) { out = out.replace(tag, tag.replace(`Target="${target}"`, `Target="${relative(np, destNotesMaster)}"`)); continue; }
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
  if (a === "viewlink") {
    const url = location.origin + location.pathname.replace(/[^/]*$/, "") + "screenread.html?d=" + iso;
    navigator.clipboard?.writeText(url).then(() => toast("הלינק לצפייה הועתק · אפשר להדביק ולשלוח"), () => prompt("הלינק לצפייה:", url));
    return;
  }
  if (a === "link") { if (PT.busy) return; PT.busy = true; try { await ptShowLink(iso); } finally { PT.busy = false; } return; }
  if (a === "clear") { ptClear(iso); return; }
  if (a === "pray-save") { ptSavePrayers(iso, b); return; }
  if (a === "texts-save") { ptSaveTexts(iso, b); return; }
  if (a === "supper-save") { ptSaveSupper(iso, b); return; }
  if (a === "parasha-clear") { ptParashaClear(iso); return; }
  if (a === "passage-add") { const list = b.parentElement.querySelector(".pt-passages"); list.insertAdjacentHTML("beforeend", passageHtml({}, list.children.length)); list.lastElementChild.querySelector("input").focus(); return; }
  if (a === "passage-del") { b.closest(".pt-passage").remove(); return; }
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
  const pf = e.target.closest?.("[data-pt-parasha-file]");
  if (pf) { ptParashaUpload(pf.dataset.ptParashaFile, pf.files[0]); pf.value = ""; }
});
