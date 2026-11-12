// The projection screen (screen.html), for the computer on the HDMI: the current song's lyrics, up to 4 lines a
// slide, white on a dark animated background. It is one more guest on the team channel (live-sync.js guestServe):
// the leader in live mode decides the SONG (state.itemId) and the screen jumps to its first slide; the clicker
// (PageDown / PageUp / arrows) turns slides INSIDE the song. With no leader connected the clicker drives everything.
// Opens without signing in; picks the upcoming meeting from the public schedule (schedule.js), ?d=YYYY-MM-DD pins a date.
// Uses lyricStanzas / chunks / songMeta from chords.js, loadMeetings / upcomingMeetings / meetingKind from schedule.js.

// must stay the same as guestCodeFor() in live-sync.js (the team link's channel name)
const LIVE_SALT = "orhasharon-ws-live:";
const BGS = [["night", "שמי לילה"], ["glow", "אור רך"], ["deep", "כחול עמוק"], ["quiet", "שחור שקט"]];

const sb = window.supabase.createClient(SB, KEY, { db: { schema: "or_hasharon_worship" } });
const $ = (id) => document.getElementById(id);
const S = {
  date: null, meeting: null, code: null, ch: null, online: false,
  songs: [], idx: 0, slides: [], slide: 0,
  itemId: null, leader: null, leaderHere: false, seq: -1,
  mode: "lyrics", // lyrics | blank | logo | nobg
  bg: "night", size: 1, wake: null, opsTimer: null, ended: false,
};
try { S.bg = localStorage.getItem("ws-screen-bg") || "night"; S.size = Number(localStorage.getItem("ws-screen-size")) || 1; } catch {}

// ---------- which meeting ----------
async function pickMeeting() {
  const q = new URLSearchParams(location.search).get("d");
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) { S.date = q; }
  try {
    const meetings = await loadMeetings();
    S.meeting = (S.date ? meetings.find((m) => m.iso === S.date) : upcomingMeetings(meetings)[0]) || null;
    if (!S.date && S.meeting) S.date = S.meeting.iso;
  } catch {}
  if (!S.date) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(LIVE_SALT + S.date));
  S.code = [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join("");
  return true;
}

// ---------- slides ----------
function slidesFor(song) {
  if (!song) return [];
  const meta = songMeta(song.content || "");
  if ((meta.screen || "").toLowerCase() === "quiet") return [{ title: song.title, quiet: true }];
  const out = [];
  for (const st of lyricStanzas(song.content || "")) for (const lines of chunks(st.lines, 4)) out.push({ lines });
  return out.length ? out : [{ title: song.title }];
}
function build() {
  S.idx = Math.max(0, Math.min(S.idx, S.songs.length - 1));
  S.slides = slidesFor(S.songs[S.idx]);
  S.slide = Math.max(0, Math.min(S.slide, S.slides.length - 1));
}

// ---------- drawing ----------
const day = () => (S.date ? S.date.split("-").reverse().slice(0, 2).join("/") : "");
function logoHtml(sub) {
  return `<img class="logo" src="../logo.png" alt=""><div>קהילת אור השרון</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}`;
}

function show() {
  const stage = $("stage"), el = $("slide"), corner = $("corner");
  const song = S.songs[S.idx], sl = S.slides[S.slide];
  const quiet = S.mode === "lyrics" && sl?.quiet;
  stage.className = `stage bg-${quiet ? "quiet" : S.bg}${S.mode === "blank" ? " blank" : ""}${S.mode === "nobg" ? " nobg" : ""}`;
  let html = "", title = false, cornerText = "";
  if (S.mode === "logo" || (S.mode !== "blank" && !song)) {
    title = true;
    // "starting soon" only before there is a set; mid-set the logo screen is just the logo
    html = logoHtml(S.ended ? "תודה, ושבת שלום" : !S.date ? "אין מפגש קרוב בלוח" : song ? "" : `ההלל יתחיל בקרוב${S.meeting ? " · " + meetingKind(S.meeting) + " " + day() : ""}`);
  } else if (sl?.title) {
    title = true;
    html = `<div>${esc(sl.title)}</div>`;
  } else if (sl?.lines) {
    html = sl.lines.map((l) => `<div>${esc(l)}</div>`).join("");
    cornerText = S.slide === 0 ? song.title : "";
  }
  el.classList.add("out");
  setTimeout(() => {
    el.classList.toggle("title", title);
    el.innerHTML = html;
    corner.textContent = cornerText;
    fit();
    el.classList.remove("out");
  }, el.innerHTML ? 180 : 0);
  renderOps();
}

// biggest size where the slide fits: at most ~7vw, shrunk until no line overflows the width or 80% of the height
function fit() {
  const el = $("slide");
  let vw = 7 * S.size;
  if (el.classList.contains("title")) vw = 6 * S.size;
  for (let k = 0; k < 40; k++) {
    el.style.setProperty("--size", vw + "vw");
    // the lines' own height (the slide box itself always fills the screen)
    const content = [...el.children].reduce((h, c) => h + c.getBoundingClientRect().height, 0);
    const tooTall = content > el.clientHeight * 0.92;
    const tooWide = [...el.children].some((c) => c.scrollWidth > el.clientWidth + 1);
    if (!tooTall && !tooWide) break;
    vw *= 0.96;
  }
}

// ---------- clicker ----------
function next() {
  if (S.mode !== "lyrics") { S.mode = "lyrics"; return show(); }
  if (S.slide < S.slides.length - 1) S.slide++;
  else if (!S.leaderHere && S.idx < S.songs.length - 1) { S.idx++; S.slide = 0; build(); }
  else return; // the leader changes songs
  show();
}
function prev() {
  if (S.mode !== "lyrics") { S.mode = "lyrics"; return show(); }
  if (S.slide > 0) S.slide--;
  else if (!S.leaderHere && S.idx > 0) { S.idx--; build(); S.slide = S.slides.length - 1; }
  else return;
  show();
}
function setMode(m) { S.mode = S.mode === m ? "lyrics" : m; show(); }
function setBg(b) { S.bg = b; try { localStorage.setItem("ws-screen-bg", b); } catch {} show(); }
function setSize(d) { S.size = Math.min(1.6, Math.max(0.6, +(S.size + d).toFixed(2))); try { localStorage.setItem("ws-screen-size", S.size); } catch {} fit(); renderOps(); }
function fullscreen() { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen?.().catch(() => {}); }

document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("select")) return;
  const k = e.key;
  if (["PageDown", "ArrowDown", "ArrowRight", " ", "Enter"].includes(k)) { e.preventDefault(); next(); }
  else if (["PageUp", "ArrowUp", "ArrowLeft", "Backspace"].includes(k)) { e.preventDefault(); prev(); }
  else if (k === "b" || k === "B" || k === "." || k === "נ") setMode("blank");
  else if (k === "l" || k === "L" || k === "ך") setMode("logo");
  else if (k === "h" || k === "H" || k === "י") setMode("nobg");
  else if (k === "Escape") { S.mode = "lyrics"; show(); }
  else if (k === "f" || k === "F" || k === "כ") fullscreen();
  else if (k === "+" || k === "=") setSize(0.08);
  else if (k === "-") setSize(-0.08);
  else if (/^[1-4]$/.test(k)) setBg(BGS[Number(k) - 1][0]);
});
// no clicker: tap the left half for next, the right half for previous (Hebrew reads right to left)
$("stage").addEventListener("click", (e) => { if (e.clientX < innerWidth / 2) next(); else prev(); });

// ---------- operator bar (appears on mouse / touch, hides after 3 seconds) ----------
function renderOps() {
  const ops = $("ops");
  const who = S.leaderHere && S.leader ? `👑 ${esc(S.leader.name || "")} מוביל/ה` : S.songs.length ? "אין מוביל/ה מחובר/ת · הלחצן שולט" : "ממתינים למוביל/ה";
  ops.innerHTML = `
    <span class="status"><span class="dot${S.online ? " on" : ""}"></span>${who}${S.date ? ` · ${day()}` : ""}</span>
    <span class="sep"></span>
    <span class="grp"><button data-op="prev" title="הקודם (PageUp)">→</button><button data-op="next" title="הבא (PageDown)">←</button></span>
    ${S.songs.length ? `<select data-op="jump" aria-label="קפיצה לשיר">${S.songs.map((s, i) => `<option value="${i}"${i === S.idx ? " selected" : ""}>${i + 1}. ${esc(s.title)}</option>`).join("")}</select>` : ""}
    <span class="sep"></span>
    <span class="grp">${BGS.map(([b, label], i) => `<button data-bg="${b}" class="${S.bg === b ? "on" : ""}" title="${i + 1}">${label}</button>`).join("")}</span>
    <span class="sep"></span>
    <span class="grp">
      <button data-op="blank" class="${S.mode === "blank" ? "on" : ""}" title="B">שחור</button>
      <button data-op="logo" class="${S.mode === "logo" ? "on" : ""}" title="L">לוגו</button>
      <button data-op="nobg" class="${S.mode === "nobg" ? "on" : ""}" title="H">בלי רקע</button>
    </span>
    <span class="grp"><button data-op="smaller" title="−">א−</button><button data-op="bigger" title="+">א+</button></span>
    <button data-op="fs" title="F">⛶ מסך מלא</button>`;
}
document.getElementById("ops").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.bg) return setBg(b.dataset.bg);
  const op = b.dataset.op;
  if (op === "next") next(); else if (op === "prev") prev();
  else if (op === "blank" || op === "logo" || op === "nobg") setMode(op);
  else if (op === "smaller") setSize(-0.08); else if (op === "bigger") setSize(0.08);
  else if (op === "fs") fullscreen();
});
document.getElementById("ops").addEventListener("change", (e) => {
  if (e.target.dataset.op !== "jump") return;
  S.idx = Number(e.target.value); S.slide = 0; S.mode = "lyrics"; build(); show(); e.target.blur();
});
function wakeOps() {
  $("ops").hidden = false; document.body.classList.remove("idle");
  clearTimeout(S.opsTimer);
  S.opsTimer = setTimeout(() => { if (!$("ops").matches(":hover")) { $("ops").hidden = true; document.body.classList.add("idle"); } }, 3000);
}
document.addEventListener("mousemove", wakeOps);
document.addEventListener("touchstart", wakeOps, { passive: true });

// ---------- the team channel ----------
const hello = () => S.ch?.send({ type: "broadcast", event: "hello", payload: {} });

function onSongs(list) {
  const curId = S.songs[S.idx]?.id;
  S.songs = list || [];
  const k = S.songs.findIndex((s) => s.id === (S.itemId ?? curId));
  if (k >= 0) S.idx = k;
  build(); show();
}
function onState(p) {
  if (!p?.leader) return;
  if (S.leader && (p.leader.email !== S.leader.email || p.leader.ts !== S.leader.ts)) { if (p.leader.ts < S.leader.ts) return; S.seq = -1; }
  if (p.seq <= S.seq) return;
  S.leader = p.leader; S.seq = p.seq; S.ended = false;
  if (p.itemId !== S.itemId) {
    S.itemId = p.itemId;
    const k = S.songs.findIndex((s) => s.id === p.itemId);
    if (k >= 0) { S.idx = k; S.slide = 0; S.mode = S.mode === "logo" ? "lyrics" : S.mode; build(); }
    show();
  } else renderOps();
}

function join() {
  S.ch = sb.channel("ws-guest-" + S.code, { config: { broadcast: { self: false }, presence: { key: "screen" } } });
  S.ch.on("presence", { event: "sync" }, () => { S.leaderHere = "leader" in S.ch.presenceState(); renderOps(); })
    .on("broadcast", { event: "songs" }, ({ payload }) => onSongs(payload?.songs))
    .on("broadcast", { event: "state" }, ({ payload }) => onState(payload))
    .on("broadcast", { event: "end" }, () => { S.ended = true; S.mode = "logo"; show(); })
    .subscribe((status) => {
      S.online = status === "SUBSCRIBED";
      if (S.online) { S.ch.track({ screen: true }); hello(); }
      renderOps();
    });
}

// the set before anyone leads (live_set.sql; until it runs this quietly does nothing)
async function preload() {
  try {
    const { data, error } = await sb.rpc("live_set", { c: S.code });
    if (!error && data?.length && !S.songs.length) onSongs(data.map((r) => ({ id: r.id, title: r.title, key: r.song_key || "", content: r.content || "", notes: r.notes || "" })));
  } catch {}
}

async function wakeOn() { try { if ("wakeLock" in navigator && !S.wake) { S.wake = await navigator.wakeLock.request("screen"); S.wake.addEventListener("release", () => { S.wake = null; }); } } catch {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { wakeOn(); hello(); } });
window.addEventListener("online", hello);
window.addEventListener("resize", fit);

(async () => {
  show();
  if (await pickMeeting()) { join(); preload(); }
  wakeOn(); show(); wakeOps();
})();
