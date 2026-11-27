// Chord sheets (ChordPro "[Am]lyrics"): detect, transpose, clean niqqud, render. Pure functions shared by
// index.html (songs.js / setlist.js) and the guest page live.html. Uses esc() from the page.

const CHORD_RE = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:(?:sus|add|maj|b|#|-|\+)\d+)*(?:\/\d+)?(?:\/[A-Ga-g][#b]?)?$/; // "A4/7" = sus4 then 7
const FILLER_RE = /^(?:\||\/|-|–|x\d+|\(|\)|\.+)$/i;
const isChordLine = (text) => {
  const toks = text.trim().split(/\s+/).map((t) => (/^[()]?[A-G]/.test(t) ? t.replace(/^[()]+|[()]+$/g, "") : t)).filter(Boolean);
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
// flats = true/false from the song's key (prefersFlats); left out = as the chord itself is spelled (the old way)
function transposeChord(ch, shift, flats) {
  if (!shift) return ch;
  const m = ch.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  if (!m) return ch;
  if (flats === undefined) flats = ch.includes("b");
  return transposeNote(m[1], shift, flats) + m[2] + (m[3] ? "/" + transposeNote(m[3], shift, flats) : "");
}
// After moving a song by `shift`, is the new key a "flat" key? F Bb Eb Ab Db major, Dm Gm Cm Fm Bbm Ebm minor
// → spell Bb / Eb (not A# / D#); otherwise sharps. undefined = no key to go by.
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1]), FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);
function prefersFlats(key, shift) {
  const m = (key || "").match(/^([A-G][#b]?)(m(?!aj))?/);
  const i = m ? noteIndex(m[1]) : -1;
  if (i < 0) return undefined;
  return (m[2] ? FLAT_MINOR : FLAT_MAJOR).has((i + shift + 120) % 12);
}
const firstChord = (content) => (content.match(/\[([^\]]+)\]/) || [])[1] || null;

const HEB = /[֐-׿]/;

// Clean niqqud that the PDF put on the wrong letter (shows as ◌): marks with no letter, duplicate marks,
// and the shin/sin dot on a letter that isn't ש (moved to a nearby ש that lacks one, otherwise dropped).
// same, for a line with [chord] markers: fix the lyrics as one piece, then put each chord back before the same letter
function fixNiqqudLine(line) {
  // a word broken by an old import ("אֲדֹנֵינ וּ"): no Hebrew word ends in a non-final כ מ נ פ צ, so what follows
  // one ("וּ", "וֹשׁ") is the rest of that word — glue it back
  line = line.replace(/(?<=[א-ת][֑-ׇ]*)([כמנפצ][֑-ׇ]*) ([א-ת][֑-ׇא-ת]*)(?=(?:\[[^\]]*\])*(?:[\s,.;:!?\-()]|$))/g, "$1$2")
    // ("ע\"פ" and letters spelled out one by one, "כ ב ו ד", are left alone: the letter must close a word of 2+ letters)
    // a lone "וּ" / "וֹ" is never a word: it is the end of the word before it ("וַתְּחַסְּרֵה וּ")
    .replace(/([א-ת][֑-ׇ]*) (ו[ֹּ])(?=(?:\[[^\]]*\])*(?:[\s,.;:!?\-()]|$))/g, "$1$2");
  if (!line.includes("[")) return fixNiqqud(line);
  const MARK = /[֑-ׇ]/;
  const chords = []; let plain = "", bases = 0;
  for (const part of line.split(/(\[[^\]]*\])/)) {
    if (/^\[[^\]]*\]$/.test(part)) { chords.push({ at: bases, c: part }); continue; }
    plain += part; bases += [...part].filter((ch) => !MARK.test(ch)).length;
  }
  const fixed = fixNiqqud(plain);
  let out = "", n = 0, k = 0;
  for (const ch of fixed) {
    if (!MARK.test(ch)) { while (k < chords.length && chords[k].at === n) out += chords[k++].c; n++; }
    out += ch;
  }
  while (k < chords.length) out += chords[k++].c;
  return out;
}

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
// {screen: quiet} — on the projection screen this item is its title alone, on a quiet dark background (סעודת האדון)
const META_RE = /^\{\s*(capo|artist|key|screen)\s*:\s*(.*?)\s*\}$/i;
function songMeta(content) {
  const meta = {};
  for (const line of content.split("\n")) { const m = line.trim().match(META_RE); if (m) meta[m[1].toLowerCase()] = m[2]; }
  return meta;
}

// A key is shown as its major (Uriya: "there are no such keys" — Em is G, Dm is F, F#m is A, C#m is E): a minor key is
// named after its relative major, three semitones up. Only the label changes; the chords stay as they are.
const RELATIVE_MAJOR = { Am: "C", Em: "G", Bm: "D", "F#m": "A", "Gbm": "A", "C#m": "E", "Dbm": "E", "G#m": "B", "Abm": "B", "D#m": "F#", "Ebm": "Gb",
  "A#m": "C#", "Bbm": "Db", Dm: "F", Gm: "Bb", Cm: "Eb", Fm: "Ab" };
const keyName = (k) => { if (!k) return k; const m = String(k).trim().match(/^([A-G][#b]?m)(?!aj)/); return m && RELATIVE_MAJOR[m[1]] ? RELATIVE_MAJOR[m[1]] : k; };

// A song saved broken by an old import is SHOWN in its clean form (repairs.js), on every page and for everyone,
// whatever the database holds; the same for the chorus marks. Matched by the words + chords, so an edited song is shown
// as it is.
const repairSig = (t) => t.replace(/\[[^\]]*\]|\{[^}]*\}/g, "").replace(/[\s\u0591-\u05C7]/g, "") + "|" + [...t.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]).join(" ");
let repairMap = null, repairing = false;
function repaired(content) {
  if (repairing || typeof SONG_REPAIRS === "undefined" || !content || content.indexOf("\n") < 0) return content;
  if (!repairMap) {
    repairMap = new Map(SONG_REPAIRS.map((f) => [repairSig(f.content), f.content]));
    repairMap.marks = new Map((typeof CHORUS_SIGS !== "undefined" ? CHORUS_SIGS : []).map((m) => [m.sig, m.k]));
  }
  const s = repairSig(content);
  let out = repairMap.get(s) || content;
  const k = repairMap.marks.get(s);
  if (k != null && !/^\s*\{\s*(פזמון|chorus|refrain)/im.test(out)) {
    repairing = true;
    try { out = setChorus(out, k); } finally { repairing = false; }
  }
  return out;
}

function renderChordPro(content, shift = 0, { chords = true, key } = {}) {
  content = repaired(content);
  const flats = shift ? prefersFlats(key || songMeta(content).key || firstChord(content), shift) : undefined;
  const songDir = HEB.test(content) ? "rtl" : "ltr";
  return content.split("\n").map((raw) => {
    const line = /^\s*\{.*\}\s*$/.test(raw) ? raw : withVav(fixNiqqudLine(raw));
    const t = line.trim();
    if (!t) return `<div class="cp-line cp-empty"></div>`;
    if (META_RE.test(t)) return "";
    const note = t.match(/^\{\s*(?:c|comment)\s*:\s*(.*?)\s*\}$/i); // a note for the musicians ("או Em A"), not lyrics
    // a credit kept as a note ("אקורדים לפי עיבוד One For Israel 2024") is not for the screen
    if (note && /^(אקורדים|עיבוד|מילים|לחן|תרגום|ביצוע)|ע["״']י/.test(note[1].trim())) return "";
    if (note) return chords ? `<div class="cp-note" dir="auto">(${esc(note[1])})</div>` : "";
    const label = t.match(/^\{(.+)\}$/);
    if (label && /^בית\s*\d+$/.test(label[1].trim())) return ""; // a verse number from the import: no heading on screen
    if (label) return `<div class="cp-section" dir="auto">[${esc(label[1])}]</div>`;
    // "Gm [או Em A]": a chord with an alternative — a chord row, never "או Em A" as one chord over nothing
    const alt = line.match(/^\s*([A-G][#b]?[^\s\[\]()]*)\s*[\[(]\s*או\s+([^\])]+?)\s*[\])]\s*$/);
    if (alt && CHORD_RE.test(alt[1])) {
      if (!chords) return "";
      const tr = (s) => s.replace(/\S+/g, (tok) => (CHORD_RE.test(tok) ? transposeChord(tok, shift, flats) : tok));
      return `<div class="cp-line cp-bare-chords" dir="${songDir}">${esc(tr(alt[1]))} <span class="cp-note">(או ${esc(tr(alt[2]))})</span></div>`;
    }
    // [text with spaces or Hebrew] isn't a chord: show it as words in brackets
    if (/\[[^\]]*[\sא-ת][^\]]*\]/.test(line)) return renderChordPro(line.replace(/\[([^\]]*[\sא-ת][^\]]*)\]/g, "($1)"), shift, { chords, key });
    // direction comes from the lyrics, not the (Latin) chords
    const lyricsOnly = line.replace(/\[[^\]]*\]/g, "");
    const dir = HEB.test(lyricsOnly) ? "rtl" : "ltr";
    if (!line.includes("[") && isChordLine(chordStr(line))) {
      if (!chords) return "";
      const row = chordStr(line).replace(/\S+/g, (tok) => (CHORD_RE.test(tok) ? transposeChord(tok, shift, flats) : tok));
      return `<div class="cp-line cp-bare-chords" dir="${songDir}">${esc(row)}</div>`;
    }
    if (!line.includes("[")) return `<div class="cp-line" dir="${dir}">${esc(fixNiqqud(line))}</div>`;
    if (!chords) return lyricsOnly.trim() ? `<div class="cp-line" dir="${dir}">${esc(fixNiqqud(lyricsOnly))}</div>` : "";
    const parts = line.split(/\[([^\]]*)\]/); // text, chord, text, chord, ...
    const segs = [{ ch: "", ly: parts[0] || "" }];
    for (let k = 1; k < parts.length; k += 2) segs.push({ ch: transposeChord(parts[k], shift, flats), ly: parts[k + 1] || "" });
    // group the pieces into whole words, so a long line wraps between words and never inside one
    const words = [];
    let cur = [];
    for (const sg of segs) {
      if (!sg.ly && !sg.ch) continue;
      const pieces = sg.ly ? sg.ly.split(/(?<=\s)/) : [""];
      pieces.forEach((pc, n) => {
        cur.push({ ch: n ? "" : sg.ch, ly: pc });
        if (/\s$/.test(pc)) { words.push(cur); cur = []; }
      });
    }
    if (cur.length) words.push(cur);
    const html = words.map((w) => `<span class="w">${w.map((sg) =>
      `<span class="seg"><span class="ch">${esc(sg.ch)}</span><span class="ly">${sg.ly ? esc(sg.ly) : "&nbsp;"}</span></span>`).join("")}</span>`).join("");
    return `<div class="cp-line${lyricsOnly.trim() ? "" : " cp-chords-only"}" dir="${dir}">${html}</div>`;
  }).join("");
}

// strip invisible direction marks / odd spaces that PDFs leave in
// a song's title as shown on its page, the screen, slides and the PDF: without the bracket that only tells apart songs with
// the same name in search ("אדני אדונינו (יהוה אדנינו מה אדיר שמך)" -> "אדני אדונינו")
// "אדני" is shown as "אדוני" (Uriya), in lyrics, slides and titles — the saved song stays as it is. With niqqud the
// holam moves onto the new vav (אֲדֹנָי → אֲדוֹנָי); a prefix (ו ב ל מ ה ש כ) and a chord inside the word are kept.
const ADONAI_RE = new RegExp(
  "(?<![\\u05D0-\\u05EA\\u0591-\\u05C7])((?:[ובלמהשכ][\\u0591-\\u05C7]*)?א[\\u0591-\\u05C7]*(?:\\[[^\\]]*\\])?)ד([\\u0591-\\u05C7]*)((?:\\[[^\\]]*\\])?)(נ[\\u0591-\\u05C7]*(?:\\[[^\\]]*\\])?י[\\u0591-\\u05C7]*)(?![\\u05D0-\\u05EA\\u0591-\\u05C7])", "g");
const withVav = (t) => (t || "").replace(ADONAI_RE, (m, pre, dm, ch, rest) => pre + "ד" + dm.replace("\u05B9", "") + "ו" + (dm.includes("\u05B9") ? "\u05B9" : "") + ch + rest);
const showTitle = (t) => withVav((t || "").replace(/\s*\([^()]*\)\s*$/, "").trim() || t || "");
const cleanStr = (t) => (t || "").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").replace(/[\u00A0\u2000-\u200A\u202F]/g, " ");
// a chord row as a PDF or Word file may store it: fraction / division slashes ("A4⁄7"), small or full-width digits
// and letters, invisible marks, "A4 / 7" with spaces — made plain before deciding whether the row is chords
const chordStr = (t) => cleanStr(t).normalize("NFKC").replace(/[⁄∕⧸／]/g, "/").replace(/\p{Cf}/gu, "")
  .replace(/([A-G][^\s/]*)\s+\/\s+(\d)/g, "$1/$2");

// ---------- lyrics → slides (PowerPoint + projection screen) ----------
// lines that are never lyrics on a slide: credits and settings ("מילים ולחן: …", "נכתב ע״י …", "מפתח: E | קצב: 127bpm"),
// a section mark written as text ("פזמון X2", "בית א'", "גשר:", "סולו"), and a row of chords only ("Gm", "Bm | / / / D")
const SECTION_TEXT = /^(פזמון|פזמון\s*[אב]['׳]?|בית(\s*[א-ת0-9]['׳]?)?|גשר|מעבר|סיום|פתיחה|הקדמה|קודה|סולו|פרי\s*קורוס|אינטרו|intro|outro|chorus|pre-?chorus|verse(\s*\d+)?|bridge|tag|ending)\s*[:.]?$/i;
const CREDITS = /^(מילים|לחן|מילים\s*ולחן|מילים\s*ו?לחן|נכתב|כתב|תרגום|עיבוד|ביצוע|מבצע|מפתח|סולם|קצב|מפעם|טמפו|key|capo|tempo|words|music|lyrics|written)(?=[\s:,.\-–]|$)|ע["״']י|bpm|קאפו\s*\d|capo\s*\d/i; // (\b doesn't work with Hebrew letters)
function isSlideLine(line) {
  const t = chordStr(line.replace(/[֑-ׇ]/g, "")).trim();
  if (SECTION_TEXT.test(t) || CREDITS.test(t)) return false;
  const toks = t.split(/\s+/).filter((w) => !/^[|/\\\-–—.:,()]+$/.test(w));
  if (toks.length && toks.every((w) => CHORD_RE.test(w.replace(/[()|,]/g, "")) || /^או$/.test(w))) return false; // "Gm", "A | D"
  // a chord row the songbook wrote loosely ("C#m/Bm E/D", "C4#", "Em(D)G"): no Hebrew, every word starts with a chord letter
  if (!/[א-ת]/.test(t) && toks.length && toks.every((w) => /^\(?[A-G][A-Za-z0-9#b/()+\-]*$/.test(w))) return false;
  return true;
}

// stanzas of clean lyric lines, each tagged with its section label ({פזמון}) if any
function lyricStanzas(content) {
  content = repaired(content);
  const stanzas = [{ label: "", lines: [] }];
  for (const raw0 of content.split("\n")) {
    const raw = /^\s*\{.*\}\s*$/.test(raw0) ? raw0 : withVav(raw0);
    const t = raw.trim();
    if (/^\{\s*(capo|artist|key|screen|c|comment)\s*:/i.test(t)) continue; // settings and notes are not on the slides
    const label = t.match(/^\{(.+)\}$/);
    if (label) { if (stanzas[stanzas.length - 1].lines.length) stanzas.push({ label: "", lines: [] }); stanzas[stanzas.length - 1].label = label[1]; continue; }
    // repeat marks ("X2", "2X", "(x3)", "\u00D72") are for the band, not for the screen
    const noChords = fixNiqqudLine(raw).replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
    const line = noChords.replace(/\(?\s*(?:[xX\u00D7]\s*\d|\d\s*[xX\u00D7])\s*\)?/g, "").replace(/\s{2,}/g, " ").trim();
    const repeated = line !== noChords;
    if (!line) { if (stanzas[stanzas.length - 1].lines.length) stanzas.push({ label: "", lines: [] }); continue; }
    if (!/[\u05D0-\u05EAa-zA-Z]{2}/.test(line.replace(/[\u0591-\u05C7]/g, ""))) continue; // chord-only rows (niqqud ignored)
    if (!isSlideLine(line)) {
      // a section mark written as text ("\u05E4\u05D6\u05DE\u05D5\u05DF X2", "\u05D1\u05D9\u05EA \u05D1'", "\u05D2\u05E9\u05E8:") still separates the sections
      // and names the next one (so a "\u05E4\u05D6\u05DE\u05D5\u05DF" mark tells which section is the chorus)
      const mark = line.replace(/[\u0591-\u05C7]/g, "").trim();
      if (SECTION_TEXT.test(mark)) {
        if (stanzas[stanzas.length - 1].lines.length) stanzas.push({ label: "", lines: [] });
        stanzas[stanzas.length - 1].label = mark.replace(/[:.]$/, "");
      }
      continue;
    }
    if (repeated) stanzas[stanzas.length - 1].repeat = true;
    stanzas[stanzas.length - 1].lines.push(line);
  }
  return stanzas.filter((s) => s.lines.length);
}

// sections for the slides: one-line sections in a row are one chorus written with a blank line between its lines
// ("אהלל אותך לנצח" / "אהלל ואשבח") — join them (up to 4 lines) so the chorus isn't split into one-line slides
function slideStanzas(content, title = "") {
  const out = [];
  for (const st of lyricStanzas(content)) {
    const last = out[out.length - 1];
    if (last && st.lines.length === 1 && !st.label && last.single && last.lines.length < 4) { last.lines.push(st.lines[0]); last.repeat ||= st.repeat; continue; }
    out.push({ ...st, lines: [...st.lines], single: st.lines.length === 1 });
  }
  // on the slides a line never ends with a comma (Uriya) — an ellipsis stays
  for (const st of out) st.lines = st.lines.map((l) => l.replace(/(?<!\.)[,;.،]\s*$/, ""));
  return withChorus(out, title);
}

// On the slides the chorus comes back after every verse, even when the songbook writes it only once.
// Which section is the chorus: one labeled {פזמון} / "פזמון" / {chorus}; else the one section that holds the song's
// title ("אדוני אדוננו", "הללויה כי מלך אלוהנו"); else a first section marked to be sung twice (X2).
// A song that already writes its chorus out again is left as it is.
const CHORUS_LABEL = /^(פזמון|chorus|refrain)/i;
const looseText = (t) => t.replace(/\([^)]*\)/g, " ").replace(/[֑-ׇ]/g, "")
  .replace(/[ךםןףץ]/g, (c) => "כמנפצ"["ךםןףץ".indexOf(c)]).replace(/[וי]/g, "") // spelling: אדני = אדוני, אלהינו = אלוהנו
  .replace(/[^א-תa-zA-Z0-9]+/g, " ").toLowerCase().trim();
function chorusIndex(st, title) {
  const labeled = st.findIndex((x) => CHORUS_LABEL.test((x.label || "").trim()));
  if (labeled >= 0) return labeled;
  if (st.some((x) => (x.label || "").trim())) return -1; // the sections are named and none of them is a chorus
  const t = looseText(title || "");
  if (t.replace(/ /g, "").length >= 6) {
    const hits = st.map((x, i) => (looseText(x.lines.join(" ")).includes(t) ? i : -1)).filter((i) => i >= 0);
    // a hymn named after its first verse ("על גבעה רחוקה", "רק בישוע תקוותי"): all sections the same length, none marked
    // to repeat — that first section is a verse, not a chorus
    const hymn = st.length >= 3 && st[0].lines.length >= 3 && st.every((x) => x.lines.length === st[0].lines.length && !x.repeat);
    if (hits.length === 1) return hits[0] === 0 && hymn ? -1 : hits[0];
    if (hits.length > 1) return -1;
  }
  return st[0]?.repeat && st.length >= 3 ? 0 : -1;
}
// The song's sections as the song page lists them, each with the line index where it starts in the text.
function songSections(content) {
  const raw = content.split("\n"), st = lyricStanzas(content), out = [];
  let j = 0;
  for (const s of st) {
    while (j < raw.length && (lyricStanzas(raw[j])[0]?.lines[0] || null) !== s.lines[0]) j++;
    if (j >= raw.length) break;
    out.push({ first: s.lines[0], line: j, chorus: CHORUS_LABEL.test((s.label || "").trim()) });
    j++;
  }
  return out;
}
function setChorus(content, k) {
  const keep = content.split("\n").filter((l) => !/^\s*\{\s*(פזמון|chorus|refrain)[^}]*\}\s*$/i.test(l)).join("\n");
  if (k < 0) return keep;
  const sec = songSections(keep)[k];
  if (!sec) return keep;
  const lines = keep.split("\n");
  lines.splice(sec.line, 0, "{פזמון}");
  return lines.join("\n");
}

function withChorus(st, title) {
  if (st.length < 2) return st;
  const c = chorusIndex(st, title);
  if (c < 0) return st;
  const key = (x) => looseText(x.lines.join(" ")), ck = key(st[c]);
  if (st.some((x, i) => i !== c && key(x) === ck)) return st; // the chorus is already written out again
  // a bridge / ending written in parts (a blank line between them, only the first labeled) is one unit: the chorus
  // comes after its last part, not between the parts
  const TAIL = /^(גשר|מעבר|סיום|קודה|bridge|tag|ending|outro)/i;
  let inTail = false;
  const tail = st.map((x) => { const l = (x.label || "").trim(); inTail = l ? TAIL.test(l) : inTail; return inTail; });
  const out = [];
  st.forEach((x, i) => {
    out.push(x);
    const nextContinues = tail[i] && i + 1 < st.length && tail[i + 1] && !(st[i + 1].label || "").trim();
    // after the chorus's first place only: what comes before it is sung as written (Uriya: "מה אשיב", "בואו ונשוב")
    if (i > c && !nextContinues) out.push({ ...st[c], lines: [...st[c].lines], again: true });
  });
  return out;
}

// split a stanza into slides of at most 4 lines, as evenly as possible (5 -> 3+2, not 4+1)
function chunks(lines, max = 4) {
  const n = Math.ceil(lines.length / max), size = Math.ceil(lines.length / n), out = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}
