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
  const plan = [{ tpl: "welcome" }, { weekly: "verse" }, { tpl: "blank" }];
  const songs = (list) => list.forEach((it) => plan.push({ song: it }, { tpl: "blank" }));
  songs(before);
  plan.push({ tpl: "communion", item: q >= 0 ? items[q] : undefined }, { tpl: "blank" }, { tpl: "communion_verse" }, { tpl: "blank" });
  songs(after);
  plan.push({ weekly: "parasha" }, { weekly: "reading" }, { tpl: "blessing" }, { tpl: "blank" }, { tpl: "sermon_title" },
    { sermon: true }, { tpl: "blank" }, { tpl: "testimonies" }, { weekly: "prayers" }, { tpl: "groups" }, { tpl: "meetings" },
    { tpl: "tithes" }, { tpl: "closing" });
  return plan;
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
