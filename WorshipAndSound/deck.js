// The presentation's running order and its changing text — shared by the PowerPoint export (setlist.js buildPptx)
// and the projection screen (screen.js), so both show the same slides in the same order.
// Uses meetingKind (schedule.js) and songMeta (chords.js); meetingLines takes the meetings (state.meetings on the site,
// loadMeetings() on the screen).

// the order: welcome, blank, every song with a blank after it, the communion slide, the last song, then the tail.
// A {screen: quiet} item in the set (סעודת האדון, added from the session dialog) puts the communion slide exactly
// there; without one, communion comes before the last song, as the template always did.
function deckPlan(items, contentOf) {
  const quiet = (it) => (songMeta(contentOf(it) || "").screen || "").toLowerCase() === "quiet";
  const hasQuiet = items.some(quiet);
  const plan = [{ tpl: "welcome" }, { tpl: "blank" }];
  items.forEach((it, i) => {
    if (quiet(it)) { plan.push({ tpl: "communion", item: it }); return; }
    if (!hasQuiet && i === items.length - 1) plan.push({ tpl: "communion" });
    plan.push({ song: it });
    if (i < items.length - 1) plan.push({ tpl: "blank" });
  });
  plan.push({ tpl: "blessing" }, { tpl: "testimonies" }, { tpl: "groups" }, { tpl: "meetings" });
  return plan;
}

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
    if (name !== month) { if (month) out.push(""); out.push(`${name}:`); month = name; }
    const kind = meetingKind(m);
    const extra = kind !== "אסיפה" && !kind.startsWith("יום ") ? kind : /בפטיסט/.test(m.place) ? "צ'אפל" : (m.notes || "");
    out.push(`\t${m.dateText.slice(0, 5)} ${m.place}${extra ? ` | ${extra}` : ""}`);
  }
  return out;
}
