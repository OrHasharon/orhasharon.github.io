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
  const cm = title.match(/[()]?\s*(?:(\d+)\s*[()]?\s*c?apo|(?:c?apo|קאפו)\s*[()]?\s*(\d+)\s*c?)\s*[()]?/i); // also mirrored "( 3(capo"
  const capo = cm && [cm[0], cm[1] || cm[2]];
  if (capo) title = title.replace(capo[0], "").replace(/[()]\s*[()]/g, "").replace(/^[\s()]+|[\s()]+$/g, "").trim();
  return { title, capo: capo ? capo[1] : null, num: n ? n[1] : null };
}

// ---------- PDF -> songs ----------
const median = (arr) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

// ---------- scanned sheets and photos: text recognition (Tesseract, Hebrew + English, free, runs in the browser) ----------
// Gives the same pieces as a PDF's text layer — words with their place on the page (y counted from the bottom) —
// so pictures go through the very same song reader.
const OCR_JS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
let ocrWorker = null;
async function ocrReady() {
  if (!window.Tesseract) await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = OCR_JS; s.onload = ok; s.onerror = bad; document.head.append(s); });
  if (!ocrWorker) ocrWorker = await Tesseract.createWorker(["heb", "eng"]);
  return ocrWorker;
}
async function ocrItems(image, width, height) {
  const w = await ocrReady();
  const { data } = await w.recognize(image);
  return (data.words || []).filter((x) => x.text && x.text.trim() && x.confidence > 20).map((x) => ({
    str: cleanStr(x.text), x: x.bbox.x0, y: height - x.bbox.y1, w: x.bbox.x1 - x.bbox.x0, h: (x.bbox.y1 - x.bbox.y0) * 0.8,
  }));
}
// text recognition reads chord letters as look-alikes: "G"→"6", "D"→"0"/"O", "m"→"ם". On a row of short tokens with no
// Hebrew words (a chord row) put them back, so the chords land over the words like in a PDF.
function fixOcrChordRow(items) {
  // a lone "ם" / "m" read next to a chord letter is its "m" ("G" + "ם" = "Gm"); stray bars "|" are dropped
  for (let k = items.length - 1; k >= 0; k--) {
    const it = items[k], s = it.str.trim();
    if (/^[|¦]+$/.test(s)) { items.splice(k, 1); continue; }
    if (!/^[םm]$/.test(s)) continue;
    const nb = items.find((o) => o !== it && /^[A-G0-9O][#b]?$/.test(o.str.trim()) && Math.abs(o.x + o.w - it.x) < it.h * 0.8);
    if (nb) { nb.str = nb.str.trim() + "m"; nb.w = it.x + it.w - nb.x; items.splice(k, 1); }
    else if (s === "ם") it.str = "D"; // on its own, a "D" read as the look-alike "ם"
  }
  const toks = items.map((i) => i.str.trim()).filter(Boolean);
  if (!toks.length || toks.some((t) => t.length > 6 || /[א-ת]{2}/.test(t.replace(/ם$/, "")))) return;
  const fix = (t) => t.replace(/^6/, "G").replace(/^[0Oo]/, "D").replace(/^8/, "B").replace(/ם/g, "m").replace(/^([A-G])\s*[#H]/, "$1#");
  const fixed = toks.map(fix);
  const chordish = fixed.filter((t) => CHORD_RE.test(t)).length;
  if (chordish < Math.ceil(toks.length * 0.6)) return;
  for (const it of items) { const f = fix(it.str.trim()); if (CHORD_RE.test(f)) it.str = f; }
}
// ---------- Word (.docx): drawn by docx-preview in a hidden box, then every word's place is measured ----------
// so the chords typed above the words (with spaces) land where they appear on the page, like in a PDF.
const DOCX_JS = "https://cdn.jsdelivr.net/npm/docx-preview@0.3.6/dist/docx-preview.min.js";
const isDocxFile = (file) => /\.docx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
async function docxPages(file) {
  if (!window.docx) await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = DOCX_JS; s.onload = ok; s.onerror = bad; document.head.append(s); });
  const box = document.createElement("div");
  box.className = "docx-measure";
  box.style.cssText = "position:fixed;left:-20000px;top:0;width:max-content;visibility:hidden;pointer-events:none";
  // keep every space: Word lines chords up with runs of spaces, and HTML would fold them into one
  if (!document.getElementById("docx-measure-css")) { const st = document.createElement("style"); st.id = "docx-measure-css"; st.textContent = ".docx-measure, .docx-measure * { white-space: pre !important; }"; document.head.append(st); }
  document.body.append(box);
  // Word draws Hebrew with the document's "complex script" font (w:cs, e.g. Times New Roman) and Latin (the chords)
  // with the theme font (e.g. Calibri); the preview would use one font for both, and the widths — so the chords'
  // places over the words — would drift. Measure with the same two fonts.
  const buf = await file.arrayBuffer();
  try {
    const zip = await JSZip.loadAsync(buf);
    const styles = (await zip.file("word/styles.xml")?.async("string")) || "";
    const theme = (await zip.file("word/theme/theme1.xml")?.async("string")) || "";
    const cs = (styles.match(/<w:rPrDefault>[\s\S]*?w:cs="([^"]+)"/) || [])[1] || "Times New Roman";
    const latin = (theme.match(/<a:minorFont>\s*<a:latin typeface="([^"]+)"/) || [])[1] || "Calibri";
    let st = document.getElementById("docx-fonts");
    if (!st) { st = document.createElement("style"); st.id = "docx-fonts"; document.head.append(st); }
    // a Hebrew document (paragraphs right-to-left by default, <w:bidi/>): the preview leaves them left-to-right, and
    // then the spaces before a chord land on the wrong side — Word puts them at the right, before the first chord
    const rtl = /<w:pPrDefault>[\s\S]*?<w:bidi\/>/.test(styles);
    // the theme's fonts: "majorBidi" / "minorBidi" = the Hebrew font of the theme's major / minor set (often Times
    // New Roman) — Word uses it for every letter of such a run, the chords included
    const themeFont = (set, script) => (theme.match(new RegExp(`<a:${set}>[\\s\\S]*?<a:font script="${script}" typeface="([^"]+)"`)) || [])[1];
    const themeLatin = (set) => (theme.match(new RegExp(`<a:${set}>\\s*<a:latin typeface="([^"]+)"`)) || [])[1];
    const v = {
      majorBidi: themeFont("majorFont", "Hebr") || cs, minorBidi: themeFont("minorFont", "Hebr") || cs,
      majorHAnsi: themeLatin("majorFont") || latin, minorHAnsi: themeLatin("minorFont") || latin,
    };
    st.textContent = `@font-face { font-family: "DocxHeb"; src: local("${cs}"); unicode-range: U+0590-05FF, U+FB1D-FB4F; }
      .docx-measure, .docx-measure * { ${Object.entries(v).map(([k, f]) => `--docx-${k}-font: "${f}" !important;`).join(" ")} }
      .docx-measure { font-family: "DocxHeb", "${latin}", sans-serif; }
      ${rtl ? ".docx-measure p { direction: rtl !important; }" : ""}`;
  } catch {}
  try {
    await docx.renderAsync(buf, box, null, { inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: false, renderFooters: false, ignoreWidth: true });
    // a chord row ("A9" + many spaces) in a right-to-left paragraph: Word keeps the spaces to the right of the chord
    // (so the chord sits far to the left, over the end of the line); a browser moves trailing spaces aside. An
    // invisible left-to-right mark at the end keeps the spaces with the chords, as in Word.
    for (const p of box.querySelectorAll("p")) {
      if (!/[֐-׿]/.test(p.textContent) && /[A-G]/.test(p.textContent) && /\s$/.test(p.textContent)) p.append("‎");
    }
    const sections = [...box.querySelectorAll("section")].filter((s) => s.textContent.trim());
    const pages = [];
    for (const sec of (sections.length ? sections : [box])) {
      const pr = sec.getBoundingClientRect(), items = [];
      const walk = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const size = parseFloat(getComputedStyle(n.parentElement).fontSize) || 12;
        for (const m of n.data.matchAll(/\S+/g)) {
          const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
          const rect = r.getBoundingClientRect();
          if (!rect.width) continue;
          items.push({ str: cleanStr(m[0]), x: rect.left - pr.left, y: pr.bottom - rect.bottom + size * 0.2, w: rect.width, h: size });
        }
      }
      pages.push({ items, width: pr.width || 1000 });
    }
    return pages;
  } finally { box.remove(); }
}
const isImageFile = (file) => /^image\//.test(file.type) || /\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name);
async function imagePages(file) {
  const img = await createImageBitmap(file);
  // big enough for small chord letters, not so big that recognition crawls
  const k = Math.min(2.5, Math.max(1, 2200 / img.width));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return [{ items: await ocrItems(c, c.width, c.height), width: c.width, ocr: true }];
}
// a PDF's pages: its text layer; a page with no text (a scan) is read with text recognition
async function pdfPages(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const width = page.getViewport({ scale: 1 }).width;
    let items = tc.items.map((it) => ({ ...it, str: cleanStr(it.str) })).filter((it) => it.str && it.str.trim()).map((it) => ({
      str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height,
    }));
    let ocr = false;
    if (!items.length) {
      const vp = page.getViewport({ scale: Math.min(3, 2200 / width) });
      const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      items = await ocrItems(c, c.width, c.height); ocr = items.length > 0; // an empty page is not a scan
      pages.push({ items, width: c.width, ocr }); continue;
    }
    pages.push({ items, width, ocr });
  }
  return pages;
}

async function pdfToSongs(file) {
  // a file with no extension (e.g. "מנת חלקי"): a PDF if it opens as one, otherwise a picture
  const src = isDocxFile(file) ? await docxPages(file) : isImageFile(file) ? await imagePages(file) : await pdfPages(file).catch(() => imagePages(file));
  const pdf = { numPages: src.length };
  const songs = [];
  let totalText = 0;
  pdfToSongs.ocr = src.some((pg) => pg.ocr);
  const all = []; // every line of the document, in reading order
  for (let p = 1; p <= src.length; p++) {
    const { items, width } = src[p - 1];
    totalText += items.length;
    if (!items.length) continue;
    mergeDigits(items);
    for (const col of splitColumns(items, width)) {
      // group into lines by baseline
      col.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of col) {
        const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.h * 0.45));
        if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
      }
      lines.sort((a, b) => b.y - a.y);
      for (const l of lines) {
        if (src[p - 1].ocr) fixOcrChordRow(l.items);
        // "בית א'  F  Gm  Dm": a section name on the chord row → the name on its own line, then the chords
        const heb = l.items.filter((i) => HEB.test(i.str)), rest = l.items.filter((i) => !HEB.test(i.str) && i.str.trim());
        const name = heb.sort((a, b) => b.x - a.x).map((i) => i.str.trim()).join(" ").trim();
        const chordy = rest.length && rest.every((i) => i.str.trim().split(/\s+/).every((t) => CHORD_RE.test(t) || /^[|/\-–()x\d]+$/.test(t)));
        if (heb.length && chordy && /^(בית\s*[א-ת0-9]?['׳]?|פזמון|גשר|מעבר|סיום|פתיחה|קודה)\s*:?$/.test(name)) {
          all.push({ ...toLine({ y: l.y, items: heb }), page: p, y: l.y + 0.01 });
          all.push({ ...toLine({ y: l.y, items: rest }), page: p, y: l.y });
          continue;
        }
        all.push({ ...toLine(l), page: p, y: l.y });
      }
    }
  }
  if (!totalText) return null; // no text at all, not even with text recognition
  pdfToSongs.pages = src.length; pdfToSongs.book = false;

  // table of contents pages ("283 אגילה בן" lines, no chords) are skipped: the site builds its own index
  const TOC_LINE = /^\s*\d{1,4}\s+[^\d\s.)]|[^\d\s.(]\s+\d{1,4}\s*$/;
  const tocPages = new Set();
  for (const pg of new Set(all.map((l) => l.page))) {
    const lyric = all.filter((l) => l.page === pg && !l.chords && l.text.trim());
    // "283 אגילה בן" (a book's index), or an album's track list ".1 די לי" / "1. די לי" when nearly the whole page is that
    const track = lyric.filter((l) => /^\s*\.?\d{1,2}\.?\s+\S/.test(l.text) && l.text.trim().length < 40);
    const toc = track.length >= 5 && track.length >= lyric.length * 0.7 ? track
      : lyric.filter((l) => TOC_LINE.test(l.text) && !/^\s*\d{1,4}\s*[.)]/.test(l.text));
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
  // numbered verses in one song ("1. בניסיון להביט…", "2. …") aren't a songbook: a short file whose numbers are just
  // 1, 2, 3… in the lyrics' own size stays one song
  const lyricH0 = median(all.filter((l) => !l.chords).map((l) => l.h));
  // a repeat mark ("( X2)", "X 3") is not a numbered song heading: a heading has a real name
  const realName = (t) => /[א-ת]{2}|[a-wyzA-WYZ]{3}/.test(cleanTitle(t).title.replace(/\b[xX×]\b/g, ""));
  const numberedAll = all.filter((l) => !l.chords && NUMBERED.test(l.text) && l.text.trim().length < 80 && realName(l.text));
  const nums = numberedAll.map((l) => Number(cleanTitle(l.text).num)).filter(Boolean);
  const verseNumbers = pdf.numPages <= 3 && nums.length && nums.every((n, i) => n === i + 1) && numberedAll.every((l) => l.h <= lyricH0 * 1.1);
  const numbered = verseNumbers ? [] : numberedAll;
  pdfToSongs.book = numbered.length > 0; // a numbered songbook: many songs per file is expected
  const lyricH = median(all.filter((l) => !l.chords).map((l) => l.h));
  // Not a numbered songbook (e.g. one song in a PDF): a song starts only with big text at the TOP of a page.
  // Big lines further down ("פזמון", "בית 2", a bigger chorus) stay inside the song — before, one song became 4.
  // the page's heading = the biggest of its first 3 lines; a bare page number ("1") at the top is left out altogether
  const firstOfPage = new Set();
  const pageNumber = (l) => /^\s*\d{1,3}\s*$/.test(l.text);
  for (const pg of new Set(all.map((l) => l.page))) {
    const top = all.filter((l) => l.page === pg && !l.chords && l.text.trim()).slice(0, 4);
    top.filter((l, i) => i < 2 && pageNumber(l)).forEach((l) => all.splice(all.indexOf(l), 1));
    const cand = top.filter((l) => !pageNumber(l)).slice(0, 3);
    const big = cand.reduce((m, l) => (!m || l.h > m.h + 0.5 ? l : m), null);
    if (big) firstOfPage.add(big);
  }
  const isTitle = numbered.length
    ? (l) => !l.chords && NUMBERED.test(l.text) && l.text.trim().length < 80 && realName(l.text)
    : (l) => firstOfPage.has(l) && l.h > lyricH * 1.2 && l.text.trim().length < 60;
  let current = null;
  // a key in brackets after the name ("דַּי לִי(F)", mirrored ")(Eb") isn't part of it
  const KEY_IN_TITLE = /\s*[()]\s*\**\s*[A-G][#b]?m?\s*[()]?\s*$|\s*[()]{2}\s*\**\s*[A-G][#b]?m?\s*$/;
  for (const ln of all) {
    if (isTitle(ln)) {
      const raw = ln.text.trim(), title = raw.replace(KEY_IN_TITLE, "").trim() || raw;
      current = { title, lines: [] }; songs.push(current); continue;
    }
    if (!current) { current = { title: `עמוד ${ln.page}`, lines: [] }; songs.push(current); }
    current.lines.push(ln);
  }
  // one song with no title line: its name is the file's ("נושא את עיניי אל ישוע-1.pdf" → "נושא את עיניי אל ישוע")
  // — or its first line, when the next one is the credits ("מילים ולחן: …"): then that line is the name, not lyrics
  if (songs.length === 1 && /^עמוד \d+$/.test(songs[0].title)) {
    const [a, b] = songs[0].lines.filter((l) => !l.chords && l.text.trim());
    if (a && b && a.text.trim().length < 50 && /מילים|לחן|מאת|תרגום|words|music|by\b/i.test(b.text)) {
      songs[0].title = a.text.trim(); songs[0].lines.splice(songs[0].lines.indexOf(a), 1);
    } else songs[0].title = file.name.replace(/\.(pdf|jpe?g|png|webp|bmp|gif)$/i, "").replace(/[-_ ]\(?\d+\)?$/, "").trim() || songs[0].title;
  }
  // a picture of one song: its file name ("06 הימים האחרונים.jpg") is more reliable than the recognized heading
  const fileTitle = file.name.replace(/\.(pdf|jpe?g|png|webp|bmp|gif)$/i, "").replace(/^\s*\d{1,3}[\s.\-_]+/, "").replace(/[-_ ]\(?\d+\)?$/, "").replace(/\s*-\s*copy$/i, "").trim();
  if (pdfToSongs.ocr && songs.length === 1 && /[א-תa-zA-Z]{2}/.test(fileTitle)) songs[0].title = fileTitle;
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
    const ct = cleanTitle(s.title), { capo, num } = ct;
    // "(*E" left after "(capo 2*E)" came out; a lone key letter after a Hebrew name ("בואו לפניו C")
    const pageTitle = ct.title.replace(KEY_IN_TITLE, "").replace(/([א-ת][\u0591-\u05C7]*)\s+[A-G][#b]?m?\s*$/, "$1").replace(/[\s(]+$/, "").trim() || ct.title;
    const toc = num && numCount[num] === 1 && tocNames[num] && cleanTitle(tocNames[num]).title;
    const title = toc && !sameName(toc, pageTitle) ? toc : pageTitle;
    const body = mergeChordLines(s.lines);
    // a section heading on its own line ("פזמון", "בית 2", "Chorus") becomes a {label}, so it isn't shown as lyrics
    const SECTION = /^\s*(פזמון(\s*(?:[xX×]\s*\d|\d\s*[xX×]))?|בית(\s*[א-ת0-9]['׳]?)?|גשר|מעבר|סיום|פתיחה|קודה|intro|outro|chorus|pre-?chorus|verse(\s*\d+)?|bridge|tag|ending)\s*:?\s*$/i;
    const lines = body.split("\n").flatMap((l) => {
      if (SECTION.test(l)) return [`{${l.trim().replace(/:$/, "")}}`];
      // "פזמון: נושא את עיניי…" → {פזמון} + the line; a numbered verse "1. בניסיון…" → {בית 1} + the line
      const lab = l.match(/^\s*(פזמון|גשר|מעבר|סיום|פתיחה)\s*:\s*(\S.*)$/);
      if (lab) return [`{${lab[1]}}`, lab[2]];
      const vn = verseNumbers && l.match(/^\s*(\d{1,2})\s*[.)]\s*(\S.*)$/);
      if (vn) return [`{בית ${vn[1]}}`, vn[2]];
      // a chord written backwards inside a Hebrew line ("mG" for Gm, "maj7G" for Gmaj7)
      return [HEB.test(l) ? l.replace(/(^|[\s\[(])((?:maj7|m7|m|7|sus4|sus2|dim|add9))([A-G][#b]?)(?=[\s\])]|$)/g, "$1$3$2") : l];
    });
    // "Gm [או Em A]" over a line: the chord goes over the line, the alternative becomes a note ({c: …}), not a chord
    for (let i = 0; i < lines.length - 1; i++) {
      const m = lines[i].match(/^\s*([A-G][#b]?[^\s\[\]()]*)\s*[\[(]\s*(או\s+[^\])]+?)\s*[\])]\s*$/);
      if (m && CHORD_RE.test(m[1]) && /[א-ת]{2}/.test(lines[i + 1].replace(/\[[^\]]*\]/g, "")) && !/^\s*\[/.test(lines[i + 1])) {
        lines.splice(i, 2, `{c: ${m[2]}}`, `[${m[1]}]${lines[i + 1].trimStart()}`);
      }
    }
    return { title, pageTitle, num, content: (capo ? `{capo: ${capo}}\n` : "") + lines.map(fixNiqqudLine).join("\n"), include: true };
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
  if (!cuts.length) return gutterColumns(items, width);
  const edges = [-Infinity, ...cuts, Infinity];
  const cols = edges.slice(1).map((hi, k) => items.filter((i) => i.x + i.w / 2 > edges[k] && i.x + i.w / 2 <= hi));
  const big = cols.filter((c) => c.length >= 3);
  if (big.length < 2) return [items];
  const hebrew = items.filter((i) => HEB.test(i.str)).length > items.length / 4;
  return hebrew ? big.reverse() : big; // Hebrew books read the right column first
}

// Two columns under a centred heading (song sheets: "בית א'" on the right, "בית ב'" on the left): the heading covers
// the gap, so look for a vertical gutter that almost no line crosses. Lines above the first line that has text on both
// sides are the heading (name, artist) and come first; then the right column, then the left one (Hebrew).
function gutterColumns(items, width) {
  const rows = [];
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) < Math.max(2, it.h * 0.45));
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  if (rows.length < 8) return [items];
  const BINS = 200, bin = (x) => Math.max(0, Math.min(BINS - 1, Math.floor((x / width) * BINS)));
  const cover = new Array(BINS).fill(0);
  for (const r of rows) {
    const hit = new Set();
    for (const it of r.items) for (let b = bin(it.x); b <= bin(it.x + it.w); b++) hit.add(b);
    hit.forEach((b) => cover[b]++);
  }
  // the widest run of almost-empty bins in the middle half of the page
  const low = Math.max(1, Math.floor(rows.length * 0.12));
  let best = null;
  for (let b = Math.floor(BINS * 0.25); b < BINS * 0.75; b++) {
    if (cover[b] > low) continue;
    let e = b; while (e + 1 < BINS * 0.75 && cover[e + 1] <= low) e++;
    if (!best || e - b > best[1] - best[0]) best = [b, e];
    b = e;
  }
  if (!best || (best[1] - best[0] + 1) / BINS < 0.02) return [items];
  const cut = ((best[0] + best[1] + 1) / 2 / BINS) * width;
  const side = (it) => (it.x + it.w / 2 < cut ? "L" : "R");
  const both = rows.filter((r) => r.items.some((i) => side(i) === "L") && r.items.some((i) => side(i) === "R"));
  if (both.length < 3) return [items];
  const startY = Math.max(...both.map((r) => r.y)); // the first line with both columns
  const head = items.filter((i) => i.y > startY + 1);
  const rest = items.filter((i) => i.y <= startY + 1);
  const L = rest.filter((i) => side(i) === "L"), R = rest.filter((i) => side(i) === "R");
  if (L.length < 3 || R.length < 3) return [items];
  const hebrew = items.filter((i) => HEB.test(i.str)).length > items.length / 4;
  return [...(head.length ? [head] : []), ...(hebrew ? [R, L] : [L, R])];
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
      const sofar = row.map((r) => r.ch).join("");
      // "D" + "/" + "F#" is one chord ("D/F#") even with a gap after the slash
      const joins = (/^[#b/]|^(?:m|maj|min|sus|dim|aug|add|\d)/.test(it.str) && /[A-G#b]$/.test(sofar)) || (/^\s*[A-G]/.test(it.str) && /[A-G][#b]?(?:m|\d)*\/\s*$/.test(sofar));
      if (joins && /\/\s+$/.test(sofar)) while (row.length && row[row.length - 1].ch === " ") row.pop();
      if (lastEnd !== null && !joins && it.x - lastEnd > Math.max(1.5, icw * 0.3)) row.push({ ch: " ", x: lastEnd });
      [...it.str].forEach((ch, k) => row.push({ ch, x: it.x + k * icw, w: icw }));
      lastEnd = it.x + it.w;
    }
    // "D/ F#" → "D/F#": no spaces right after a slash
    for (let k = 1; k < row.length; k++) while (k < row.length && row[k].ch === " " && row[k - 1].ch === "/") row.splice(k, 1);
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
  const results = await Promise.all([fresh.length ? sb.from("songs").insert(fresh).select("id, title") : { error: null, data: [] }, ...updates]);
  const failed = results.filter((r) => r.error).length;
  const saved = [...(results[0].data || []), ...results.slice(1).flatMap((r) => r.data || [])];
  return { added: fresh.length, updated: updates.length, failed, saved };
}

// ---------- import report: what came in from each file, and anything that looks wrong ----------
// Stays above the song list until closed, so a file that didn't import well is never silent.
function importChecks(drafts, pages, book = false) {
  const w = [];
  const lyricCount = (d) => d.content.split("\n").filter((l) => /[א-תa-zA-Z]{2}/.test(l.replace(/\[[^\]]*\]|\{[^}]*\}/g, "").replace(/[֑-ׇ]/g, ""))).length;
  if (!book && drafts.length > 1 && drafts.length > pages) w.push(`הקובץ (${pages} ${pages === 1 ? "עמוד" : "עמודים"}) התחלק ל-${drafts.length} שירים. אם זה שיר אחד, כדאי לבדוק.`);
  const untitled = drafts.filter((d) => /^עמוד \d+$/.test(d.title));
  if (untitled.length) w.push(`לא נמצא שם ל-${untitled.length} ${untitled.length === 1 ? "שיר" : "שירים"} (נקרא/ו "${untitled[0].title}").`);
  const short = drafts.filter((d) => lyricCount(d) < 2);
  if (short.length) w.push(`${short.length === 1 ? "שיר אחד" : short.length + " שירים"} כמעט בלי מילים: ${short.slice(0, 3).map((d) => `"${d.title}"`).join(", ")}.`);
  if (!drafts.some((d) => /\[[^\]]+\]/.test(d.content))) w.push("לא נמצאו אקורדים בקובץ.");
  return w;
}

function importReportHtml() {
  const r = songsState.report;
  if (!r?.length) return "";
  return `<div class="import-report">
    <div class="ir-head"><b>ייבוא קבצים</b><button class="link-btn" data-report-close>סגירה ✕</button></div>
    ${r.map((f) => `<div class="ir-file${f.error ? " bad" : f.warnings.length ? " warn" : " ok"}">
      <div><b dir="auto">${esc(f.name)}</b> · ${f.error ? `<span class="ir-err">❌ ${esc(f.error)}</span>`
        : `✓ ${f.added ? `נוספו ${f.added}` : ""}${f.added && f.updated ? ", " : ""}${f.updated ? `עודכנו ${f.updated}` : ""}${!f.added && !f.updated ? "לא נשמר אף שיר" : ""}${f.failed ? ` · ${f.failed} לא נשמרו` : ""}`}</div>
      ${f.warnings.map((w) => `<div class="ir-warn">⚠ ${esc(w)}</div>`).join("")}
      ${f.saved?.length ? `<div class="ir-songs">${f.saved.map((s) => `<button class="idx-song" data-song="${s.id}">${esc(s.title)}</button>`).join("")}</div>` : ""}
    </div>`).join("")}
  </div>`;
}

async function importFiles(files) {
  if (!window.pdfjsLib) { toast("קורא ה-PDF לא נטען, נסו לרענן"); return; }
  songsState.importing = true; songsState.report = []; renderSongs();
  // a big batch: one file at a time, the report grows as it goes
  for (const file of files) {
    const entry = { name: file.name, warnings: [], saved: [] };
    songsState.report.push(entry);
    // files that can't hold songs we can read: say so, with what to do instead
    const unsupported = /\.(xlsx?|csv)$/i.test(file.name) ? "קובץ אקסל — אין בו שירים לקריאה (אם זו רשימת שירים / תוכן עניינים, האתר בונה רשימה משלו)"
      : /\.doc$/i.test(file.name) ? "קובץ Word ישן (‎.doc) — פתחו אותו ב-Word ושמרו כ-‎.docx או PDF, ואז העלו שוב"
      : /\.(pptx?|key)$/i.test(file.name) ? "מצגת — שמרו אותה כ-PDF ואז העלו"
      : /\.(txt|rtf|odt|pages|zip|rar|mp3|mp4|mov|wav)$/i.test(file.name) ? "סוג הקובץ הזה לא נתמך — העלו PDF, Word (‎.docx) או תמונה" : "";
    if (unsupported) { entry.error = unsupported; continue; }
    try {
      const drafts = await pdfToSongs(file);
      if (drafts === null) entry.error = "לא נמצא בקובץ טקסט, גם לא בזיהוי טקסט מהתמונה";
      else if (!drafts.length) entry.error = "לא נמצאו שירים בקובץ";
      else {
        entry.warnings = importChecks(drafts, pdfToSongs.pages || 1, pdfToSongs.book);
        if (pdfToSongs.ocr) entry.warnings.unshift("נקרא מתמונה בזיהוי טקסט: כדאי לעבור על המילים והאקורדים ולתקן בעריכה.");
        Object.assign(entry, await saveImported(drafts, file.name));
        if (entry.failed) entry.warnings.push("חלק מהשירים לא נשמרו (אין הרשאה, או בעיה בחיבור).");
      }
    } catch (err) { console.error(err); entry.error = "קריאת הקובץ נכשלה (הקובץ פגום, או שזה לא PDF / Word / תמונה)"; }
    renderSongs(); // the report grows file by file
  }
  songsState.importing = false;
  await loadSongs();
  songsState.view = "list";
  renderSongs();
  const bad = songsState.report.filter((f) => f.error || f.warnings.length).length;
  toast(bad ? `הייבוא הסתיים · ${bad} ${bad === 1 ? "קובץ דורש" : "קבצים דורשים"} בדיקה` : "הייבוא הסתיים ✓", bad ? { error: true } : undefined);
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
      <label class="btn ghost file-btn">ייבוא שירים (PDF / Word / תמונה)<input type="file" accept="application/pdf,image/*,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" id="pdf-file" multiple hidden></label>
    </div>
    ${songsState.importing ? `<p class="status">קורא ${songsState.report?.length ? `את ${esc(songsState.report[songsState.report.length - 1].name)}` : "את הקובץ"}…</p>` : ""}
    ${importReportHtml()}
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

// the file a song was imported from ("Wb.pdf#267" → "Wb.pdf · 267"); typed-in songs show nothing
const sourceOf = (s) => { if (!s.source) return ""; const [f, n] = s.source.split("#"); return n ? `${f} · ${n}` : f; };
const sourceHtml = (s) => s.source ? `<small class="song-src" dir="auto">📄 ${esc(sourceOf(s))}</small>` : "";
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
    .slice(0, 50).map((s) => `<button class="idx-song" data-song="${s.id}">${esc(s.title)}${sameName(s) ? `<small class="first-line"> · ${esc(firstLine(s))}</small>` : ""}${sourceHtml(s)}</button>`).join("")}</div>`;
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
  const key = baseKey ? transposeChord(baseKey, shift, prefersFlats(baseKey, shift)) : null;
  el.innerHTML = `<div class="song-view${songsState.present ? " present" : ""}" style="--song-scale:${songScale}">
    <div class="song-top">
      <button class="link-btn no-print" data-song-back>→ לכל השירים</button>
      <h2 class="song-title">${esc(s.title)}</h2>${s.source ? `<p class="song-src-line no-print">📄 מהקובץ <b dir="auto">${esc(sourceOf(s))}</b></p>` : ""}
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
    <div class="chordpro song-body">${renderChordPro(s.content, shift, { chords: !songsState.present || songsState.presentChords, key: baseKey })}</div>
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
    const fl = prefersFlats(cur.song_key || firstChord(cur.content), n);
    const content = cur.content.replace(/\[([^\]]+)\]/g, (_, c) => `[${transposeChord(c, n, fl)}]`);
    const row = { content, song_key: cur.song_key ? transposeChord(cur.song_key, n, fl) : firstChord(content), updated_at: new Date().toISOString() };
    const { error } = await sb.from("songs").update(row).eq("id", cur.id);
    if (error) { toast("השמירה נכשלה"); return; }
    Object.assign(cur, row); songsState.shift = 0; toast("השיר נשמר בסולם החדש"); renderSongs(); return;
  }
  if (t.closest("[data-report-close]")) { songsState.report = []; renderSongs(); return; }
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
  if (t.id === "pdf-file" && t.files.length) { const files = [...t.files]; t.value = ""; await importFiles(files); return; }
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
