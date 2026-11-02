// Songs tab: chord-sheet library (ChordPro-style "[Am]lyrics"), PDF import, transpose. Uses sb/esc/toast/$ from ws.js.
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const songsState = { loaded: false, list: [], query: "", view: "list", current: null, shift: 0, noCapo: false, present: false, presentChords: false, drafts: [], importing: false };
let songScale = 1;
try { songScale = Number(localStorage.getItem("ws-song-scale")) || 1; } catch {}

// ---------- chords ----------
const CHORD_RE = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:(?:sus|add|maj|b|#|-|\+)\d+)*(?:\/[A-G][#b]?)?$/;
const FILLER_RE = /^(?:\||\/|-|–|x\d+|\(|\)|\.+)$/i;
const isChordLine = (text) => {
  const toks = text.trim().split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.some((t) => CHORD_RE.test(t)) && toks.every((t) => CHORD_RE.test(t) || FILLER_RE.test(t));
};
const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const noteIndex = (n) => { const i = SHARPS.indexOf(n); return i >= 0 ? i : FLATS.indexOf(n); };
function transposeNote(n, shift, flats) {
  const i = noteIndex(n);
  if (i < 0) return n;
  return (flats ? FLATS : SHARPS)[(i + shift + 120) % 12];
}
function transposeChord(ch, shift) {
  if (!shift) return ch;
  const m = ch.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  if (!m) return ch;
  const flats = ch.includes("b");
  return transposeNote(m[1], shift, flats) + m[2] + (m[3] ? "/" + transposeNote(m[3], shift, flats) : "");
}
const firstChord = (content) => (content.match(/\[([^\]]+)\]/) || [])[1] || null;

const HEB = /[֐-׿]/;

// Clean niqqud that the PDF put on the wrong letter (shows as ◌): marks with no letter, duplicate marks,
// and the shin/sin dot on a letter that isn't ש (moved to a nearby ש that lacks one, otherwise dropped).
function fixNiqqud(text) {
  const MARK = /[\u0591-\u05C7]/, LETTER = /[\u05D0-\u05EA]/;
  const out = []; // clusters: { base, marks: [] }
  for (const ch of text) {
    if (MARK.test(ch)) {
      const last = out[out.length - 1];
      if (last && LETTER.test(last.base) && !last.marks.includes(ch)) last.marks.push(ch);
      continue; // orphan or duplicate
    }
    out.push({ base: ch, marks: [] });
  }
  const DOTS = ["\u05C1", "\u05C2"];
  out.forEach((c, i) => {
    const dot = c.marks.find((m) => DOTS.includes(m));
    if (!dot || c.base === "ש") return;
    c.marks = c.marks.filter((m) => !DOTS.includes(m));
    for (const j of [i + 1, i - 1, i + 2, i - 2]) {
      const n = out[j];
      if (n && n.base === "ש" && !n.marks.some((m) => DOTS.includes(m))) { n.marks.push(dot); break; }
    }
  });
  // the PDF tends to hang a ו's mark on the letter before it: "תֹו" -> "תוֹ" (holam male), "שּו" -> "שׁוּ" (shuruk)
  out.forEach((c, i) => {
    const prev = out[i - 1];
    if (c.base !== "ו" || c.marks.length || !prev || !LETTER.test(prev.base)) return;
    const VOWELS = /[ְ-ׇֻ]/;
    if (prev.marks.includes("ֹ")) { prev.marks = prev.marks.filter((m) => m !== "ֹ"); c.marks.push("ֹ"); return; }
    if (prev.marks.includes("ּ") && !prev.marks.some((m) => VOWELS.test(m))) {
      prev.marks = prev.marks.filter((m) => m !== "ּ"); c.marks.push("ּ");
    }
  });
  return out.map((c) => c.base + c.marks.join("")).join("").normalize("NFC");
}

// ---------- render ChordPro ----------
// directives: {capo: 2} {artist: ...}; a line that is only {…} is a section label, e.g. {פזמון}
const META_RE = /^\{\s*(capo|artist|key)\s*:\s*(.*?)\s*\}$/i;
function songMeta(content) {
  const meta = {};
  for (const line of content.split("\n")) { const m = line.trim().match(META_RE); if (m) meta[m[1].toLowerCase()] = m[2]; }
  return meta;
}

function renderChordPro(content, shift = 0, { chords = true } = {}) {
  const songDir = HEB.test(content) ? "rtl" : "ltr";
  return content.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return `<div class="cp-line cp-empty"></div>`;
    if (META_RE.test(t)) return "";
    const label = t.match(/^\{(.+)\}$/);
    if (label) return `<div class="cp-section" dir="auto">[${esc(label[1])}]</div>`;
    // direction comes from the lyrics, not the (Latin) chords
    const lyricsOnly = line.replace(/\[[^\]]*\]/g, "");
    const dir = HEB.test(lyricsOnly) ? "rtl" : "ltr";
    if (!line.includes("[") && isChordLine(cleanStr(line))) {
      if (!chords) return "";
      const row = cleanStr(line).replace(/\S+/g, (tok) => (CHORD_RE.test(tok) ? transposeChord(tok, shift) : tok));
      return `<div class="cp-line cp-bare-chords" dir="${songDir}">${esc(row)}</div>`;
    }
    if (!line.includes("[")) return `<div class="cp-line" dir="${dir}">${esc(fixNiqqud(line))}</div>`;
    if (!chords) return lyricsOnly.trim() ? `<div class="cp-line" dir="${dir}">${esc(fixNiqqud(lyricsOnly))}</div>` : "";
    const parts = line.split(/\[([^\]]*)\]/); // text, chord, text, chord, ...
    let html = parts[0] ? `<span class="seg"><span class="ch"></span><span class="ly">${esc(fixNiqqud(parts[0]))}</span></span>` : "";
    for (let k = 1; k < parts.length; k += 2) {
      const lyr = parts[k + 1] || "";
      html += `<span class="seg"><span class="ch">${esc(transposeChord(parts[k], shift))}</span><span class="ly">${lyr ? esc(fixNiqqud(lyr)) : "&nbsp;"}</span></span>`;
    }
    return `<div class="cp-line${lyricsOnly.trim() ? "" : " cp-chords-only"}" dir="${dir}">${html}</div>`;
  }).join("");
}

// "76. תודה לך אבי (capo 2)" -> title "תודה לך אבי" + {capo: 2}
function cleanTitle(raw) {
  let title = raw.replace(/^\s*\d+\s*[.)\-]\s*/, "").replace(/\s*[.(]\s*\d{1,4}\s*$/, "").trim();
  // RTL text extraction can mirror the brackets, so accept either side
  const capo = title.match(/[()]?\s*(?:capo|קאפו)\s*(\d+)\s*[()]?/i);
  if (capo) title = title.replace(capo[0], "").replace(/[()]\s*[()]/g, "").replace(/^[\s()]+|[\s()]+$/g, "").trim();
  return { title, capo: capo ? capo[1] : null };
}

// ---------- PDF -> songs ----------
const cleanStr = (t) => (t || "").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").replace(/[\u00A0\u2000-\u200A\u202F]/g, " ");
const median = (arr) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

async function pdfToSongs(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const songs = [];
  let totalText = 0;
  const all = []; // every line of the document, in reading order
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.map((it) => ({ ...it, str: cleanStr(it.str) })).filter((it) => it.str && it.str.trim()).map((it) => ({
      str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height,
    }));
    totalText += items.length;
    if (!items.length) continue;
    const width = page.getViewport({ scale: 1 }).width;
    for (const col of splitColumns(items, width)) {
      // group into lines by baseline
      col.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of col) {
        const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.h * 0.45));
        if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
      }
      lines.sort((a, b) => b.y - a.y);
      for (const l of lines) all.push({ ...toLine(l), page: p });
    }
  }
  if (!totalText) return null; // scanned images, no text layer

  // table of contents pages ("283 אגילה בן" lines, no chords) are skipped: the site builds its own index
  const TOC_LINE = /^\s*\d{1,4}\s+[^\d\s.)]|[^\d\s.(]\s+\d{1,4}\s*$/;
  const tocPages = new Set();
  for (const pg of new Set(all.map((l) => l.page))) {
    const lyric = all.filter((l) => l.page === pg && !l.chords && l.text.trim());
    const toc = lyric.filter((l) => TOC_LINE.test(l.text) && !/^\s*\d{1,4}\s*[.)]/.test(l.text));
    if (toc.length >= 5 && toc.length >= lyric.length * 0.6) tocPages.add(pg);
  }
  const TOC_HEADER = /^\s*(תוכן\s+(ה)?עניינים|אינדקס|index|contents)\s*$/i;
  all.splice(0, all.length, ...all.filter((l) => !tocPages.has(l.page) && !TOC_HEADER.test(l.text)));

  // Songbook style: "76. שם השיר" starts a song, everything under it (also on later pages) is the song.
  // Otherwise fall back to big text (compared with the lyrics, not the smaller chord lines).
  const NUMBERED = /^\s*\d{1,4}\s*[.)]\s*\S|\S\s*[.(]\s*\d{1,4}\s*$/;
  const numbered = all.filter((l) => !l.chords && NUMBERED.test(l.text) && l.text.trim().length < 80);
  const lyricH = median(all.filter((l) => !l.chords).map((l) => l.h));
  const isTitle = numbered.length
    ? (l) => !l.chords && NUMBERED.test(l.text) && l.text.trim().length < 80
    : (l) => !l.chords && l.h > lyricH * 1.2 && l.text.trim().length < 60;
  let current = null;
  for (const ln of all) {
    if (isTitle(ln)) { current = { title: ln.text.trim(), lines: [] }; songs.push(current); continue; }
    if (!current) { current = { title: `עמוד ${ln.page}`, lines: [] }; songs.push(current); }
    current.lines.push(ln);
  }
  return songs.map((s) => {
    const { title, capo } = cleanTitle(s.title);
    const body = mergeChordLines(s.lines);
    return { title, content: (capo ? `{capo: ${capo}}\n` : "") + body.split("\n").map(fixNiqqud).join("\n"), include: true };
  }).filter((s) => s.content.trim());
}

// two (or more) side-by-side columns: find empty vertical strips that no item crosses
function splitColumns(items, width) {
  const ranges = items.map((i) => [i.x, i.x + i.w]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
  }
  const cuts = [];
  for (let k = 1; k < merged.length; k++) {
    const gap = merged[k][0] - merged[k - 1][1];
    const mid = (merged[k][0] + merged[k - 1][1]) / 2;
    if (gap > width * 0.035 && mid > width * 0.2 && mid < width * 0.8) cuts.push(mid);
  }
  if (!cuts.length) return [items];
  const edges = [-Infinity, ...cuts, Infinity];
  const cols = edges.slice(1).map((hi, k) => items.filter((i) => i.x + i.w / 2 > edges[k] && i.x + i.w / 2 <= hi));
  const big = cols.filter((c) => c.length >= 3);
  if (big.length < 2) return [items];
  const hebrew = items.filter((i) => HEB.test(i.str)).length > items.length / 4;
  return hebrew ? big.reverse() : big; // Hebrew books read the right column first
}

// "Am7D" / "EmAm" -> ["Am7", "D"] / ["Em", "Am"] when the whole token is made of chords
const CHORD_PIECE = /[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:(?:sus|add|maj|b|#|-|\+)\d+)*(?:\/[A-G][#b]?)?/g;
function splitGlued(tok) {
  if (CHORD_RE.test(tok)) return [{ name: tok, at: 0 }];
  const parts = [...tok.matchAll(CHORD_PIECE)];
  if (!parts.length || parts.map((m) => m[0]).join("") !== tok) return null;
  return parts.map((m) => ({ name: m[0], at: m.index }));
}

// one PDF line -> {text, rtl, chords?: [{name, xL, xR}], chars: position map}
const IS_MARK = /[֑-ׇ]/;
function toLine(l) {
  const rtl = l.items.some((i) => HEB.test(i.str));
  // pull out niqqud: whole mark-only items, and marks with no letter right before them inside an item
  const floating = [];
  const base = [];
  for (const it of l.items) {
    const chars = [...it.str];
    const letters = chars.filter((ch) => !IS_MARK.test(ch));
    if (!letters.join("").trim()) { chars.forEach((ch) => IS_MARK.test(ch) && floating.push({ ch, x: it.x + it.w / 2 })); continue; }
    const lw = it.w / Math.max(1, letters.length);
    let kept = "", seen = 0;
    chars.forEach((ch) => {
      if (IS_MARK.test(ch)) {
        const prev = kept[kept.length - 1];
        if (prev && !IS_MARK.test(prev) && prev !== " ") kept += ch; // a proper mark after its letter
        else floating.push({ ch, x: rtl ? it.x + it.w - (seen + 0.5) * lw : it.x + (seen + 0.5) * lw });
      } else { kept += ch; seen++; }
    });
    base.push({ ...it, str: kept, w: it.w, letters: seen });
  }
  const items = base.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
  const cw = median(items.map((i) => i.w / Math.max(1, i.letters ?? i.str.length))) || 4;
  let text = "";
  const pos = []; // for each char of text: its x center
  let prevEdge = null;
  for (const it of items) {
    const edgeStart = rtl ? it.x + it.w : it.x;
    if (prevEdge !== null) {
      const gap = rtl ? prevEdge - edgeStart : edgeStart - prevEdge;
      // a final letter (ך ם ן ף ץ) always ends a word, so never put a space before it
      const spaces = /^[ךםןףץ]/.test(it.str) ? 0 : Math.max(gap > cw * 0.3 ? 1 : 0, Math.round(gap / cw));
      for (let s = 0; s < spaces; s++) { text += " "; pos.push(rtl ? prevEdge - (s + 0.5) * cw : prevEdge + (s + 0.5) * cw); }
    }
    const icw = it.w / Math.max(1, it.letters ?? it.str.length);
    let k = 0;
    for (const ch of it.str) {
      text += ch;
      if (IS_MARK.test(ch)) { pos.push(pos[pos.length - 1] ?? it.x); continue; }
      pos.push(rtl ? it.x + it.w - (k + 0.5) * icw : it.x + (k + 0.5) * icw); k++;
    }
    prevEdge = rtl ? it.x : it.x + it.w;
  }
  // hang the floating marks on the nearest letter (after any marks it already has)
  for (const m of floating.sort((a, b) => b.x - a.x)) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < text.length; i++) {
      if (IS_MARK.test(text[i]) || text[i] === " ") continue;
      const d = Math.abs(pos[i] - m.x);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) continue;
    let at = best + 1;
    while (at < text.length && IS_MARK.test(text[at])) at++;
    text = text.slice(0, at) + m.ch + text.slice(at);
    pos.splice(at, 0, pos[best]);
  }
  // a final letter (with its niqqud) that ended up before other letters of its word goes back to the word's end
  if (/[ךםןףץ]/.test(text)) {
    const cs = [...text].map((ch, i) => ({ ch, x: pos[i] }));
    for (let i = 0; i < cs.length; i++) {
      if (!/[ךםןףץ]/.test(cs[i].ch)) continue;
      let end = i + 1;
      while (end < cs.length && IS_MARK.test(cs[end].ch)) end++;
      let stop = end;
      while (stop < cs.length && /[א-ת֑-ׇ]/.test(cs[stop].ch)) stop++;
      if (stop > end) { const grp = cs.splice(i, end - i); cs.splice(stop - grp.length, 0, ...grp); i = stop - 1; }
    }
    text = cs.map((c) => c.ch).join("");
    pos.splice(0, pos.length, ...cs.map((c) => c.x));
  }
  const h = Math.max(...l.items.map((i) => i.h));
  if (!HEB.test(text)) {
    const chords = [];
    let ok = true, any = false;
    for (const it of [...l.items].sort((a, b) => a.x - b.x)) {
      const icw = it.w / Math.max(1, it.str.length);
      for (const m of it.str.matchAll(/\S+/g)) {
        if (FILLER_RE.test(m[0])) continue;
        const pieces = splitGlued(m[0]);
        if (!pieces) { ok = false; break; }
        for (const pc of pieces) {
          const x0 = it.x + (m.index + pc.at) * icw;
          chords.push({ name: pc.name, xL: x0, xR: x0 + pc.name.length * icw });
          any = true;
        }
      }
      if (!ok) break;
    }
    if (ok && any) return { text: chords.map((c) => c.name).join(" "), rtl, chords, h };
  }
  return { text, rtl, pos, h };
}

const songIsRtl = (lines) => lines.some((l) => !l.chords && l.rtl);

// chord line + following lyric line -> "[Am]lyr[G]ics"
function mergeChordLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.chords) { out.push(ln.text.trimEnd()); continue; }
    const next = lines[i + 1];
    if (!next || next.chords) {
      const order = songIsRtl(lines) ? [...ln.chords].sort((a, b) => b.xR - a.xR) : ln.chords;
      out.push(order.map((c) => `[${c.name}]`).join(" ")); continue;
    }
    // insert each chord before the lyric char nearest to where the chord starts
    const inserts = ln.chords.map((c) => {
      const anchor = next.rtl ? c.xR : c.xL;
      let best = 0, bestD = Infinity;
      next.pos.forEach((x, k) => { const d = Math.abs(x - anchor); if (d < bestD) { bestD = d; best = k; } });
      return { at: best, name: c.name };
    }).sort((a, b) => b.at - a.at);
    let t = next.text;
    for (const ins of inserts) {
      let at = ins.at;
      while (at < t.length && /[֑-ׇ ]/.test(t[at])) at++; // stick to the next letter, never split it from its niqqud
      t = t.slice(0, at) + `[${ins.name}]` + t.slice(at);
    }
    out.push(t.replace(/ {2,}/g, " ").trimEnd());
    i++;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------- data ----------
async function loadSongs() {
  const { data, error } = await sb.from("songs").select("*").order("title");
  if (error) {
    songsState.missing = error.code === "PGRST205" || error.code === "42P01";
    if (!songsState.missing) toast("טעינת השירים נכשלה");
    songsState.loaded = true; songsState.list = [];
    return;
  }
  songsState.list = data;
  songsState.loaded = true;
}

async function saveImported(drafts, fileName) {
  const byTitle = new Map(songsState.list.map((s) => [s.title.trim(), s]));
  const fresh = [], updates = [];
  for (const d of drafts) {
    const row = { title: d.title.trim(), content: d.content, song_key: firstChord(d.content), source: fileName, updated_at: new Date().toISOString() };
    if (!row.title || !row.content.trim()) continue;
    const old = byTitle.get(row.title);
    if (old) updates.push(sb.from("songs").update(row).eq("id", old.id)); else fresh.push(row);
  }
  const results = await Promise.all([fresh.length ? sb.from("songs").insert(fresh) : { error: null }, ...updates]);
  const failed = results.filter((r) => r.error).length;
  await loadSongs();
  songsState.view = "list";
  renderSongs();
  toast(failed ? `חלק מהשירים לא נשמרו (${failed})` : `נשמרו ${fresh.length} שירים חדשים${updates.length ? `, עודכנו ${updates.length}` : ""}`);
}

const myEmail = () => (typeof user !== "undefined" && user?.email ? user.email.toLowerCase() : null);
const isMine = (row) => !!myEmail() && (row.added_by || "").toLowerCase() === myEmail();

// ---------- views ----------
function renderSongs() {
  const el = $("songs");
  if (!songsState.loaded) { el.innerHTML = `<p class="status">טוען שירים…</p>`; loadSongs().then(renderSongs); return; }
  if (songsState.missing) { el.innerHTML = `<p class="db-warning">ספריית השירים עדיין לא פעילה: צריך להריץ ב-Supabase את הסקריפט team_matrix.sql. אחרי זה רעננו את הדף.</p>`; return; }
  const v = songsState.view;
  if (v === "song") return renderSongView(el);
  if (v === "edit") return renderSongEdit(el);
  if (v === "import") return renderImport(el);
  el.innerHTML = `<div class="songs-bar">
      <input id="song-search" type="search" autofocus placeholder="חפשו שיר לפי שם או מילים…" value="${esc(songsState.query)}">
      <button class="btn" data-song-new>+ שיר חדש</button>
      <label class="btn ghost file-btn">ייבוא מ-PDF<input type="file" accept="application/pdf" id="pdf-file" hidden></label>
    </div>
    ${songsState.importing ? `<p class="status">קורא את הקובץ…</p>` : ""}
    <div id="song-results">${searchResultsHtml()}</div>
    ${uploadsHtml()}`;
  // only the results are redrawn while typing, so the cursor never jumps
  const search = $("song-search");
  search.addEventListener("input", () => { songsState.query = search.value; $("song-results").innerHTML = searchResultsHtml(); });
}

function searchResultsHtml() {
  const q = songsState.query.trim();
  if (!q) return songsState.list.length ? "" : `<p class="status">עדיין אין שירים. אפשר להוסיף שיר או לייבא מ-PDF.</p>`;
  const list = songsState.list.filter((s) => s.title.includes(q) || s.content.includes(q));
  if (!list.length) return `<p class="status">לא נמצאו שירים</p>`;
  return `<div class="search-results">${list.sort((a, b) => (b.title.includes(q) - a.title.includes(q)) || a.title.localeCompare(b.title, "he"))
    .slice(0, 50).map((s) => `<button class="idx-song" data-song="${s.id}">${esc(s.title)}</button>`).join("")}</div>`;
}

// alphabetical index grouped by first letter, titles only
function songIndex(list) {
  const sorted = [...list].sort((a, b) => (b.title.includes(q) - a.title.includes(q)) || a.title.localeCompare(b.title, "he"));
  const groups = new Map();
  for (const s of sorted) {
    const letter = (s.title.trim()[0] || "#").replace(/[ךםןףץ]/, (c) => ({ ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" }[c]));
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(s);
  }
  return `<div class="song-index">${[...groups].map(([letter, songs]) => `<section class="idx-group"><h3>${esc(letter)}</h3>
    ${songs.map((s) => `<button class="idx-song" data-song="${s.id}">${esc(s.title)}</button>`).join("")}</section>`).join("")}</div>`;
}

// files that were imported: who, when, how many songs; only the uploader can delete
function uploadsHtml() {
  const files = new Map();
  for (const s of songsState.list) {
    if (!s.source) continue;
    const key = s.source + "|" + (s.added_by || "");
    const f = files.get(key) || { name: s.source, by: s.added_by, count: 0, at: s.created_at };
    f.count++; if (s.created_at < f.at) f.at = s.created_at;
    files.set(key, f);
  }
  if (!files.size) return "";
  return `<details class="uploads"><summary>קבצים שהועלו (${files.size})</summary>
    <div class="duty-table"><table><thead><tr><th>קובץ</th><th>הועלה ע״י</th><th>תאריך</th><th>שירים</th><th></th></tr></thead><tbody>
    ${[...files.values()].map((f) => `<tr><td dir="auto">${esc(f.name)}</td><td dir="ltr">${esc(f.by || "")}</td><td>${f.at ? new Date(f.at).toLocaleDateString("he-IL") : ""}</td><td>${f.count}</td>
      <td>${myEmail() && (f.by || "").toLowerCase() === myEmail() ? `<button class="link-btn" data-del-file="${esc(f.name)}">מחיקת הקובץ ושיריו</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div></details>`;
}

function renderSongView(el) {
  const s = songsState.current;
  const meta = songMeta(s.content);
  const capo = Number(meta.capo) || 0;
  const shift = songsState.shift + (songsState.noCapo ? capo : 0); // without capo: sounding chords = shapes + capo
  const baseKey = s.song_key || firstChord(s.content);
  const key = baseKey ? transposeChord(baseKey, shift) : null;
  el.innerHTML = `<div class="song-view${songsState.present ? " present" : ""}" style="--song-scale:${songScale}">
    <div class="song-top">
      <button class="link-btn no-print" data-song-back>→ לכל השירים</button>
      <h2 class="song-title">${esc(s.title)}</h2>
      ${meta.artist ? `<p class="song-artist">${esc(meta.artist)}</p>` : ""}
    </div>
    <div class="song-toolbar no-print">
      <div class="tool-group" title="גודל טקסט"><button class="tool" data-scale="1">א+</button><button class="tool" data-scale="-1">א−</button></div>
      <div class="tool-group" title="סולם">${key ? `<span class="tool-label">סולם <b dir="ltr">${esc(key)}</b></span>` : `<span class="tool-label">סולם</span>`}
        <button class="tool" data-shift="-1" title="חצי טון למטה">−½</button><button class="tool" data-shift="1" title="חצי טון למעלה">+½</button>
        ${songsState.shift ? `<button class="tool link" data-shift="0">מקורי</button><button class="tool" data-save-key>שמירת הסולם</button>` : ""}</div>
      ${capo ? `<div class="tool-group"><span class="tool-label">קאפו ${capo}</span>
        <button class="tool${songsState.noCapo ? " on" : ""}" data-nocapo>${songsState.noCapo ? "חזרה לאקורדי קאפו" : "בלי קאפו"}</button></div>` : ""}
      <div class="tool-group">
        <button class="tool" data-add-setlist>➕ לסשן הלל</button>
        <button class="tool" data-print title="הדפסה">🖨️</button>
        <button class="tool" data-present title="מצגת">📽️ מצגת</button>
        <button class="tool" data-song-edit>עריכה</button></div>
    </div>
    ${songsState.present ? `<div class="present-bar"><button class="tool" data-present-chords>${songsState.presentChords ? "הסתרת אקורדים" : "הצגת אקורדים"}</button>
      <button class="tool" data-scale="1">א+</button><button class="tool" data-scale="-1">א−</button><button class="tool" data-present>יציאה</button></div>` : ""}
    <div class="chordpro song-body">${renderChordPro(s.content, shift, { chords: !songsState.present || songsState.presentChords })}</div>
  </div>`;
}

function renderSongEdit(el) {
  const s = songsState.current || { title: "", song_key: "", content: "" };
  el.innerHTML = `<div class="song-view"><form class="song-form">
    <div class="song-head"><button type="button" class="link-btn" data-song-back>→ ביטול</button><h2>${s.id ? "עריכת שיר" : "שיר חדש"}</h2></div>
    <label class="field">שם השיר<input name="title" required value="${esc(s.title)}"></label>
    <label class="field">סולם<input name="song_key" value="${esc(s.song_key || "")}" dir="ltr" placeholder="Am"></label>
    <label class="field">מילים ואקורדים: אקורד בסוגריים מרובעים לפני ההברה, [Am]שלום [G]עולם · כותרת חלק: {פזמון} · קאפו: {capo: 2} · כותב: {artist: שם}
      <textarea name="content" rows="16" dir="${HEB.test(s.content) ? "rtl" : "ltr"}">${esc(s.content)}</textarea></label>
    <p class="hint">תצוגה מקדימה:</p>
    <div class="chordpro preview song-body">${renderChordPro(s.content)}</div>
    <div class="form-actions"><button class="btn" type="submit">שמירה</button>
      ${s.id && (isMine(s) || !s.added_by) ? `<button class="btn ghost" type="button" data-song-delete="${s.id}">מחיקת השיר</button>` : ""}</div>
  </form></div>`;
  const ta = el.querySelector("textarea");
  ta.addEventListener("input", () => { el.querySelector(".preview").innerHTML = renderChordPro(ta.value); });
}

function renderImport(el) {
  const d = songsState.drafts;
  el.innerHTML = `<div class="song-view">
    <div class="song-head"><button class="link-btn" data-song-back>→ ביטול</button><h2>ייבוא מ-PDF: נמצאו ${d.length} שירים</h2></div>
    <p class="hint">בדקו כל שיר, תקנו את השם או המילים אם צריך, וסמנו מה לשמור.</p>
    ${d.map((s, i) => `<details class="draft"${i < 3 ? " open" : ""}>
      <summary><label><input type="checkbox" data-draft-inc="${i}"${s.include ? " checked" : ""}> <b>${esc(s.title)}</b></label></summary>
      <label class="field">שם השיר<input data-draft-title="${i}" value="${esc(s.title)}"></label>
      <div class="chordpro preview song-body" data-draft-preview="${i}">${renderChordPro(s.content)}</div>
      <button class="link-btn" type="button" data-draft-edit="${i}">עריכת טקסט</button>
      <textarea data-draft-content="${i}" rows="10" dir="${HEB.test(s.content) ? "rtl" : "ltr"}" hidden>${esc(s.content)}</textarea>
    </details>`).join("")}
    <div class="form-actions"><button class="btn" data-import-save>שמירת ${d.filter((s) => s.include).length} שירים</button></div>
  </div>`;
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.closest("[data-song]")) {
    songsState.current = songsState.list.find((s) => s.id === Number(t.closest("[data-song]").dataset.song));
    songsState.view = "song"; songsState.shift = 0; songsState.noCapo = false; songsState.present = false; renderSongs(); scrollTo(0, 0); return;
  }
  if (t.closest("[data-song-back]")) { songsState.view = songsState.current && songsState.view === "edit" && songsState.current.id ? "song" : "list"; if (songsState.view === "list") songsState.current = null; renderSongs(); return; }
  if (t.closest("[data-song-new]")) { songsState.current = null; songsState.view = "edit"; renderSongs(); return; }
  if (t.closest("[data-song-edit]")) { songsState.view = "edit"; renderSongs(); return; }
  if (t.closest("[data-shift]")) { const n = Number(t.closest("[data-shift]").dataset.shift); songsState.shift = n ? songsState.shift + n : 0; renderSongs(); return; }
  if (t.closest("[data-scale]")) {
    songScale = Math.min(2.4, Math.max(0.7, +(songScale + 0.15 * Number(t.closest("[data-scale]").dataset.scale)).toFixed(2)));
    try { localStorage.setItem("ws-song-scale", songScale); } catch {}
    document.querySelector(".song-view")?.style.setProperty("--song-scale", songScale); return;
  }
  if (t.closest("[data-nocapo]")) { songsState.noCapo = !songsState.noCapo; renderSongs(); return; }
  if (t.closest("[data-print]")) { window.print(); return; }
  if (t.closest("[data-present-chords]")) { songsState.presentChords = !songsState.presentChords; renderSongs(); return; }
  if (t.closest("[data-present]")) {
    songsState.present = !songsState.present;
    if (songsState.present) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    renderSongs(); return;
  }
  if (t.closest("[data-save-key]")) {
    const cur = songsState.current, n = songsState.shift;
    const content = cur.content.replace(/\[([^\]]+)\]/g, (_, c) => `[${transposeChord(c, n)}]`);
    const row = { content, song_key: cur.song_key ? transposeChord(cur.song_key, n) : firstChord(content), updated_at: new Date().toISOString() };
    const { error } = await sb.from("songs").update(row).eq("id", cur.id);
    if (error) { toast("השמירה נכשלה"); return; }
    Object.assign(cur, row); songsState.shift = 0; toast("השיר נשמר בסולם החדש"); renderSongs(); return;
  }
  if (t.closest("[data-del-file]")) {
    const name = t.closest("[data-del-file]").dataset.delFile;
    const mine = songsState.list.filter((s) => s.source === name && isMine(s));
    if (!confirm(`למחוק את הקובץ "${name}" ואת ${mine.length} השירים שלו?`)) return;
    const { error } = await sb.from("songs").delete().in("id", mine.map((s) => s.id));
    if (error) { toast("המחיקה נכשלה"); return; }
    toast("הקובץ נמחק"); await loadSongs(); renderSongs(); return;
  }
  if (t.closest("[data-song-delete]")) {
    if (!confirm(`למחוק את "${songsState.current.title}"?`)) return;
    const { error } = await sb.from("songs").delete().eq("id", songsState.current.id);
    if (error) { toast("המחיקה נכשלה"); return; }
    toast("השיר נמחק"); songsState.current = null; songsState.view = "list"; await loadSongs(); renderSongs(); return;
  }
  if (t.closest("[data-draft-edit]")) {
    const i = t.closest("[data-draft-edit]").dataset.draftEdit;
    const ta = document.querySelector(`[data-draft-content="${i}"]`);
    ta.hidden = !ta.hidden; t.closest("[data-draft-edit]").textContent = ta.hidden ? "עריכת טקסט" : "סגירת עריכה";
    return;
  }
  if (t.closest("[data-import-save]")) {
    const rows = songsState.drafts.filter((s) => s.include && s.title.trim() && s.content.trim())
      .map((s) => ({ title: s.title.trim(), content: s.content, song_key: firstChord(s.content), source: songsState.importFile }));
    if (!rows.length) { toast("לא סומנו שירים"); return; }
    const { error } = await sb.from("songs").insert(rows);
    if (error) { toast("השמירה נכשלה"); return; }
    toast(`נשמרו ${rows.length} שירים`); songsState.drafts = []; songsState.view = "list"; await loadSongs(); renderSongs();
  }
});

document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "pdf-file" && t.files[0]) {
    const file = t.files[0];
    if (!window.pdfjsLib) { toast("קורא ה-PDF לא נטען, נסו לרענן"); return; }
    songsState.importing = true; renderSongs();
    try {
      const drafts = await pdfToSongs(file);
      songsState.importing = false;
      if (drafts === null) { toast("ה-PDF הזה סרוק כתמונה ואין בו טקסט, אי אפשר לקרוא ממנו אקורדים"); renderSongs(); return; }
      if (!drafts.length) { toast("לא נמצאו שירים בקובץ"); renderSongs(); return; }
      await saveImported(drafts, file.name);
    } catch (err) {
      console.error(err); songsState.importing = false; toast("קריאת הקובץ נכשלה"); renderSongs();
    }
    return;
  }
  if (t.matches("[data-draft-inc]")) { songsState.drafts[t.dataset.draftInc].include = t.checked; const b = document.querySelector("[data-import-save]"); if (b) b.textContent = `שמירת ${songsState.drafts.filter((s) => s.include).length} שירים`; }
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.matches("[data-draft-title]")) songsState.drafts[t.dataset.draftTitle].title = t.value;
  if (t.matches("[data-draft-content]")) {
    songsState.drafts[t.dataset.draftContent].content = t.value;
    document.querySelector(`[data-draft-preview="${t.dataset.draftContent}"]`).innerHTML = renderChordPro(t.value);
  }
});

document.addEventListener("submit", async (e) => {
  if (!e.target.matches(".song-form")) return;
  e.preventDefault();
  const f = new FormData(e.target);
  const row = { title: f.get("title").trim(), song_key: f.get("song_key").trim() || firstChord(f.get("content")), content: f.get("content"), updated_at: new Date().toISOString() };
  const cur = songsState.current;
  const { data, error } = cur?.id
    ? await sb.from("songs").update(row).eq("id", cur.id).select().single()
    : await sb.from("songs").insert(row).select().single();
  if (error) { toast("השמירה נכשלה"); return; }
  toast("השיר נשמר");
  await loadSongs();
  songsState.current = songsState.list.find((s) => s.id === data.id) || data;
  songsState.view = "song"; songsState.shift = 0; renderSongs();
});

// leaving fullscreen with Esc also leaves presentation mode
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && songsState.present) { songsState.present = false; renderSongs(); }
});
