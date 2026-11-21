// The presentation's running order and its changing text — shared by the PowerPoint export (setlist.js buildPptx)
// and the projection screen (screen.js), so both show the same slides in the same order.
// Uses meetingKind (schedule.js) and songMeta (chords.js); meetingLines takes the meetings (state.meetings on the site,
// loadMeetings() on the screen).

// The service order (from the 31.10.2026 presentation): welcome, opening verse, the songs (each followed by a blank),
// the Lord's Supper + its verse, the song(s) after it, the weekly reading, the children's blessing, the sermon,
// testimonies, prayer requests, home groups, next meetings, tithes and offerings, closing.
// {weekly: …} = the week's own words (opening verse, parasha + reading, prayer requests), typed on the projection
// computer (screen.js "שקופיות השבוע"); slides with nothing typed are skipped. The PowerPoint download skips them. The set decides which songs go before / after the Supper: a
// {screen: quiet} item (סעודת האדון, added from the session dialog) marks the spot; without one, the last song comes
// after it. {sermon: true} is where the preacher's PDF goes on the projection screen (screen.js); the PowerPoint
// download has only the "דרשה" slide there.
function deckPlan(items, contentOf) {
  const quiet = (it) => (songMeta(contentOf(it) || "").screen || "").toLowerCase() === "quiet";
  const q = items.findIndex(quiet);
  const before = q >= 0 ? items.slice(0, q) : items.slice(0, Math.max(0, items.length - 1));
  const after = q >= 0 ? items.slice(q + 1) : items.slice(-1);
  // the order of Uriya's own edit of the 21.11 deck: blank slides only between songs (and after the last song before
  // the Supper); the Supper picture, its verses, the Supper picture again; the fixed "פרשת השבוע" slide before the parasha;
  // no blanks around the parasha, the blessing or the sermon
  const plan = [{ tpl: "welcome" }, { weekly: "verse" }, { tpl: "blank" }];
  before.forEach((it) => plan.push({ song: it }, { tpl: "blank" }));
  plan.push({ tpl: "communion", item: q >= 0 ? items[q] : undefined }, { tpl: "communion_verse" }, { tpl: "communion", again: true });
  after.forEach((it, k) => { if (k) plan.push({ tpl: "blank" }); plan.push({ song: it }); });
  plan.push({ tpl: "parasha_title" }, { weekly: "parasha" }, { weekly: "reading" }, { tpl: "blessing" }, { tpl: "sermon_title" },
    { sermon: true }, { tpl: "testimonies" }, { weekly: "prayers" }, { tpl: "groups" }, { tpl: "meetings" },
    { tpl: "tithes" }, { tpl: "closing" });
  return plan;
}

// The lyrics' size on a song slide (the template's box: 876pt wide, 356pt high): up to 44 (54 was too crowded). A long line
// wraps onto a second row (the box wraps) instead of shrinking every line; the size goes down only when the rows
// don't fit the box's height. ~0.5em per letter (niqqud takes no room). Shared by the PowerPoint and the screen.
function lyricFontSize(lines, { width = 876, height = 356, max = 44, min = 30, gap = 8 } = {}) {
  for (let s = max; s > min; s -= 2) {
    const perRow = width / (0.5 * s);
    const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.replace(/[\u0591-\u05C7]/g, "").length / perRow)), 0);
    if (rows * s * 1.2 + Math.max(0, lines.length - 1) * gap <= height) return s;
  }
  return min;
}
// The Lord's Supper verse (Uriya's example): the verses with their numbers ("9 הֵן"; Uriya: without them you can't follow),
// big, right-aligned across the slide, a long passage over several slides; the source small at the top left, no brackets.
// The reading slide's body: 800pt wide, 398pt high.
const SUPPER_SIZE = 36;
function supperSlides(verse, ref) {
  const text = (verse || "").replace(/(^|[\s;:.,(])(\d{1,3})(?=[\u05D0-\u05EA])/g, "$1$2 ").replace(/[ \t]{2,}/g, " ").trim();
  const plain = text.replace(/[\u0591-\u05C7]/g, "");
  const perRow = 800 / (0.5 * SUPPER_SIZE), rows = Math.floor(398 / (SUPPER_SIZE * 1.4));
  const max = Math.floor(perRow * rows * 0.8 * (text.length / Math.max(1, plain.length)));
  // the source as Uriya wrote it on his slide: "קולוסים ב 9-15" — no brackets, no colon
  return { pages: readingPages(text, max), ref: (ref || "").trim().replace(/^\(\s*|\s*\)$/g, "").replace(/\s*:\s*/g, " "), size: SUPPER_SIZE };
}

// a song slide's lines and size: a line too long for one row at that size is cut at the comma nearest its middle
// ("בניסיון להביט על חיי מעיניו," / "לזכור שהכל לטובת אוהביו"), so it doesn't wrap at a random word
const endClean = (l) => l.replace(/(?<!\.)[,;.،]\s*$/, ""); // songs: no comma at the end of a line (an ellipsis stays)
function lyricLayout(lines) {
  const len = (l) => l.replace(/[\u0591-\u05C7]/g, "").length;
  let size = lyricFontSize(lines);
  const perRow = 876 / (0.5 * size);
  const out = lines.flatMap((l) => {
    if (len(l) <= perRow) return [l];
    const cuts = [...l.matchAll(/[,;:.]\s+/g)].map((m) => m.index + 1);
    if (!cuts.length) return [l];
    const mid = l.length / 2, at = cuts.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
    return [l.slice(0, at).trim(), l.slice(at).trim()].filter(Boolean);
  });
  if (out.length !== lines.length) size = lyricFontSize(out);
  return { lines: out.map(endClean), size };
}

// does a .pptx open with a slide whose whole text matches re (niqqud and spaces ignored)?
// (shared: the PowerPoint download and the projection screen; needs JSZip)
async function firstSlideIs(buf, re) {
  const z = await JSZip.loadAsync(buf);
  const pres = await z.file("ppt/presentation.xml").async("string"), rels = await z.file("ppt/_rels/presentation.xml.rels").async("string");
  const rid = (pres.match(/<p:sldId\b[^>]*r:id="([^"]+)"/) || [])[1];
  const rel = rid && [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`));
  const target = rel && (rel.match(/Target="([^"]+)"/) || [])[1];
  if (!target) return false;
  const xml = await z.file("ppt/" + target.replace(/^\/?(ppt\/)?/, ""))?.async("string");
  const text = [...(xml || "").matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("").replace(/[֑-ׇ\s‎‏]/g, "");
  return re.test(text);
}

// An empty slide in the speaker's deck (Uriya: "slides with nothing on them — leave them out"): no text, no picture,
// no table/chart/video, no drawn shape — only empty placeholders (invisible in the slide show). A slide with a picture
// or a coloured shape is kept.
function isEmptySlideXml(xml) {
  const tree = (xml.match(/<p:spTree>([\s\S]*)<\/p:spTree>/) || [])[1] || "";
  if (/<a:t>[^<]*\S[^<]*<\/a:t>/.test(tree)) return false;                       // text
  if (/<p:(pic|graphicFrame|cxnSp|grpSp|contentPart)\b|<a:blip\b|<p14:media|videoFile|audioFile/.test(tree)) return false;
  for (const sp of tree.match(/<p:sp\b[\s\S]*?<\/p:sp>/g) || []) {
    if (!/<p:ph\b/.test(sp)) return false;                                          // a drawn shape (not a placeholder)
    if (/<p:spPr\b[\s\S]*?<a:(solidFill|gradFill|blipFill|pattFill)\b[\s\S]*?<\/p:spPr>/.test(sp)) return false; // a filled box
  }
  return true;
}
// which slides of a .pptx (by their order in the deck) are empty
async function emptySlideIndexes(buf) {
  const z = await JSZip.loadAsync(buf);
  const pres = await z.file("ppt/presentation.xml").async("string"), rels = await z.file("ppt/_rels/presentation.xml.rels").async("string");
  const ids = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
  const out = new Set();
  for (let i = 0; i < ids.length; i++) {
    const tag = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${ids[i]}"`));
    const target = tag && (tag.match(/Target="([^"]+)"/) || [])[1];
    const xml = target && (await z.file("ppt/" + target.replace(/^\/?(ppt\/)?/, ""))?.async("string"));
    if (xml && isEmptySlideXml(xml)) out.add(i);
  }
  return out;
}

// The week's parasha as the site stores it (meeting_texts): parasha_refs = "תורה: …" / "הפטרה: …" / "ברית חדשה: …"
// lines; the verses to show = reading, a JSON list of passages [{ref, text}] (older rows: reading_ref + plain text).
const REF_LABELS = { torah: "תורה", haftara: "הפטרה", brit: "ברית חדשה" };
function parashaRefs(row) {
  const out = { torah: "", haftara: "", brit: "" };
  for (const line of (row?.parasha_refs || "").split(/\r?\n/)) {
    const k = Object.keys(REF_LABELS).find((x) => line.startsWith(REF_LABELS[x] + ":"));
    if (k) out[k] = line.slice(REF_LABELS[k].length + 1).trim(); else if (line.trim() && !out.torah) out.torah = line.trim();
  }
  return out;
}
function passagesOf(row) {
  const r = (row?.reading || "").trim();
  if (r.startsWith("[")) { try { return JSON.parse(r).filter((p) => (p.text || "").trim() || (p.ref || "").trim()); } catch {} }
  return r || (row?.reading_ref || "").trim() ? [{ ref: row.reading_ref || "", text: r }] : [];
}

// a long reading → slides of about 420 letters, cut between lines, or between sentences inside a long line
// (the PowerPoint download; screen.js has the same rule)
function readingPages(text, max = 420) {
  const parts = [];
  for (const line of (text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
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

// home groups as the template shows them: the city, then "ימי שני ב 20:30. לפרטים: …", a blank line between
const serviceGroupLines = () => homeGroupLines();

// home groups straight from the community site's front page
async function homeGroupLines() {
  const html = await fetch("../index.html", { cache: "no-cache" }).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  doc.querySelectorAll(".groups .group").forEach((g, n) => {
    const city = g.querySelector("strong")?.textContent.trim() || "";
    const small = g.querySelector("small")?.textContent.replace(/^[\s·]+/, "").trim() || "";
    let when = g.textContent.replace(city, "").replace(g.querySelector("small")?.textContent || "", "").replace(/[·]/g, " ").replace(/\s+/g, " ").trim();
    when = when.replace(/(\d{1,2}:\d{2})/, "ב $1");
    if (n) out.push("");
    out.push(city, `${when}${small ? `. ${small}` : ""}`);
  });
  return out;
}

// next meetings after this session: this month and the next, like the template
function meetingLines(iso, meetings = typeof state !== "undefined" ? state.meetings : []) {
  const after = meetings.filter((m) => m.iso > iso);
  if (!after.length) return [];
  const first = after[0].date, months = new Set([first.getMonth(), (first.getMonth() + 1) % 12]);
  const list = after.filter((m) => months.has(m.date.getMonth()) && (m.date - first) < 70 * 864e5);
  const out = [];
  let month = null;
  for (const m of list) {
    const name = m.date.toLocaleDateString("he-IL", { month: "long" });
    // like the template (14.11.2026 look): "נובמבר:", then "	21/11 כפר הבפטיסטים | צ'אפל", a blank line between months
    if (name !== month) { if (month) out.push(""); out.push(`${name}:`); month = name; }
    const kind = meetingKind(m);
    const extra = kind !== "אסיפה" && !kind.startsWith("יום ") ? kind : /בפטיסט/.test(m.place) ? "צ'אפל" : (m.notes || "");
    out.push(`	${m.dateText.slice(0, 5)} ${m.place}${extra ? ` | ${extra}` : ""}`);
  }
  return out;
}
