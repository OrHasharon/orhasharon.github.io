// Live set sync: one leader drives the song + key on every phone in the live worship view (Supabase Realtime
// broadcast + presence, no tables). Each phone keeps its own capo / zoom / chords / follow. A guest link opens
// live.html, which gets the songs from the leader's phone (guests can't read the database).
// Loaded before ws.js (so it sees ?livesync=1 before the address bar is cleaned). At run time it uses
// sb / user / isAdmin / toast / esc / myName from ws.js and live / renderLive / itemsFor / canEditSetlist /
// loadSetlist / setlist from setlist.js.
// Off unless switched on: ?livesync=1 (remembered on this device), ?livesync=0 turns it off.

const LIVE_SYNC_ON = (() => {
  try {
    const q = new URLSearchParams(location.search).get("livesync");
    if (q === "1" || q === "0") localStorage.setItem("ws-live-sync", q);
    return localStorage.getItem("ws-live-sync") === "1";
  } catch { return false; }
})();

const sync = {
  ch: null, date: null, online: false,
  seq: 0, lastSeq: -1,          // my broadcasts / the last one I applied
  leader: null, iLead: false,   // leader = { email, name, ts }
  follow: true, remote: null,   // remote = the last state the leader sent
  people: {}, showPeople: false,
  guestCode: null, guestCh: null, guestCount: 0, guestSongsSig: "",
  wake: null, leadTimer: null,
};

const syncActive = () => !!sync.ch;
const liveItems = () => (setlist.openDate ? itemsFor(setlist.openDate).filter((i) => i.songs) : []);
const syncEmail = () => (typeof user !== "undefined" && user?.email || "").toLowerCase();
const mayLead = (date) => typeof user !== "undefined" && !!user && (isAdmin || canEditSetlist(date));
// while following, the key is the leader's: the ± buttons are hidden so nobody wonders why theirs differs
const syncLocksKey = () => syncActive() && !sync.iLead && sync.follow;

// ---------- screen stays on ----------
async function wakeOn() {
  try { if ("wakeLock" in navigator && !sync.wake) { sync.wake = await navigator.wakeLock.request("screen"); sync.wake.addEventListener("release", () => { sync.wake = null; }); } } catch {}
}
function wakeOff() { try { sync.wake?.release(); } catch {} sync.wake = null; }

// ---------- members' channel ----------
function syncStart(date) {
  wakeOn();
  if (!LIVE_SYNC_ON || typeof user === "undefined" || !user || sync.ch) return;
  Object.assign(sync, { date, seq: 0, lastSeq: -1, leader: null, iLead: false, follow: true, remote: null, people: {}, online: false });
  const ch = sb.channel("ws-live-" + date, { config: { broadcast: { self: false }, presence: { key: syncEmail() } } });
  ch.on("broadcast", { event: "state" }, ({ payload }) => onState(payload))
    .on("broadcast", { event: "lead" }, ({ payload }) => onLead(payload))
    .on("broadcast", { event: "hello" }, () => { if (sync.iLead) broadcastState(); })
    .on("broadcast", { event: "end" }, () => onEnd())
    .on("presence", { event: "sync" }, () => { sync.people = ch.presenceState(); renderLive(); })
    .subscribe((status) => {
      sync.online = status === "SUBSCRIBED";
      if (sync.online) {
        ch.track({ name: myName(), lead: sync.iLead });
        send("hello", {});
        // the session's leader takes the lead on joining, unless someone (an admin) is already leading
        clearTimeout(sync.leadTimer);
        sync.leadTimer = setTimeout(() => { if (!sync.leader && canEditSetlist(date)) claimLead(); }, 1500);
      }
      renderLive();
    });
  sync.ch = ch;
}

function send(event, payload, channel = sync.ch) {
  if (!channel) return;
  channel.send({ type: "broadcast", event, payload }).catch?.(() => {});
}

function claimLead() {
  sync.iLead = true;
  sync.follow = true;
  sync.leader = { email: syncEmail(), name: myName(), ts: Date.now() };
  send("lead", sync.leader);
  sync.ch?.track({ name: myName(), lead: true });
  broadcastState();
  renderLive();
}

function onLead(p) {
  if (!p?.email) return;
  const cur = sync.leader;
  if (cur && (p.ts < cur.ts || (p.ts === cur.ts && p.email < cur.email))) return; // the latest claim wins
  const lost = sync.iLead && p.email !== syncEmail();
  sync.leader = p; sync.lastSeq = -1;
  if (lost) { sync.iLead = false; sync.ch?.track({ name: myName(), lead: false }); toast(`ההובלה עברה ל${p.name ? "-" + p.name : "מישהו אחר"}`); }
  renderLive();
}

function buildState() {
  const it = liveItems()[live.idx];
  return { itemId: it?.id ?? null, shifts: { ...live.shift }, leader: sync.leader, seq: ++sync.seq, ts: Date.now() };
}

function broadcastState() {
  if (!sync.iLead) return;
  const st = buildState();
  send("state", st);
  if (sync.guestCh) { sendGuestSongs(); send("state", st, sync.guestCh); }
}

async function onState(p) {
  if (!p?.leader) return;
  if (!sync.leader || p.leader.ts > sync.leader.ts) onLead(p.leader);
  if (p.leader.email !== sync.leader?.email || p.seq <= sync.lastSeq) return; // old leader or stale message
  sync.lastSeq = p.seq;
  sync.remote = p;
  if (sync.follow && !sync.iLead) await applyRemote(p);
  else renderLive(); // the "leader is on song X" bar
}

async function applyRemote(p) {
  live.shift = { ...(p.shifts || {}) };
  let k = liveItems().findIndex((i) => i.id === p.itemId);
  if (k < 0 && p.itemId != null) { await loadSetlist(); k = liveItems().findIndex((i) => i.id === p.itemId); } // added mid-set
  if (k >= 0) live.idx = k;
  renderLive();
}

function onEnd() {
  toast("המוביל/ה סיים/ה את הסט");
  syncStop();
  renderLive();
}

// leave the channel (a follower closing the view, or after the set ended)
function syncStop() {
  clearTimeout(sync.leadTimer);
  if (sync.ch) sb.removeChannel(sync.ch);
  if (sync.guestCh) sb.removeChannel(sync.guestCh);
  Object.assign(sync, { ch: null, guestCh: null, guestCode: null, guestCount: 0, guestSongsSig: "", online: false, iLead: false, leader: null, remote: null, people: {}, showPeople: false });
  wakeOff();
}

// the leader ends the set for everyone (guests too)
function syncEnd() {
  send("end", {});
  if (sync.guestCh) send("end", {}, sync.guestCh);
  setTimeout(syncStop, 300); // let the messages leave first
}

// back from the background / a new cell tower: catch up
function syncResume() {
  if (!live.on) return;
  wakeOn();
  if (!sync.ch) return;
  if (sync.iLead) broadcastState(); else send("hello", {});
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncResume(); });
window.addEventListener("online", syncResume);

// ---------- guest link ----------
function guestCode() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-4);
}

function guestSongs() {
  return liveItems().map((i) => ({ id: i.id, title: i.songs.title, key: i.songs.song_key || "", content: i.songs.content || "", notes: i.notes || "" }));
}
function sendGuestSongs(force = false) {
  const songs = guestSongs();
  const sig = songs.map((s) => s.id).join(",");
  if (!force && sig === sync.guestSongsSig) return;
  sync.guestSongsSig = sig;
  send("songs", { songs }, sync.guestCh);
}

function guestOpen() {
  if (!sync.iLead) return;
  if (!sync.guestCh) {
    sync.guestCode = guestCode();
    const ch = sb.channel("ws-guest-" + sync.guestCode, { config: { broadcast: { self: false }, presence: { key: "leader" } } });
    ch.on("broadcast", { event: "hello" }, () => { if (!sync.iLead) return; sendGuestSongs(true); send("state", buildState(), ch); })
      .on("presence", { event: "sync" }, () => { sync.guestCount = Object.keys(ch.presenceState()).filter((k) => k !== "leader").length; renderLive(); })
      .subscribe((status) => { if (status === "SUBSCRIBED") ch.track({ leader: true }); });
    sync.guestCh = ch;
  }
  const url = location.origin + location.pathname.replace(/[^/]*$/, "") + "live.html?c=" + sync.guestCode;
  const text = "הצטרפות לסט ההלל (צפייה בלבד):";
  if (navigator.share) navigator.share({ title: "סט הלל", text, url }).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => toast("הלינק לאורח/ת הועתק"), () => prompt("לינק לאורח/ת:", url));
}

// ---------- what the live view shows ----------
function syncToolsHtml() {
  if (!syncActive()) return "";
  const n = Object.keys(sync.people).length;
  const dot = `<span class="live-dot${sync.online ? " on" : ""}" title="${sync.online ? "מחובר/ת" : "מתחבר/ת…"}"></span>`;
  const who = sync.leader ? `👑 ${esc(sync.leader.name || "")}` : "אין מוביל/ה";
  let html = `${dot}<button class="tool link" data-live="people">${who} · ${n} מחוברים${sync.guestCount ? ` + ${sync.guestCount} אורחים` : ""}</button>`;
  if (sync.iLead) html += `<button class="tool" data-live="guest">🔗 לינק לאורח/ת</button><button class="tool" data-live="end">⏹ סיום סט</button>`;
  else {
    html += `<button class="tool${sync.follow ? " on" : ""}" data-live="follow">${sync.follow ? "עוקב/ת ✓" : "לא עוקב/ת"}</button>`;
    if (mayLead(sync.date)) html += `<button class="tool" data-live="lead">קח/י הובלה</button>`;
  }
  html += `<button class="tool" data-live="capo-me" title="קאפו אישי, רק אצלך">קאפו שלי ${live.myCapo || 0}</button>`;
  return html;
}

function syncPeopleHtml() {
  if (!syncActive() || !sync.showPeople) return "";
  const rows = Object.entries(sync.people).map(([email, metas]) => {
    const m = metas[0] || {};
    return `<li>${m.lead ? "👑 " : ""}${esc(m.name || email)}</li>`;
  }).join("");
  return `<div class="live-people"><ul>${rows || "<li>אף אחד עדיין</li>"}</ul>${sync.guestCount ? `<p>+ ${sync.guestCount} אורחים בלינק</p>` : ""}</div>`;
}

function syncAwayHtml() {
  if (!syncActive() || sync.iLead) return "";
  if (sync.leader && !sync.people[sync.leader.email]) return `<div class="live-away">המוביל/ה התנתק/ה · ממשיכים מאיפה שהיינו</div>`;
  if (sync.follow || !sync.remote) return "";
  const it = liveItems().find((i) => i.id === sync.remote.itemId);
  return `<div class="live-away">המוביל/ה בשיר: <b>${esc(it?.songs.title || "")}</b> <button class="tool" data-live="back">חזרה למעקב</button></div>`;
}

// a live action from setlist.js: true = handled here
function syncAction(a) {
  if (a === "people") { sync.showPeople = !sync.showPeople; return true; }
  if (a === "follow") { sync.follow = !sync.follow; if (sync.follow && sync.remote) applyRemote(sync.remote); return true; }
  if (a === "back") { sync.follow = true; if (sync.remote) applyRemote(sync.remote); return true; }
  if (a === "lead") { claimLead(); return true; }
  if (a === "guest") { guestOpen(); return true; }
  if (a === "end") { if (confirm("לסיים את הסט לכולם?")) { syncEnd(); live.on = false; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } return true; }
  if (a === "capo-me") { live.myCapo = ((live.myCapo || 0) + 1) % 8; try { localStorage.setItem("ws-live-capo", live.myCapo); } catch {} return true; }
  return false;
}
