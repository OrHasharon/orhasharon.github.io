// Chord sheets (ChordPro "[Am]lyrics"): detect, transpose, clean niqqud, render. Pure functions shared by
// index.html (songs.js / setlist.js) and the guest page live.html. Uses esc() from the page.

const CHORD_RE = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M)?\d*(?:(?:sus|add|maj|b|#|-|\+)\d+)*(?:\/[A-Ga-g][#b]?)?$/;
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

function renderChordPro(content, shift = 0, { chords = true, key } = {}) {
  const flats = shift ? prefersFlats(key || songMeta(content).key || firstChord(content), shift) : undefined;
  const songDir = HEB.test(content) ? "rtl" : "ltr";
  return content.split("\n").map((raw) => {
    const line = /^\s*\{.*\}\s*$/.test(raw) ? raw : fixNiqqudLine(raw);
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
      const row = cleanStr(line).replace(/\S+/g, (tok) => (CHORD_RE.test(tok) ? transposeChord(tok, shift, flats) : tok));
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
const cleanStr = (t) => (t || "").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").replace(/[\u00A0\u2000-\u200A\u202F]/g, " ");

// ---------- lyrics → slides (PowerPoint + projection screen) ----------
// stanzas of clean lyric lines, each tagged with its section label ({פזמון}) if any
function lyricStanzas(content) {
  const stanzas = [{ label: "", lines: [] }];
  for (const raw of content.split("\n")) {
    const t = raw.trim();
    if (/^\{\s*(capo|artist|key|screen)\s*:/i.test(t)) continue;
    const label = t.match(/^\{(.+)\}$/);
    if (label) { if (stanzas[stanzas.length - 1].lines.length) stanzas.push({ label: "", lines: [] }); stanzas[stanzas.length - 1].label = label[1]; continue; }
    const line = fixNiqqudLine(raw).replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
    if (!line) { if (stanzas[stanzas.length - 1].lines.length) stanzas.push({ label: "", lines: [] }); continue; }
    if (!/[\u05D0-\u05EAa-zA-Z]{2}/.test(line.replace(/[\u0591-\u05C7]/g, ""))) continue; // chord-only rows (niqqud ignored)
    stanzas[stanzas.length - 1].lines.push(line);
  }
  return stanzas.filter((s) => s.lines.length);
}

// split a stanza into slides of at most 4 lines, as evenly as possible (5 -> 3+2, not 4+1)
function chunks(lines, max = 4) {
  const n = Math.ceil(lines.length / max), size = Math.ceil(lines.length / n), out = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}
