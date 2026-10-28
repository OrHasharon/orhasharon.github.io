const PAGE = 24;
const state = { tab: "sermon", query: "", series: null, shown: PAGE };
let data = { videos: [], playlists: [] };
let byId = {};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function fmtDur(sec) {
  if (!sec) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
const yt = (id, size) => `https://i.ytimg.com/vi/${id}/${size}.jpg`;
const thumb = (id) => yt(id, "mqdefault");
// Let the browser pick by display size; v.thumb is the largest size YouTube has for that video.
const WIDTHS = { maxresdefault: 1280, sddefault: 640, hqdefault: 480 };
function imgHtml(id, sizes = "(max-width: 560px) 100vw, 280px") {
  const big = byId[id]?.thumb;
  const srcset = WIDTHS[big] ? ` srcset="${thumb(id)} 320w, ${yt(id, big)} ${WIDTHS[big]}w" sizes="${sizes}"` : "";
  return `<img loading="lazy" alt="" src="${thumb(id)}"${srcset}>`;
}

function cardHtml(v, { badge = false, sizes } = {}) {
  const title = v.type === "hallel" ? `הלל – ${fmtDate(v.date)}` : v.title;
  const meta = [fmtDate(v.date), v.series[0] && `<span class="series">${esc(v.series[0])}</span>`].filter(Boolean).join(" · ");
  return `<button class="card" data-id="${v.id}">
    <div class="thumb">
      ${imgHtml(v.id, sizes)}
      ${badge ? `<span class="badge ${v.type}">${v.type === "hallel" ? "הלל" : "דרשה"}</span>` : ""}
      ${v.duration ? `<span class="dur">${fmtDur(v.duration)}</span>` : ""}
    </div>
    <div class="card-body">
      <p class="title">${esc(title)}</p>
      <div class="meta">${v.type === "hallel" ? "" : meta}</div>
    </div>
  </button>`;
}

function renderLatest() {
  const latestDate = data.videos.find((v) => v.date)?.date;
  if (!latestDate) return;
  const day = data.videos.filter((v) => v.date === latestDate);
  const sermon = day.find((v) => v.type === "sermon");
  const hallel = day.find((v) => v.type === "hallel");
  $("latest").innerHTML = `
    <div class="latest-head"><h2>השבת האחרונה</h2><span>${fmtDate(latestDate)}</span></div>
    <div class="latest-grid">
      ${sermon ? cardHtml(sermon, { badge: true, sizes: "(max-width: 720px) 100vw, 720px" }) : ""}
      ${hallel ? cardHtml(hallel, { badge: true, sizes: "(max-width: 720px) 100vw, 360px" }) : ""}
    </div>`;
}

function matches(v, q) {
  if (!q) return true;
  const hay = `${v.rawTitle} ${v.series.join(" ")} ${fmtDate(v.date)}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

function renderChips() {
  const chips = $("chips");
  if (state.tab !== "sermon") { chips.hidden = true; return; }
  chips.hidden = false;
  const all = `<button class="chip" data-series="" aria-pressed="${!state.series}">הכל</button>`;
  chips.innerHTML = all + data.playlists.map((p) =>
    `<button class="chip" data-series="${esc(p.title)}" aria-pressed="${state.series === p.title}">${esc(p.title)}<small>${p.videoIds.length}</small></button>`
  ).join("");
}

function render() {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
  renderChips();
  const grid = $("grid");
  $("status").textContent = "";

  if (state.tab === "series") {
    const list = data.playlists.filter((p) => !state.query || p.title.includes(state.query));
    $("count").textContent = `${list.length} סדרות`;
    grid.innerHTML = list.map((p) => {
      const first = p.videoIds.map((id) => byId[id]).filter(Boolean).sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
      return `<button class="card series-card" data-series="${esc(p.title)}">
        <div class="thumb" data-n="${p.videoIds.length}">${imgHtml(first?.id || p.videoIds[0], "(max-width: 560px) 100vw, 360px")}</div>
        <div class="card-body"><p class="title">${esc(p.title)}</p>
        <div class="meta">${first ? "מ־" + fmtDate(first.date) : ""}</div></div>
      </button>`;
    }).join("");
    $("more").hidden = true;
    return;
  }

  let list = data.videos.filter((v) => v.type === state.tab && matches(v, state.query));
  if (state.series) {
    list = list.filter((v) => v.series.includes(state.series))
      .sort((a, b) => (a.date || "").localeCompare(b.date || "")); // a series reads best in order
  }
  $("count").textContent = `${list.length} סרטונים`;
  grid.innerHTML = list.slice(0, state.shown).map((v) => cardHtml(v)).join("");
  $("more").hidden = list.length <= state.shown;
  if (!list.length) $("status").textContent = "לא נמצאו סרטונים";
}

function openPlayer(id) {
  const v = byId[id];
  if (!v) return;
  $("frame").src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
  $("player-title").textContent = v.type === "hallel" ? "הלל" : v.title;
  $("player-sub").textContent = [fmtDate(v.date), ...v.series].filter(Boolean).join(" · ");
  $("player-yt").href = `https://www.youtube.com/watch?v=${id}`;
  if (!$("player").open) $("player").showModal();
  history.replaceState(null, "", `#v=${id}`);
}
function closePlayer() {
  $("frame").src = "about:blank";
  if ($("player").open) $("player").close();
  history.replaceState(null, "", location.pathname + location.search);
}

document.addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card?.dataset.id) return openPlayer(card.dataset.id);
  const series = e.target.closest("[data-series]");
  if (series) {
    state.tab = "sermon";
    state.series = series.dataset.series || null;
    state.shown = PAGE;
    render();
    if (card) $("chips").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const tab = e.target.closest(".tabs button");
  if (tab) {
    state.tab = tab.dataset.tab;
    state.series = null;
    state.shown = PAGE;
    render();
  }
});
$("more").addEventListener("click", () => { state.shown += PAGE; render(); });
$("search").addEventListener("input", (e) => { state.query = e.target.value.trim(); state.shown = PAGE; render(); });
$("player").addEventListener("close", closePlayer);
$("player").addEventListener("click", (e) => { if (e.target === $("player") || e.target.closest(".close")) closePlayer(); });

fetch("data/videos.json", { cache: "no-cache" })
  .then((r) => r.json())
  .then((d) => {
    data = d;
    byId = Object.fromEntries(d.videos.map((v) => [v.id, v]));
    $("updated").textContent = `עודכן לאחרונה: ${new Date(d.updated).toLocaleDateString("he-IL")}`;
    renderLatest();
    render();
    const m = location.hash.match(/v=([\w-]{11})/);
    if (m) openPlayer(m[1]);
  })
  .catch(() => { $("status").textContent = "שגיאה בטעינת הסרטונים"; });

// ---- meeting schedule: read live from the published Google Sheet ----
const SCHEDULE_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRkDNJ_HFYdjU4gqQ7gXajrO01CdF6pHFeaY_aC_Jn2GO3WUvIca15GhM7J6nHx5dl0vMCYLkm5U_3v/pub?gid=211949928&single=true&output=csv";
const SCHEDULE_VIEW = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRkDNJ_HFYdjU4gqQ7gXajrO01CdF6pHFeaY_aC_Jn2GO3WUvIca15GhM7J6nHx5dl0vMCYLkm5U_3v/pubhtml?gid=211949928&single=true";
let meetingsAll = false;

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

function renderSchedule(meetings) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = meetings.filter((m) => m.date >= today);
  const el = $("schedule");
  if (!upcoming.length) { el.hidden = true; return; }
  const list = meetingsAll ? upcoming : upcoming.slice(0, 4);
  const maps = (place) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;
  el.hidden = false;
  el.innerHTML = `
    <div class="schedule-head">
      <h2>האסיפות הקרובות</h2>
      <small>המידע עלול להשתנות · <a href="${SCHEDULE_VIEW}" target="_blank" rel="noopener">ללוח המלא</a></small>
    </div>
    <div class="meetings">
      ${list.map((m, i) => `<div class="meeting${i === 0 ? " next" : ""}">
        ${i === 0 ? `<div class="tag">האסיפה הבאה</div>` : ""}
        <div class="when">יום ${esc(m.day)} <span>${esc(m.dateText)}</span></div>
        <div>${m.place ? `<a href="${maps(m.place)}" target="_blank" rel="noopener">${esc(m.place)}</a>` : "מקום יעודכן"}</div>
        ${m.notes ? `<div class="extra">${esc(m.notes)}</div>` : ""}
        ${m.duty ? `<div class="extra">תורנות: ${esc(m.duty)}</div>` : ""}
      </div>`).join("")}
    </div>
    ${upcoming.length > 4 ? `<p><button class="link-btn" id="meetings-toggle">${meetingsAll ? "הצג פחות" : `הצג את כל ${upcoming.length} האסיפות הקרובות`}</button></p>` : ""}`;
  $("meetings-toggle")?.addEventListener("click", () => { meetingsAll = !meetingsAll; renderSchedule(meetings); });
}

fetch(SCHEDULE_CSV)
  .then((r) => r.text())
  .then((text) => {
    // columns: תורנות, הערות, מקום, תאריך (dd/mm/yy), יום
    const meetings = parseCsv(text).map(([duty, notes, place, dateText, day]) => {
      const m = (dateText || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (!m) return null;
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      return { duty: duty.trim(), notes: notes.trim(), place: place.trim(), day: (day || "").trim(),
               dateText: `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${y}`, date: new Date(y, m[2] - 1, m[1]) };
    }).filter(Boolean);
    renderSchedule(meetings);
  })
  .catch(() => {}); // the schedule is a bonus; the videos still work without it
