// Meeting schedule shared by the main site and WorshipAndSound/.
// Read live from the community's published Google Sheet, with data/duty.json filling gaps.
const SCHEDULE_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRkDNJ_HFYdjU4gqQ7gXajrO01CdF6pHFeaY_aC_Jn2GO3WUvIca15GhM7J6nHx5dl0vMCYLkm5U_3v/pub?gid=211949928&single=true&output=csv";
const DUTY_JSON = new URL("data/duty.json", document.currentScript.src).href;
const SATURDAY_TIMES = "התאספות 10:40 · פתיחה בהלל 11:00";

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}

// takes a meeting (its own "kind" from duty.json wins, e.g. "מסיבת חנוכה") or just the day name
function meetingKind(m) {
  if (m && m.kind) return m.kind;
  const day = typeof m === "string" ? m : m.day;
  if (day.includes("שבת")) return "אסיפה";
  if (day.includes("שישי")) return "קבלת שבת";
  return `יום ${day}`;
}

// a meeting stays "next" until it's over: Saturday ends ~13:00, anything else at the end of its day
function meetingEnd(m) {
  const end = new Date(m.date);
  if (meetingKind(m) === "אסיפה") end.setHours(13, 0, 0, 0);
  else end.setHours(23, 59, 59, 999);
  return end;
}

function parseSheet(text) {
  // columns: תורנות, הערות, מקום, תאריך (dd/mm/yy), יום
  return parseCsv(text).map(([duty = "", notes = "", place = "", dateText = "", day = ""]) => {
    const m = dateText.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return null;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return { duty: duty.trim(), notes: notes.trim(), place: place.trim(), day: day.trim(), date: new Date(y, m[2] - 1, m[1]) };
  }).filter(Boolean);
}

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// duty.json (the latest table Uriya sent) wins over the sheet for place, duty and notes, and adds later dates
function mergeMeetings(sheet, roster) {
  const byDate = new Map(sheet.map((m) => [isoDate(m.date), m]));
  for (const r of roster) {
    const [y, mo, d] = r.date.split("-").map(Number);
    const date = new Date(y, mo - 1, d);
    const m = byDate.get(isoDate(date));
    if (m) { if (r.duty) m.duty = r.duty; if (r.place) m.place = r.place; if (r.notes !== undefined) m.notes = r.notes; if (r.kind) m.kind = r.kind; }
    else byDate.set(isoDate(date), { duty: r.duty, notes: r.notes || "", place: r.place, day: r.day, kind: r.kind, date });
  }
  return [...byDate.values()].sort((a, b) => a.date - b.date).map((m) => ({
    ...m,
    iso: isoDate(m.date),
    dateText: `${String(m.date.getDate()).padStart(2, "0")}/${String(m.date.getMonth() + 1).padStart(2, "0")}/${m.date.getFullYear()}`,
  }));
}

// duty swaps approved on the site (duty.sql → duty_overrides): replace the duty text of those dates.
// Until duty.sql runs the call fails and nothing changes.
const DUTY_RPC = "https://pualpwrkztjzhgpaqudm.supabase.co/rest/v1/rpc/";
const DUTY_KEY = "sb_publishable_TFMMqLxLWHatd3lXYrUlTQ_aO7MvaQ9";
function dutyRpc(fn, body = {}) {
  return fetch(DUTY_RPC + fn, {
    method: "POST", body: JSON.stringify(body),
    headers: { apikey: DUTY_KEY, "Content-Type": "application/json", "Content-Profile": "or_hasharon_worship", "Accept-Profile": "or_hasharon_worship" },
  }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
}
const dutyTeams = (duty) => String(duty || "").split(",").map((x) => x.trim()).filter((x) => x && x !== "כולם");

// the weekly duty reminder (admin "תורניות" + duty-send.html) — keep the same as reminder() in my-aios duty_reminder.py
function dutyReminderText(firstName, m) {
  const kind = meetingKind(m);
  return `היי${firstName ? " " + firstName : ""}! 🙏\n` +
    `תזכורת: אתם בתורנות ב${kind} ביום ${m.day} ${m.dateText.slice(0, 5)}${m.place ? ` ב${m.place}` : ""}.\n` +
    (kind === "אסיפה" ? `הגעה ב-10:30.\n` : "") +
    `ההנחיות לתורנים:\nhttps://orhasharon.github.io/#guide\n` +
    `לא יכולים להגיע? אפשר לבקש החלפה באתר, ב"שיבוץ מלא".\nתודה! 🙏`;
}

const HE_DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const withDates = (m) => ({ ...m, iso: isoDate(m.date),
  dateText: `${String(m.date.getDate()).padStart(2, "0")}/${String(m.date.getMonth() + 1).padStart(2, "0")}/${m.date.getFullYear()}` });

// the roster Michal edits (duty.sql → duty_roster): wins over the sheet + duty.json, adds dates, hides deleted ones.
// null = keep what the sheet says; "" = clear (kind "" → by the day). Until duty.sql runs the call fails and nothing changes.
function applyRoster(ms, rows) {
  const by = new Map(ms.map((m) => [m.iso, m]));
  for (const r of rows) {
    if (r.deleted) { by.delete(r.meeting_date); continue; }
    let m = by.get(r.meeting_date);
    if (!m) {
      const [y, mo, d] = r.meeting_date.split("-").map(Number);
      const date = new Date(y, mo - 1, d);
      m = withDates({ duty: "", notes: "", place: "", day: HE_DAYS[date.getDay()], date });
      by.set(m.iso, m);
    }
    if (r.day) m.day = r.day;
    if (r.place != null) m.place = r.place;
    if (r.duty != null) m.duty = r.duty;
    if (r.notes != null) m.notes = r.notes;
    if (r.kind != null) { if (r.kind) m.kind = r.kind; else delete m.kind; }
    m.edited = true;
  }
  return [...by.values()].sort((a, b) => a.date - b.date);
}

// all meetings, oldest first
function loadMeetings() {
  return Promise.all([
    fetch(SCHEDULE_CSV).then((r) => r.text()).catch(() => ""),
    fetch(DUTY_JSON, { cache: "no-cache" }).then((r) => r.json()).catch(() => ({ meetings: [] })),
    dutyRpc("duty_overrides").catch(() => []),
    dutyRpc("duty_roster").catch(() => []),
  ]).then(([text, roster, swaps, edits]) => {
    const ms = applyRoster(mergeMeetings(parseSheet(text), roster.meetings || []), Array.isArray(edits) ? edits : []);
    for (const o of Array.isArray(swaps) ? swaps : []) {
      const m = ms.find((x) => x.iso === o.meeting_date);
      if (m && o.duty) { m.dutyBase = m.duty; m.duty = o.duty; m.swapped = true; }
    }
    return ms;
  });
}

const upcomingMeetings = (meetings, now = new Date()) => meetings.filter((m) => meetingEnd(m) > now);
