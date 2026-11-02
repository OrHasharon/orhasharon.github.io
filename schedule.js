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

function meetingKind(day) {
  if (day.includes("שבת")) return "אסיפה";
  if (day.includes("שישי")) return "קבלת שבת";
  return `יום ${day}`;
}

// a meeting stays "next" until it's over: Saturday ends ~13:00, anything else at the end of its day
function meetingEnd(m) {
  const end = new Date(m.date);
  if (meetingKind(m.day) === "אסיפה") end.setHours(13, 0, 0, 0);
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
    if (m) { if (r.duty) m.duty = r.duty; if (r.place) m.place = r.place; if (r.notes) m.notes = r.notes; }
    else byDate.set(isoDate(date), { duty: r.duty, notes: r.notes || "", place: r.place, day: r.day, date });
  }
  return [...byDate.values()].sort((a, b) => a.date - b.date).map((m) => ({
    ...m,
    iso: isoDate(m.date),
    dateText: `${String(m.date.getDate()).padStart(2, "0")}/${String(m.date.getMonth() + 1).padStart(2, "0")}/${m.date.getFullYear()}`,
  }));
}

// all meetings, oldest first
function loadMeetings() {
  return Promise.all([
    fetch(SCHEDULE_CSV).then((r) => r.text()).catch(() => ""),
    fetch(DUTY_JSON, { cache: "no-cache" }).then((r) => r.json()).catch(() => ({ meetings: [] })),
  ]).then(([text, roster]) => mergeMeetings(parseSheet(text), roster.meetings || []));
}

const upcomingMeetings = (meetings, now = new Date()) => meetings.filter((m) => meetingEnd(m) > now);
