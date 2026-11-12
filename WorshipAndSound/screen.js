// The projection screen (screen.html), for the computer on the HDMI: the current song's lyrics, up to 4 lines a
// slide, white on a dark animated background. It is one more guest on the team channel (live-sync.js guestServe):
// the leader in live mode decides the SONG (state.itemId) and the screen jumps to its first slide; the clicker
// (PageDown / PageUp / arrows) turns slides INSIDE the song. With no leader connected the clicker drives everything.
// Opens without signing in; picks the upcoming meeting from the public schedule (schedule.js), ?d=YYYY-MM-DD pins a date.
// Uses lyricStanzas / chunks / songMeta from chords.js, loadMeetings / upcomingMeetings / meetingKind from schedule.js.

// must stay the same as guestCodeFor() in live-sync.js (the team link's channel name)
const LIVE_SALT = "orhasharon-ws-live:";
// "tpl" = the community's presentation (template.pptx via deck/template.json); the others are lyrics on a moving background
const BGS = [["tpl", "מצגת"], ["night", "שמי לילה"], ["glow", "אור רך"], ["deep", "כחול עמוק"], ["quiet", "שחור שקט"]];

const sb = window.supabase.createClient(SB, KEY, { db: { schema: "or_hasharon_worship" } });
const $ = (id) => document.getElementById(id);
const S = {
  date: null, meeting: null, code: null, ch: null, online: false,
  songs: [], idx: 0, slides: [], slide: 0,
  itemId: null, leader: null, leaderHere: false, seq: -1,
  mode: "lyrics", // lyrics | blank | logo | nobg
  bg: "tpl", size: 1, wake: null, opsTimer: null, ended: false,
  deck: null, deckSlides: [], pos: 0, meetings: [], groupLines: null, meetLines: [],
  sermon: [], // the preacher's PDF, one picture per page (kept on this computer, IndexedDB)
  week: {},   // this week's words: opening verse, parasha + reading, prayer requests (this computer only)
};
try { S.bg = localStorage.getItem("ws-screen-bg") || "tpl"; S.size = Number(localStorage.getItem("ws-screen-size")) || 1; } catch {}

// ---------- which meeting ----------
async function pickMeeting() {
  const q = new URLSearchParams(location.search).get("d");
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) { S.date = q; }
  try {
    const meetings = await loadMeetings();
    S.meetings = meetings;
    S.meeting = (S.date ? meetings.find((m) => m.iso === S.date) : upcomingMeetings(meetings)[0]) || null;
    if (!S.date && S.meeting) S.date = S.meeting.iso;
  } catch {}
  if (!S.date) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(LIVE_SALT + S.date));
  S.code = [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join("");
  return true;
}

// ---------- slides ----------
function slidesFor(song) {
  if (!song) return [];
  const meta = songMeta(song.content || "");
  if ((meta.screen || "").toLowerCase() === "quiet") return [{ title: song.title, quiet: true }];
  const out = [];
  for (const st of lyricStanzas(song.content || "")) for (const lines of chunks(st.lines, 4)) out.push({ lines });
  return out.length ? out : [{ title: song.title }];
}
function build() {
  S.idx = Math.max(0, Math.min(S.idx, S.songs.length - 1));
  S.slides = slidesFor(S.songs[S.idx]);
  S.slide = Math.max(0, Math.min(S.slide, S.slides.length - 1));
}

// ---------- the presentation (template mode) ----------
// Same running order as the PowerPoint download (deckPlan, deck.js); every slide drawn from deck/template.json.
const tplMode = () => S.bg === "tpl" && !!S.deck;
function buildDeck() {
  const keep = S.deckSlides[S.pos];
  S.deckSlides = [];
  for (const e of deckPlan(S.songs, (x) => x.content)) {
    if (e.sermon) { S.sermon.forEach((src, page) => S.deckSlides.push({ key: "pdf", src, page })); continue; }
    if (e.weekly) { S.deckSlides.push(...weeklySlides(e.weekly)); continue; }
    if (!e.song) { S.deckSlides.push({ key: e.tpl, song: e.item || null }); continue; }
    const parts = lyricStanzas(e.song.content || "").flatMap((st) => chunks(st.lines, 4));
    (parts.length ? parts : [[]]).forEach((lines, k) => S.deckSlides.push({ key: "song", song: e.song, lines, first: k === 0 }));
  }
  // stay on the same slide when the set is refreshed
  const k = keep ? S.deckSlides.findIndex((d) => d.key === keep.key && d.song?.id === keep.song?.id && (d.lines || []).join() === (keep.lines || []).join()) : -1;
  S.pos = k >= 0 ? k : Math.max(0, Math.min(S.pos, S.deckSlides.length - 1));
}
const deckIndexOf = (id) => S.deckSlides.findIndex((d) => d.song && d.song.id === id);

// ---------- this week's words (typed on this computer; never uploaded) ----------
const WEEK_FIELDS = ["verse", "verseRef", "parasha", "parashaRefs", "readingRef", "reading", "prayers"];
const weekKey = () => "ws-week-" + (S.date || "x");
function loadWeek() { try { S.week = JSON.parse(localStorage.getItem(weekKey()) || "{}"); } catch { S.week = {}; } }
function saveWeek() { try { localStorage.setItem(weekKey(), JSON.stringify(S.week)); } catch {} }
const wk = (f) => (S.week[f] || "").trim();
const linesOf = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// a long reading → slides of about 420 letters, cut between lines, or between sentences inside a long line
function splitReading(text, max = 420) {
  const parts = [];
  for (const line of linesOf(text)) {
    if (line.length <= max) { parts.push(line); continue; }
    let rest = line;
    while (rest.length > max) {
      const cut = Math.max(rest.lastIndexOf(": ", max), rest.lastIndexOf(". ", max), rest.lastIndexOf(", ", max));
      const at = cut > max * 0.5 ? cut + 1 : rest.lastIndexOf(" ", max) || max;
      parts.push(rest.slice(0, at).trim()); rest = rest.slice(at).trim();
    }
    if (rest) parts.push(rest);
  }
  const pages = [];
  let cur = [], len = 0;
  for (const p of parts) {
    if (cur.length && len + p.length > max) { pages.push(cur); cur = []; len = 0; }
    cur.push(p); len += p.length;
  }
  if (cur.length) pages.push(cur);
  return pages;
}
function weeklySlides(kind) {
  if (kind === "verse") return wk("verse") ? [{ key: "verse" }] : [];
  if (kind === "parasha") return wk("parasha") || wk("parashaRefs") ? [{ key: "parasha" }] : [];
  if (kind === "reading") return splitReading(wk("reading")).map((lines) => ({ key: "reading", lines }));
  if (kind === "prayers") {
    const lines = linesOf(wk("prayers")), out = [];
    for (let i = 0; i < lines.length; i += 9) out.push({ key: "prayers", lines: lines.slice(i, i + 9) });
    return out;
  }
  return [];
}

function weekEditor() {
  let d = document.getElementById("week-dialog");
  if (!d) { d = document.createElement("dialog"); d.id = "week-dialog"; d.className = "week-dialog"; document.body.append(d); }
  const v = (f) => esc(S.week[f] || "");
  d.innerHTML = `<form method="dialog" class="week-form">
    <h2>שקופיות השבוע · ${esc(day())}</h2>
    <p class="note">נשמר רק במחשב הזה, לא עולה לאתר. שדה ריק = השקופית לא מוצגת.</p>
    <label>פסוק פתיחה<textarea name="verse" rows="3">${v("verse")}</textarea></label>
    <label>מקור הפסוק<input name="verseRef" value="${v("verseRef")}" placeholder="למשל: יהודה א 24-25"></label>
    <label>פרשת השבוע<input name="parasha" value="${v("parasha")}" placeholder="למשל: פרשת וירא"></label>
    <label>קריאות (שורה לכל אחת)<textarea name="parashaRefs" rows="2" placeholder="תורה, הפטרה, ברית חדשה">${v("parashaRefs")}</textarea></label>
    <label>מקור קטע הקריאה<input name="readingRef" value="${v("readingRef")}" placeholder="למשל: בראשית כ״ב 1-3"></label>
    <label>קטע הקריאה (ארוך מתחלק לבד לכמה שקופיות)<textarea name="reading" rows="6">${v("reading")}</textarea></label>
    <label>בקשות תפילה (שורה לכל בקשה)<textarea name="prayers" rows="6">${v("prayers")}</textarea></label>
    <div class="week-actions"><button value="save" class="primary">שמירה</button><button value="cancel">ביטול</button></div>
  </form>`;
  d.onclose = () => {
    if (d.returnValue !== "save") return;
    const f = d.querySelector("form");
    for (const k of WEEK_FIELDS) S.week[k] = f.elements[k].value;
    saveWeek(); buildDeck(); show(); flash("שקופיות השבוע נשמרו");
  };
  d.showModal();
}

// fonts the template names → what the browser has (David is on Windows; David Libre is loaded as its stand-in)
const FONT = (f) => /david/i.test(f) ? '"David", "David Libre", serif' : /times/i.test(f) ? '"Times New Roman", "David Libre", serif' : 'Arial, "Noto Sans Hebrew", sans-serif';

function tplParas(el, entry) {
  const like = (i, text) => ({ ...(el.paras[i] || el.paras[0]), runs: text ? [{ ...(el.paras[i] || el.paras[0]).style, t: text }] : [] });
  if (el.role === "verse") return [...linesOf(wk("verse")).map((t) => like(0, t)), ...(wk("verseRef") ? [like(1, wk("verseRef"))] : [])];
  if (el.role === "parasha_name") return [like(0, wk("parasha"))];
  if (el.role === "parasha_refs") return linesOf(wk("parashaRefs")).map((t) => like(0, t));
  if (el.role === "reading_ref") return [like(0, wk("readingRef"))];
  if (el.role === "reading_body") return (entry.lines || []).map((t) => like(0, t));
  if (el.role === "prayers") return (entry.lines || []).map((t) => like(0, t));
  if (el.role === "title" && entry.song) return [{ ...el.paras[0], runs: [{ ...el.paras[0].style, t: entry.song.title }] }];
  if (el.role === "lyrics" && entry.song) {
    // David 54 like the template; long lines shrink so each stays on one line (the same rule as the PowerPoint export)
    const longest = Math.max(1, ...entry.lines.map((l) => l.replace(/[֑-ׇ]/g, "").length));
    const size = Math.max(30, Math.min(54, Math.floor(876 / (0.5 * longest))));
    return entry.lines.map((t) => ({ ...el.paras[0], runs: [{ ...el.paras[0].style, sz: size, t }] }));
  }
  if ((el.role === "groups" && S.groupLines?.length) || (el.role === "meetings" && S.meetLines.length)) {
    const lines = el.role === "groups" ? S.groupLines : S.meetLines;
    const first = (p) => (p.runs.find((r) => r.t) || {}).t || "";
    const pick = (t) => el.paras.find((p) => first(p) && (el.role === "groups"
      ? (t && !/[:.]/.test(t) ? !/ימי/.test(first(p)) : /ימי/.test(first(p)))
      : (t.startsWith("	") ? first(p).startsWith("	") : /:$/.test(first(p))))) || el.paras[0];
    return lines.map((t) => { const p = pick(t); return { ...p, runs: t ? [{ ...p.style, t }] : [] }; });
  }
  return el.paras;
}

function tplHtml(entry) {
  const d = S.deck, slide = d.slides[entry.key];
  const W = Math.min(innerWidth, innerHeight * 16 / 9), H = W * 9 / 16, u = H / 540; // px per pt (a slide is 540pt high)
  if (entry.key === "pdf") return `<div class="tpl" style="width:${W}px;height:${H}px"><img class="pdf-page" alt="" src="${entry.src}"></div>`;
  if (!slide) return `<div class="tpl" style="width:${W}px;height:${H}px"></div>`;
  const px = (b) => `left:${b[0] * W}px;top:${b[1] * H}px;width:${b[2] * W}px;height:${b[3] * H}px`;
  let html = "";
  if (d.bg?.grad) { // DrawingML 0° = left→right; CSS 90deg = left→right
    const g = d.bg.grad;
    html += `<div class="tpl-bg" style="inset:0;width:100%;height:100%;background:linear-gradient(${g.ang + 90}deg,${g.stops.map(([p, c]) => `${c} ${p * 100}%`).join(",")})"></div>`;
  } else if (d.bg) {
    const f = d.bg.fill || {}, l = f.l || 0, t = f.t || 0, r = f.r || 0, b = f.b || 0;
    html += `<img class="tpl-bg" alt="" src="${d.bg.src}" style="left:${l * W}px;top:${t * H}px;width:${(1 - l - r) * W}px;height:${(1 - t - b) * H}px">`;
  }
  for (const el of slide.els) {
    if (!el.box) continue;
    if (el.t === "rect") { html += `<div class="tpl-el" style="${px(el.box)};background:${el.fill.c};opacity:${el.fill.a}"></div>`; continue; }
    if (el.t === "img") {
      const [cl, ct, cr, cb] = el.crop, iw = el.box[2] * W / (1 - cl - cr), ih = el.box[3] * H / (1 - ct - cb);
      html += `<div class="tpl-el tpl-pic" style="${px(el.box)};opacity:${el.op}"><img alt="" src="${el.src}" style="width:${iw}px;height:${ih}px;left:${-cl * iw}px;top:${-ct * ih}px"></div>`;
      continue;
    }
    const paras = tplParas(el, entry);
    if (!el.role && !paras.some((p) => p.runs.some((r) => r.t && r.t.trim()))) continue;
    const pad = `padding:${el.ins[1] * H}px ${el.ins[2] * W}px ${el.ins[3] * H}px ${el.ins[0] * W}px`;
    const just = el.anchor === "ctr" ? "center" : el.anchor === "b" ? "flex-end" : "flex-start";
    const body = paras.map((p) => {
      const runs = p.runs.filter((r) => !r.br);
      const text = runs.map((r) => r.t || "").join("");
      const align = { l: "left", r: "right", ctr: "center", just: "justify", dist: "justify" }[p.algn] || (p.rtl ? "right" : "left");
      const inner = runs.length
        ? runs.map((r) => `<span style="font-size:${(r.sz || 18) * u * el.scale}px;${r.c ? `color:${r.c};` : ""}${r.b ? "font-weight:700;" : ""}${r.i ? "font-style:italic;" : ""}font-family:${FONT(r.f || "")}">${esc(r.t || "")}</span>`).join("")
        : `<span style="font-size:${(p.endSz || 18) * u * el.scale}px">&nbsp;</span>`;
      return `<div style="text-align:${align};direction:${p.rtl || /[֐-׿]/.test(text) ? "rtl" : "ltr"};line-height:${p.ln && p.ln !== 1 ? p.ln * 1.15 : "normal"};margin-top:${(p.bef || 0) * u}px">${inner}</div>`;
    }).join("");
    const fitIt = ["verse", "parasha_refs", "reading_body", "prayers", "parasha_name", "reading_ref"].includes(el.role);
    html += `<div class="tpl-el tpl-text"${fitIt ? " data-fit" : ""} style="${px(el.box)};${pad};justify-content:${just}">${body}</div>`;
  }
  return `<div class="tpl" style="width:${W}px;height:${H}px">${html}</div>`;
}

// text that doesn't fit its box shrinks (6% a step) until it does — PowerPoint's "shrink text on overflow"
function fitTpl() {
  for (const box of document.querySelectorAll(".tpl-text[data-fit]")) {
    for (let k = 0; k < 30 && box.scrollHeight > box.clientHeight + 1; k++) {
      box.querySelectorAll("span").forEach((sp) => { sp.style.fontSize = parseFloat(sp.style.fontSize) * 0.94 + "px"; });
    }
  }
}

// the changing text of the last two slides, like the PowerPoint export
async function loadTail() {
  try { S.meetLines = meetingLines(S.date, S.meetings); } catch { S.meetLines = []; }
  try { S.groupLines = await serviceGroupLines(); } catch { S.groupLines = null; }
}

// ---------- drawing ----------
const day = () => (S.date ? S.date.split("-").reverse().slice(0, 2).join("/") : "");
function logoHtml(sub) {
  return `<img class="logo" src="../logo.png" alt=""><div>קהילת אור השרון</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}`;
}

function show() {
  const stage = $("stage"), el = $("slide"), corner = $("corner");
  if (tplMode() && S.mode !== "logo") {
    stage.className = `stage tplmode${S.mode === "blank" ? " blank" : ""}${S.mode === "nobg" ? " nobg" : ""}`;
    corner.textContent = "";
    const entry = S.deckSlides[S.pos];
    const cur = entry?.song;
    if (cur) { const k = S.songs.findIndex((x) => x.id === cur.id); if (k >= 0) S.idx = k; }
    el.classList.add("out");
    setTimeout(() => { el.classList.remove("title"); el.style.removeProperty("--size"); el.innerHTML = entry ? tplHtml(entry) : ""; fitTpl(); el.classList.remove("out"); }, el.innerHTML ? 180 : 0);
    renderOps();
    return;
  }
  const song = S.songs[S.idx], sl = S.slides[S.slide];
  const quiet = S.mode === "lyrics" && sl?.quiet;
  stage.className = `stage bg-${quiet ? "quiet" : S.bg}${S.mode === "blank" ? " blank" : ""}${S.mode === "nobg" ? " nobg" : ""}`;
  let html = "", title = false, cornerText = "";
  if (S.mode === "logo" || (S.mode !== "blank" && !song)) {
    title = true;
    // "starting soon" only before there is a set; mid-set the logo screen is just the logo
    html = logoHtml(S.ended ? "תודה, ושבת שלום" : !S.date ? "אין מפגש קרוב בלוח" : song ? "" : `ההלל יתחיל בקרוב${S.meeting ? " · " + meetingKind(S.meeting) + " " + day() : ""}`);
  } else if (sl?.title) {
    title = true;
    html = `<div>${esc(sl.title)}</div>`;
  } else if (sl?.lines) {
    html = sl.lines.map((l) => `<div>${esc(l)}</div>`).join("");
    cornerText = S.slide === 0 ? song.title : "";
  }
  el.classList.add("out");
  setTimeout(() => {
    el.classList.toggle("title", title);
    el.innerHTML = html;
    corner.textContent = cornerText;
    fit();
    el.classList.remove("out");
  }, el.innerHTML ? 180 : 0);
  renderOps();
}

// biggest size where the slide fits: at most ~7vw, shrunk until no line overflows the width or 80% of the height
function fit() {
  const el = $("slide");
  let vw = 7 * S.size;
  if (el.classList.contains("title")) vw = 6 * S.size;
  for (let k = 0; k < 40; k++) {
    el.style.setProperty("--size", vw + "vw");
    // the lines' own height (the slide box itself always fills the screen)
    const content = [...el.children].reduce((h, c) => h + c.getBoundingClientRect().height, 0);
    const tooTall = content > el.clientHeight * 0.92;
    const tooWide = [...el.children].some((c) => c.scrollWidth > el.clientWidth + 1);
    if (!tooTall && !tooWide) break;
    vw *= 0.96;
  }
}

// ---------- clicker ----------
function next() {
  if (S.mode !== "lyrics") { S.mode = "lyrics"; return show(); }
  if (tplMode()) { if (S.pos < S.deckSlides.length - 1) { S.pos++; show(); } return; } // the presentation: free, like PowerPoint
  if (S.slide < S.slides.length - 1) S.slide++;
  else if (!S.leaderHere && S.idx < S.songs.length - 1) { S.idx++; S.slide = 0; build(); }
  else return; // the leader changes songs
  show();
}
function prev() {
  if (S.mode !== "lyrics") { S.mode = "lyrics"; return show(); }
  if (tplMode()) { if (S.pos > 0) { S.pos--; show(); } return; }
  if (S.slide > 0) S.slide--;
  else if (!S.leaderHere && S.idx > 0) { S.idx--; build(); S.slide = S.slides.length - 1; }
  else return;
  show();
}
function setMode(m) { S.mode = S.mode === m ? "lyrics" : m; show(); }
function setBg(b) {
  const wasTpl = tplMode();
  S.bg = b; try { localStorage.setItem("ws-screen-bg", b); } catch {}
  if (tplMode() && !wasTpl) { buildDeck(); const k = deckIndexOf(S.songs[S.idx]?.id); if (k >= 0) S.pos = k; }
  show();
}
function setSize(d) { S.size = Math.min(1.6, Math.max(0.6, +(S.size + d).toFixed(2))); try { localStorage.setItem("ws-screen-size", S.size); } catch {} fit(); renderOps(); }
function fullscreen() { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen?.().catch(() => {}); }

document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("select, input, textarea, dialog")) return;
  const k = e.key;
  if (["PageDown", "ArrowDown", "ArrowRight", " ", "Enter"].includes(k)) { e.preventDefault(); next(); }
  else if (["PageUp", "ArrowUp", "ArrowLeft", "Backspace"].includes(k)) { e.preventDefault(); prev(); }
  else if (k === "b" || k === "B" || k === "." || k === "נ") setMode("blank");
  else if (k === "l" || k === "L" || k === "ך") setMode("logo");
  else if (k === "h" || k === "H" || k === "י") setMode("nobg");
  else if (k === "Escape") { S.mode = "lyrics"; show(); }
  else if (k === "f" || k === "F" || k === "כ") fullscreen();
  else if (k === "+" || k === "=") setSize(0.08);
  else if (k === "-") setSize(-0.08);
  else if (/^[1-4]$/.test(k)) setBg(BGS[Number(k) - 1][0]);
});
// no clicker: tap the left half for next, the right half for previous (Hebrew reads right to left)
$("stage").addEventListener("click", (e) => { if (e.clientX < innerWidth / 2) next(); else prev(); });

// ---------- the sermon: the preacher's PDF, shown right after the "דרשה" slide ----------
// Saved as PDF from PowerPoint ("שמירה בשם → PDF"). Each page becomes a picture once; the file is kept in this
// computer's IndexedDB for this meeting, so a refresh doesn't lose it. Nothing is uploaded anywhere.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  return new Promise((ok, bad) => {
    const sc = document.createElement("script"); sc.src = PDFJS + "pdf.min.js";
    sc.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; ok(); };
    sc.onerror = bad; document.head.append(sc);
  });
}
function idb() {
  return new Promise((ok, bad) => { const r = indexedDB.open("ws-screen", 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
}
async function idbDo(mode, fn) { const db = await idb(); return new Promise((ok, bad) => { const tx = db.transaction("files", mode); const req = fn(tx.objectStore("files")); tx.oncomplete = () => ok(req?.result); tx.onerror = () => bad(tx.error); }); }
const sermonKey = () => "sermon-" + (S.date || "x");

async function pdfToPages(buf) {
  await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise, pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i), v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, 1920 / v1.width) });
    const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    pages.push(c.toDataURL("image/jpeg", 0.9));
  }
  return pages;
}
async function setSermon(file) {
  if (!file || !/pdf$/i.test(file.type || file.name)) { flash("צריך קובץ PDF (ב-PowerPoint: שמירה בשם ← PDF)"); return; }
  flash("טוען את הדרשה…");
  try {
    const buf = await file.arrayBuffer();
    S.sermon = await pdfToPages(buf.slice(0));
    try { await idbDo("readwrite", (st) => st.put({ name: file.name, buf }, sermonKey())); } catch {}
    const before = S.deckSlides[S.pos];
    buildDeck();
    flash(`הדרשה נטענה · ${S.sermon.length} שקופיות`);
    if (!before) S.pos = 0;
    show();
  } catch (err) { console.error(err); flash("לא הצלחתי לקרוא את הקובץ"); }
}
async function restoreSermon() {
  try {
    const rec = await idbDo("readonly", (st) => st.get(sermonKey()));
    if (rec?.buf) { S.sermon = await pdfToPages(rec.buf); S.sermonName = rec.name; buildDeck(); show(); }
  } catch {}
}
async function clearSermon() {
  S.sermon = []; S.sermonName = "";
  try { await idbDo("readwrite", (st) => st.delete(sermonKey())); } catch {}
  buildDeck(); show();
}
function pickSermon() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf,.pdf";
  inp.onchange = () => setSermon(inp.files[0]); inp.click();
}
// drag a PDF onto the screen
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) setSermon(f); });

// a short message at the top for the operator
function flash(text) {
  let f = document.getElementById("flash");
  if (!f) { f = document.createElement("div"); f.id = "flash"; f.className = "flash"; document.body.append(f); }
  f.textContent = text; f.classList.add("on");
  clearTimeout(flash.t); flash.t = setTimeout(() => f.classList.remove("on"), 3500);
}

// ---------- operator bar (appears on mouse / touch, hides after 3 seconds) ----------
function renderOps() {
  const ops = $("ops");
  const who = S.leaderHere && S.leader ? `👑 ${esc(S.leader.name || "")} מוביל/ה` : S.songs.length ? "אין מוביל/ה מחובר/ת · הלחצן שולט" : "ממתינים למוביל/ה";
  const src = S.leaderHere ? "" : S.setSource === "db" ? ` · ${S.songs.length} שירים מהסשן` : S.songs.length ? "" :
    ` · <a class="ops-link" href="./" target="_blank">כדי לראות את השירים לפני הלייב — להתחבר לאתר פעם אחת במחשב הזה</a>`;
  ops.innerHTML = `
    <span class="status"><span class="dot${S.online ? " on" : ""}"></span>${who}${S.date ? ` · ${day()}` : ""}${src}</span>
    <span class="sep"></span>
    <span class="grp"><button data-op="prev" title="הקודם (PageUp)">→</button><button data-op="next" title="הבא (PageDown)">←</button></span>
    ${S.songs.length ? `<select data-op="jump" aria-label="קפיצה לשיר">${S.songs.map((s, i) => `<option value="${i}"${i === S.idx ? " selected" : ""}>${i + 1}. ${esc(s.title)}</option>`).join("")}</select>` : ""}
    <span class="sep"></span>
    <span class="grp">${BGS.map(([b, label], i) => `<button data-bg="${b}" class="${S.bg === b ? "on" : ""}" title="${i + 1}">${label}</button>`).join("")}</span>
    <span class="sep"></span>
    <span class="grp">
      <button data-op="blank" class="${S.mode === "blank" ? "on" : ""}" title="B">שחור</button>
      <button data-op="logo" class="${S.mode === "logo" ? "on" : ""}" title="L">לוגו</button>
      <button data-op="nobg" class="${S.mode === "nobg" ? "on" : ""}" title="H">בלי רקע</button>
    </span>
    <span class="grp"><button data-op="smaller" title="−">א−</button><button data-op="bigger" title="+">א+</button></span>
    <span class="sep"></span>
    <button data-op="week" title="פסוק, פרשה, בקשות תפילה">✏️ שקופיות השבוע</button>
    <button data-op="sermon" title="PDF">📄 ${S.sermon.length ? `דרשה (${S.sermon.length})` : "טעינת דרשה (PDF)"}</button>
    ${S.sermon.length ? `<button data-op="nosermon" title="הסרת הדרשה">✕</button>` : ""}
    <button data-op="fs" title="F">⛶ מסך מלא</button>`;
}
document.getElementById("ops").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.bg) return setBg(b.dataset.bg);
  const op = b.dataset.op;
  if (op === "next") next(); else if (op === "prev") prev();
  else if (op === "blank" || op === "logo" || op === "nobg") setMode(op);
  else if (op === "smaller") setSize(-0.08); else if (op === "bigger") setSize(0.08);
  else if (op === "fs") fullscreen();
  else if (op === "sermon") pickSermon();
  else if (op === "week") weekEditor();
  else if (op === "nosermon") { if (confirm("להסיר את הדרשה מהמסך?")) clearSermon(); }
});
document.getElementById("ops").addEventListener("change", (e) => {
  if (e.target.dataset.op !== "jump") return;
  S.idx = Number(e.target.value); S.slide = 0; S.mode = "lyrics"; build(); show(); e.target.blur();
});
function wakeOps() {
  $("ops").hidden = false; document.body.classList.remove("idle");
  clearTimeout(S.opsTimer);
  S.opsTimer = setTimeout(() => { if (!$("ops").matches(":hover")) { $("ops").hidden = true; document.body.classList.add("idle"); } }, 3000);
}
document.addEventListener("mousemove", wakeOps);
document.addEventListener("touchstart", wakeOps, { passive: true });

// ---------- the team channel ----------
const hello = () => S.ch?.send({ type: "broadcast", event: "hello", payload: {} });

function onSongs(list) {
  const curId = S.songs[S.idx]?.id;
  S.songs = list || [];
  const k = S.songs.findIndex((s) => s.id === (S.itemId ?? curId));
  if (k >= 0) S.idx = k;
  build(); buildDeck();
  if (S.itemId != null && tplMode() && S.pos === 0) { const j = deckIndexOf(S.itemId); if (j >= 0) S.pos = j; }
  show();
}
function onState(p) {
  if (!p?.leader) return;
  if (S.leader && (p.leader.email !== S.leader.email || p.leader.ts !== S.leader.ts)) { if (p.leader.ts < S.leader.ts) return; S.seq = -1; }
  if (p.seq <= S.seq) return;
  S.leader = p.leader; S.seq = p.seq; S.ended = false;
  if (p.itemId !== S.itemId) {
    S.itemId = p.itemId;
    const k = S.songs.findIndex((s) => s.id === p.itemId);
    if (k >= 0) { S.idx = k; S.slide = 0; S.mode = S.mode === "logo" ? "lyrics" : S.mode; build(); }
    const j = deckIndexOf(p.itemId); // the presentation: jump to that song's first slide
    if (j >= 0) S.pos = j;
    show();
  } else renderOps();
}

function join() {
  S.ch = sb.channel("ws-guest-" + S.code, { config: { broadcast: { self: false }, presence: { key: "screen" } } });
  S.ch.on("presence", { event: "sync" }, () => { S.leaderHere = "leader" in S.ch.presenceState(); renderOps(); })
    .on("broadcast", { event: "songs" }, ({ payload }) => onSongs(payload?.songs))
    .on("broadcast", { event: "state" }, ({ payload }) => onState(payload))
    .on("broadcast", { event: "end" }, () => { S.ended = true; S.mode = "logo"; show(); })
    .subscribe((status) => {
      S.online = status === "SUBSCRIBED";
      if (S.online) { S.ch.track({ screen: true }); hello(); }
      renderOps();
    });
}

// the set before anyone leads (live_set.sql; until it runs this quietly does nothing)
// The session's songs, before anyone leads:
// 1. a computer that once signed in to the site (WorshipAndSound) keeps that sign-in — then the set is read straight
//    from the database, like the site does (same origin, same Supabase session);
// 2. otherwise live_set.sql's live_set(code), once it runs;
// 3. otherwise the songs arrive when the leader presses ▶ live.
// Re-read every 2 minutes while nobody leads, so edits to the set show up; a leader in live mode overrides it.
async function preload() {
  let rows = null;
  try {
    const { data: ses } = await sb.auth.getSession();
    S.signedIn = !!ses?.session;
    if (S.signedIn) {
      const { data, error } = await sb.from("setlist_items").select("*, songs(*)").eq("meeting_date", S.date).order("position").order("id");
      if (!error && data) rows = data.filter((i) => i.songs).map((i) => ({ id: i.id, title: i.songs.title, key: i.songs.song_key || "", content: i.songs.content || "", notes: i.notes || "" }));
    }
  } catch {}
  if (!rows) {
    try {
      const { data, error } = await sb.rpc("live_set", { c: S.code });
      if (!error && data) rows = data.map((r) => ({ id: r.id, title: r.title, key: r.song_key || "", content: r.content || "", notes: r.notes || "" }));
    } catch {}
  }
  S.setSource = rows ? (S.signedIn ? "db" : "rpc") : null;
  if (rows && !S.leaderHere) {
    const sig = rows.map((r) => r.id + ":" + r.title).join("|");
    if (sig !== S.setSig) { S.setSig = sig; onSongs(rows); }
  }
  renderOps();
}
setInterval(() => { if (S.code && !S.leaderHere) preload(); }, 120000);

async function wakeOn() { try { if ("wakeLock" in navigator && !S.wake) { S.wake = await navigator.wakeLock.request("screen"); S.wake.addEventListener("release", () => { S.wake = null; }); } } catch {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { wakeOn(); hello(); } });
window.addEventListener("online", hello);
window.addEventListener("resize", () => (tplMode() ? show() : fit()));

(async () => {
  try { S.deck = await fetch("deck/template.json", { cache: "no-cache" }).then((r) => r.json()); } catch { S.deck = null; }
  buildDeck(); show();
  if (await pickMeeting()) { loadWeek(); buildDeck(); show(); join(); preload(); restoreSermon(); loadTail().then(() => tplMode() && show()); }
  wakeOn(); show(); wakeOps();
})();
