// Songs tab: chord-sheet library (ChordPro-style "[Am]lyrics"), PDF import, transpose. Uses sb/esc/toast/$ from ws.js and the chord helpers from chords.js.
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const songsState = { loaded: false, list: [], query: "", view: "list", current: null, shift: 0, noCapo: false, present: false, presentChords: false, drafts: [], importing: false };
let songScale = 1;
try { songScale = Number(localStorage.getItem("ws-song-scale")) || 1; } catch {}

// chord helpers (CHORD_RE, transposeChord, renderChordPro, songMeta, cleanStr, …) live in chords.js

// "76. תודה לך אבי (capo 2)" -> title "תודה לך אבי" + {capo: 2}
function cleanTitle(raw) {
  const n = raw.match(/^\s*(\d{1,4})\s*[.)\-]/) || raw.match(/[.(]\s*(\d{1,4})\s*$/);
  let title = raw.replace(/^\s*\d+\s*[.)\-]\s*/, "").replace(/\s*[.(]\s*\d{1,4}\s*$/, "").trim();
  // RTL text extraction can mirror the brackets, so accept either side
  // also the mirrored form the PDF gives in Hebrew lines: "(apo 3C)" = "(Capo 3)"
  const cm = title.match(/[()]?\s*(?:(\d+)\s*c?apo|(?:c?apo|קאפו)\s*(\d+)\s*c?)\s*[()]?/i);
  const capo = cm && [cm[0], cm[1] || cm[2]];
  if (capo) title = title.replace(capo[0], "").replace(/[()]\s*[()]/g, "").replace(/^[\s()]+|[\s()]+$/g, "").trim();
  return { title, capo: capo ? capo[1] : null, num: n ? n[1] : null };
}

// ---------- PDF -> songs ----------
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
    mergeDigits(items);
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
      for (const l of lines) all.push({ ...toLine(l), page: p, y: l.y });
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
  // the table of contents names each number: that name wins over the page heading (e.g. 316 "ישוע חי")
  const tocNames = {};
  for (const l of all.filter((x) => tocPages.has(x.page) && !x.chords)) {
    const m = l.text.match(/^\s*(\d{1,4})\s+(.*\S)\s*$/) || l.text.match(/^\s*(.*\S)\s+(\d{1,4})\s*$/);
    if (!m) continue;
    const [num, name] = /^\d+$/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    if (!tocNames[num] && /[א-תa-zA-Z]/.test(name)) tocNames[num] = name.replace(/[.\s]+$/, "");
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
  // the TOC name wins only when it is really another name (not a spelling of the same one) and the number is unique in the book
  const numCount = {};
  songs.forEach((s) => { const n = cleanTitle(s.title).num; if (n) numCount[n] = (numCount[n] || 0) + 1; });
  const words = (t) => t.replace(/ה'/g, "אדני").replace(/[^א-תa-zA-Z\s]/g, " ").split(/\s+/).filter(Boolean).map((w) => w.replace(/[וי]/g, ""));
  const near = (a, b) => { // at most 2 letters apart ("המושיע"/"מושיע", "יברכך"/"יברך")
    let row = [...Array(b.length + 1).keys()];
    for (let i = 1; i <= a.length; i++) {
      const nxt = [i];
      for (let j = 1; j <= b.length; j++) nxt[j] = Math.min(row[j] + 1, nxt[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = nxt;
    }
    return Math.min(a.length, b.length) >= 5 && row[b.length] <= 2;
  };
  const sameName = (a, b) => { const A = words(a), B = words(b); return A.every((w) => B.includes(w)) || B.every((w) => A.includes(w)) || near(A.join(""), B.join("")); };
  return songs.map((s) => {
    const { title: pageTitle, capo, num } = cleanTitle(s.title);
    const toc = num && numCount[num] === 1 && tocNames[num] && cleanTitle(tocNames[num]).title;
    const title = toc && !sameName(toc, pageTitle) ? toc : pageTitle;
    const body = mergeChordLines(s.lines);
    return { title, pageTitle, num, content: (capo ? `{capo: ${capo}}\n` : "") + body.split("\n").map(fixNiqqudLine).join("\n"), include: true };
  }).filter((s) => s.content.trim()).map(stripCapoLines).map((s, _, all) => {
    // songs with the same name: add a line of the song in brackets, e.g. "אבינו מלכנו (שמענו קולנו)".
    // Use the first line that isn't just the name again and that differs between the twins.
    const twins = all.filter((x) => x.title === s.title);
    if (twins.length < 2) return s;
    const bare = (t) => t.replace(/[^א-תa-zA-Z]/g, "");
    const cands = (x) => lyricLines(x).filter((l) => bare(l) && bare(l) !== bare(x.title));
    for (let k = 0; k < 6; k++) {
      const picks = twins.map((x) => cands(x)[k]);
      if (picks.every(Boolean) && new Set(picks.map(bare)).size === picks.length) {
        return { ...s, baseTitle: s.title, title: `${s.title} (${picks[twins.indexOf(s)]})` };
      }
    }
    return { ...s, baseTitle: s.title, title: `${s.title} (${twins.indexOf(s) + 1})` };
  });
}

// a number can come split into touching pieces ("4","7" or "47","3"): join them, left to right, into one item
function mergeDigits(items) {
  const digits = items.filter((i) => /^\d+$/.test(i.str.trim())).sort((a, b) => a.x - b.x);
  for (const it of digits) {
    if (it.gone) continue;
    for (;;) {
      const nb = digits.find((o) => !o.gone && o !== it && Math.abs(o.y - it.y) < 1 && o.x >= it.x &&
        o.x - (it.x + it.w) < Math.max(1.5, it.h * 0.25) && o.x - (it.x + it.w) > -it.h * 0.3);
      if (!nb) break;
      it.str = it.str.trim() + nb.str.trim();
      it.w = Math.max(it.x + it.w, nb.x + nb.w) - it.x;
      nb.gone = true;
    }
  }
  for (let k = items.length - 1; k >= 0; k--) if (items[k].gone) items.splice(k, 1);
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
const CHORD_PIECE = /[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:(?:sus|add|maj|b|#|-|\+)\d+)*(?:\/[A-Ga-g][#b]?)?/g;
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
  // zero-width pieces with a letter (e.g. "ְָך") are the wrapped end of the line's last word: they go at the end
  const tails = [];
  for (const it0 of l.items) {
    // a wrapped word end stored inside the item between spaces ("עַמּ ְָך בִּרְכָת"): glue it back to its word
    const it = { ...it0, str: it0.str.replace(/ ([֑-ׇ]+)([ךםןףץ])(?=[\s,.;:!?)(]|$)/g, (_, mk, L) => { const a = [...mk]; const own = a.pop(); return a.join("") + L + own; }) };
    const chars = [...it.str];
    const letters = chars.filter((ch) => !IS_MARK.test(ch));
    if (it.w < 0.5 && letters.join("").trim()) { tails.push(it); continue; }
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
  // a tail "ְָך" holds the last mark(s) of the previous letter first, then the letter and its own mark: "ל" + "ְָך" -> "לְךָ"
  // each tail belongs to the word that ends where the tail sits (a word can wrap mid-line too)
  for (const tl of tails.sort((a, b) => (rtl ? a.x - b.x : b.x - a.x))) {
    const cs = [...tl.str], marks = cs.filter((ch) => IS_MARK.test(ch)), lets = cs.filter((ch) => !IS_MARK.test(ch) && ch.trim());
    const own = marks.length ? marks.pop() : null;
    // candidate word ends: a non-final Hebrew letter (plus its marks) followed by a space, punctuation or the line end
    let best = -1, bestD = Infinity;
    for (let i = 0; i < text.length; i++) {
      if (!/[א-ת]/.test(text[i]) || /[ךםןףץ]/.test(text[i])) continue;
      let j = i + 1;
      while (j < text.length && IS_MARK.test(text[j])) j++;
      if (j < text.length && /[א-ת]/.test(text[j])) continue;
      const d = Math.abs(pos[i] - tl.x);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best < 0) best = text.length;
    const ins = [...marks, ...lets, ...(own ? [own] : [])];
    text = text.slice(0, best) + ins.join("") + text.slice(best);
    pos.splice(best, 0, ...ins.map(() => pos[Math.max(0, best - 1)] ?? tl.x));
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
  if (HEB.test(text)) {
    const re = /([\u05D0-\u05EA][\u0591-\u05C7]*) ([\u0591-\u05C7]+)([\u05D0-\u05EA])(?=[\s,.;:!?)]|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const marks = [...m[2]], own = marks.pop();
      const fixed = m[1] + marks.join("") + m[3] + own;
      const at = m.index;
      text = text.slice(0, at) + fixed + text.slice(at + m[0].length);
      pos.splice(at + m[1].length, 1); // the removed space
      re.lastIndex = at + fixed.length;
    }
  }
  const h = Math.max(...l.items.map((i) => i.h));
  if (!HEB.test(text)) {
    // the whole row left to right, each char with its x (a chord may be split into pieces: "E" + "m")
    const row = [];
    let lastEnd = null;
    for (const it of [...l.items].sort((a, b) => a.x - b.x)) {
      if (!it.str) continue;
      const icw = it.w / Math.max(1, it.str.length);
      // "C" + "#m" is one chord even if the PDF leaves a small gap between the pieces
      const joins = /^[#b]|^(?:m|maj|min|sus|dim|aug|add|\d)/.test(it.str) && /[A-G#b]$/.test(row.map((r) => r.ch).join(""));
      if (lastEnd !== null && !joins && it.x - lastEnd > Math.max(1.5, icw * 0.3)) row.push({ ch: " ", x: lastEnd });
      [...it.str].forEach((ch, k) => row.push({ ch, x: it.x + k * icw, w: icw }));
      lastEnd = it.x + it.w;
    }
    const rowText = row.map((r) => r.ch).join("");
    const chords = [];
    let ok = true, any = false;
    for (const m of rowText.matchAll(/\S+/g)) {
      if (FILLER_RE.test(m[0])) continue;
      const lead = m[0].match(/^[()]*/)[0].length;
      const bare = m[0].replace(/^[()]+|[()]+$/g, "");
      if (!bare) continue;
      const pieces = splitGlued(bare);
      if (!pieces) { ok = false; break; }
      for (const pc of pieces) {
        const a = row[m.index + lead + pc.at], z = row[m.index + lead + pc.at + pc.name.length - 1];
        chords.push({ name: pc.name, xL: a.x, xR: z.x + (z.w || 0) });
        any = true;
      }
    }
    if (ok && any) return { text: chords.map((c) => c.name).join(" "), rtl, chords, h };
  }
  return { text, rtl, pos, h };
}

const songIsRtl = (lines) => lines.some((l) => !l.chords && l.rtl);

// chord line + following lyric line -> "[Am]lyr[G]ics"
// a gap clearly bigger than the song's usual line spacing = a new verse/chorus (the PDF has no empty lines, only space)
function markStanzaBreaks(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) if (lines[i].page === lines[i - 1].page) gaps.push(lines[i - 1].y - lines[i].y);
  const usual = median(gaps.filter((g) => g > 0));
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].page === lines[i - 1].page ? lines[i - 1].y - lines[i].y : 0;
    lines[i].breakBefore = usual > 0 && g > usual * 1.55;
  }
}

function mergeChordLines(lines) {
  markStanzaBreaks(lines);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.breakBefore && out.length && out[out.length - 1] !== "") out.push("");
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
  // the server returns at most 1000 rows per request: read page by page
  let data = [], error = null;
  for (let from = 0; ; from += 1000) {
    const r = await sb.from("songs").select("*").order("title").order("id").range(from, from + 999);
    if (r.error) { error = r.error; break; }
    data = data.concat(r.data);
    if (r.data.length < 1000) break;
  }
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
  // a number printed twice in the book gets "#267", "#267-2"
  const seenNum = {};
  drafts.forEach((d) => { if (d.num) { seenNum[d.num] = (seenNum[d.num] || 0) + 1; d.numKey = seenNum[d.num] > 1 ? `${d.num}-${seenNum[d.num]}` : d.num; } });
  const key = (d) => (d.num ? `${fileName}#${d.numKey}` : null);
  const bySource = new Map(songsState.list.filter((x) => x.source).map((x) => [x.source, x]));
  // older imports were saved as just the file name: match those by title, in order, so duplicates pair up 1:1
  const legacy = new Map();
  for (const x of [...songsState.list].sort((a, b) => a.id - b.id)) {
    if (x.source && x.source.includes("#")) continue;
    const t = x.title.trim();
    if (!legacy.has(t)) legacy.set(t, []);
    legacy.get(t).push(x);
  }
  const fresh = [], updates = [];
  for (const d of drafts) {
    const row = { title: d.title.trim(), content: d.content, song_key: firstChord(d.content), source: key(d) || fileName, updated_at: new Date().toISOString() };
    if (!row.title || !row.content.trim()) continue;
    const old = (key(d) && bySource.get(key(d))) || legacy.get(row.title)?.shift() || legacy.get((d.baseTitle || "").trim())?.shift();
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

// lyric lines of a song, without chords/directives, short (up to the first comma) for use in a title
const lyricLines = (s) => s.content.split("\n").map((l) => l.replace(/\[[^\]]*\]|\{[^}]*\}/g, "").trim())
  .filter((l) => /[\u05D0-\u05EAa-zA-Z]{2}/.test(l.replace(/[\u0591-\u05C7]/g, "")) && !/c?apo\s*\d/i.test(l))
  .map((l) => l.split(/[,.;:!?]/)[0].replace(/[\u0591-\u05C7]/g, "").trim().slice(0, 40)).filter(Boolean);

// a stray capo line in the lyrics ("apo 3C", "Capo 2") becomes the {capo: N} directive
function stripCapoLines(s) {
  let capo = null;
  const kept = s.content.split("\n").filter((l) => {
    const m = l.replace(/\[[^\]]*\]/g, "").trim().match(/^[()\s]*c?apo\s*(\d)\s*[a-z]*[()\s]*$|^[()\s]*(\d)\s*c?apo[()\s]*$/i);
    if (m) { capo = capo || m[1] || m[2]; return false; }
    return true;
  });
  if (!capo) return s;
  const body = kept.join("\n").replace(/^\{capo:[^}]*\}\n?/, "");
  return { ...s, content: `{capo: ${capo}}\n` + body };
}

const sameName = (s) => songsState.list.filter((x) => x.title.trim() === s.title.trim()).length > 1;
const firstLine = (s) => (s.content.split("\n").map((l) => l.replace(/\[[^\]]*\]|\{[^}]*\}/g, "").trim()).find((l) => /[\u05D0-\u05EAa-zA-Z]{2}/.test(l.replace(/[\u0591-\u05C7]/g, ""))) || "").split(/[,.;:!?]/)[0].trim().slice(0, 40);

function searchResultsHtml() {
  const q = songsState.query.trim();
  if (!q) return songsState.list.length ? "" : `<p class="status">עדיין אין שירים. אפשר להוסיף שיר או לייבא מ-PDF.</p>`;
  // ignore niqqud, chords and punctuation, so "ישוע חי" also finds "יֵשׁוּעַ [G]חַי,"
  const norm = (t) => t.replace(/\[[^\]]*\]|\{[^}]*\}/g, "").replace(/[֑-ׇ]/g, "").replace(/[^א-תa-zA-Z0-9]+/g, " ").toLowerCase().trim();
  const nq = norm(q);
  const inTitle = (s) => norm(s.title).includes(nq);
  const list = nq ? songsState.list.filter((s) => inTitle(s) || norm(s.content).includes(nq)) : [];
  if (!list.length) return `<p class="status">לא נמצאו שירים</p>`;
  return `<div class="search-results">${list.sort((a, b) => (inTitle(b) - inTitle(a)) || a.title.localeCompare(b.title, "he"))
    .slice(0, 50).map((s) => `<button class="idx-song" data-song="${s.id}">${esc(s.title)}${sameName(s) ? `<small class="first-line"> · ${esc(firstLine(s))}</small>` : ""}</button>`).join("")}</div>`;
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
    const file = s.source.split("#")[0];
    const key = file + "|" + (s.added_by || "");
    const f = files.get(key) || { name: file, by: s.added_by, count: 0, at: s.created_at };
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
    const mine = songsState.list.filter((s) => (s.source || "").split("#")[0] === name && isMine(s));
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
