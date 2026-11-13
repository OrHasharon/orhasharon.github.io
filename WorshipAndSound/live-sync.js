// Live set sync: one leader drives the song + key on every phone in the live worship view (Supabase Realtime
// broadcast + presence, no tables). Each phone keeps its own capo / zoom / chords / follow. A guest link opens
// live.html, which gets the songs from the leader's phone (guests can't read the database).
// Loaded before ws.js (so it sees ?livesync=1 before the address bar is cleaned). At run time it uses
// sb / user / isAdmin / toast / esc / myName from ws.js and live / renderLive / itemsFor / canEditSetlist /
// loadSetlist / setlist from setlist.js.
// On for everyone (from 12.11.2026). ?livesync=0 turns it off on this device (an escape hatch), ?livesync=1 back on.

const LIVE_SYNC_ON = (() => {
  try {
    const q = new URLSearchParams(location.search).get("livesync");
    if (q === "1" || q === "0") localStorage.setItem("ws-live-sync", q);
    return localStorage.getItem("ws-live-sync") !== "0";
  } catch { return true; }
})();

// ?lead=YYYY-MM-DD: the worship leader's own link (lead.js). Kept in sessionStorage through the Google sign-in round trip.
const LEAD_DATE = (() => {
  try {
    const q = new URLSearchParams(location.search).get("lead");
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) sessionStorage.setItem("ws-lead", q);
    return sessionStorage.getItem("ws-lead") || null;
  } catch { return null; }
})();

// Who is who on the channel = this browser tab, not the account: the same person on a phone and a tablet is two
// devices (one leads, the other follows), and no e-mail address ever goes out on the public channels.
const SYNC_DEV = (() => { try { return crypto.randomUUID().slice(0, 13); } catch { return Math.random().toString(36).slice(2, 15); } })();
const leaderKey = (l) => (l ? l.id || l.email || "" : "");
// a claim / state stamped more than a minute in the future is a wrong clock or someone playing: ignore it
// (otherwise it would win every "latest claim wins" comparison and nobody could take the lead back)
const syncFuture = (ts) => !(ts > 0) || ts > Date.now() + 60000;
const LIVE_POS = (date) => "ws-live-pos-" + date;

const sync = {
  ch: null, date: null, online: false, joined: false,
  seq: 0, lastSeq: -1,          // my broadcasts / the last one I applied
  leader: null, iLead: false,   // leader = { id (device), name, ts }
  follow: true, remote: null,   // remote = the last state the leader sent
  people: {}, showPeople: false,
  guestCode: null, guestCh: null, guestCount: 0, guestSongsSig: "",
  wake: null, leadTimer: null, endArm: 0,
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
  Object.assign(sync, { date, seq: 0, lastSeq: -1, leader: null, iLead: false, follow: true, remote: null, people: {}, online: false, joined: false, endArm: 0 });
  const ch = sb.channel("ws-live-" + date, { config: { broadcast: { self: false }, presence: { key: SYNC_DEV } } });
  ch.on("broadcast", { event: "state" }, ({ payload }) => onState(payload))
    .on("broadcast", { event: "lead" }, ({ payload }) => onLead(payload))
    .on("broadcast", { event: "hello" }, () => { if (sync.iLead) broadcastState(); })
    .on("broadcast", { event: "end" }, ({ payload }) => onEnd(payload))
    .on("presence", { event: "sync" }, () => { sync.people = ch.presenceState(); renderLive(); })
    .subscribe((status) => {
      sync.online = status === "SUBSCRIBED";
      if (sync.online) {
        ch.track({ name: myName(), lead: sync.iLead });
        if (sync.iLead) broadcastState();          // back after a dropped connection
        else {
          send("hello", {});                       // ask whoever leads for where we are
          // the session's leader leads the moment they open the live view — only on the first connect, and only if
          // nobody answers within a moment (an admin who took over, or the leader's other device, keeps leading;
          // a reconnect never takes the lead back)
          if (!sync.joined && canEditSetlist(date)) {
            clearTimeout(sync.leadTimer);
            sync.leadTimer = setTimeout(() => {
              if (sync.ch === ch && !sync.iLead && !(sync.remote && sync.people[leaderKey(sync.leader)])) claimLead();
            }, 1500);
          }
        }
        sync.joined = true;
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
  // taking over from a leader I was following: start from where they were, not from the song I happened to browse
  if (!sync.iLead && sync.follow && sync.remote) adoptRemote(sync.remote);
  sync.iLead = true;
  sync.follow = true;
  sync.leader = { id: SYNC_DEV, name: myName(), ts: Date.now() };
  send("lead", sync.leader);
  sync.ch?.track({ name: myName(), lead: true });
  guestServe(); // the team's link (guest view) follows whoever leads
  broadcastState();
  renderLive();
}

function onLead(p) {
  if (!leaderKey(p) || syncFuture(p.ts)) return;
  const cur = sync.leader;
  if (cur && (p.ts < cur.ts || (p.ts === cur.ts && leaderKey(p) < leaderKey(cur)))) return; // the latest claim wins
  const lost = sync.iLead && leaderKey(p) !== SYNC_DEV;
  sync.leader = p; sync.lastSeq = -1;
  if (lost) { sync.iLead = false; sync.ch?.track({ name: myName(), lead: false }); guestUnserve(); toast(`ההובלה עברה ל${p.name ? "-" + p.name : "מישהו אחר"}`); }
  renderLive();
}

function buildState() {
  const it = liveItems()[live.idx];
  return { itemId: it?.id ?? null, shifts: { ...live.shift }, leader: sync.leader, seq: ++sync.seq, ts: Date.now() };
}

function broadcastState() {
  if (!sync.iLead) return;
  const st = buildState();
  saveLivePos(st);
  send("state", st);
  if (sync.guestCh) { sendGuestSongs(); send("state", st, sync.guestCh); }
}

async function onState(p) {
  if (!p?.leader || syncFuture(p.leader.ts)) return;
  if (!sync.leader || p.leader.ts > sync.leader.ts) onLead(p.leader);
  if (leaderKey(p.leader) !== leaderKey(sync.leader) || p.seq <= sync.lastSeq) return; // old leader or stale message
  sync.lastSeq = p.seq;
  sync.remote = p;
  if (sync.follow && !sync.iLead) { saveLivePos(p); await applyRemote(p); }
  else renderLive(); // the "leader is on song X" bar
}

// where the leader is → my view (no network)
function adoptRemote(p) {
  live.shift = { ...(p.shifts || {}) };
  const k = liveItems().findIndex((i) => i.id === p.itemId);
  if (k >= 0) live.idx = k;
  return k >= 0;
}
async function applyRemote(p) {
  if (!adoptRemote(p) && p.itemId != null) {
    await loadSetlist(); // a song added mid-set
    if (sync.remote !== p) return; // a newer state arrived while loading: that one wins
    adoptRemote(p);
  }
  renderLive();
}

// the last position per meeting date, so leaving and re-opening the live view continues from there (not song 1)
function saveLivePos(p) {
  try { if (sync.date && p?.itemId != null) localStorage.setItem(LIVE_POS(sync.date), JSON.stringify({ itemId: p.itemId, shifts: p.shifts || {}, at: Date.now() })); } catch {}
}
function restoreLivePos(date) {
  try {
    const p = JSON.parse(localStorage.getItem(LIVE_POS(date)) || "null");
    if (!p || Date.now() - p.at > 12 * 3600e3) return; // a new day = a new set
    const k = itemsFor(date).filter((i) => i.songs).findIndex((i) => i.id === p.itemId);
    if (k >= 0) { live.idx = k; live.shift = { ...p.shifts }; }
  } catch {}
}

// the leader ended the set: stay on the channel (a new start is followed), just without a leader
function onEnd(p) {
  if (!sync.leader || (p?.id && p.id !== leaderKey(sync.leader))) return; // only the current leader ends it
  toast("המוביל/ה סיים/ה את הסט");
  Object.assign(sync, { leader: null, remote: null, lastSeq: -1, follow: true });
  try { localStorage.removeItem(LIVE_POS(sync.date)); } catch {}
  renderLive();
}

// leave the channel (a follower closing the view, or after the set ended)
function syncStop() {
  clearTimeout(sync.leadTimer); clearTimeout(sync.endArm);
  if (sync.ch) sb.removeChannel(sync.ch);
  if (sync.guestCh) sb.removeChannel(sync.guestCh);
  Object.assign(sync, { ch: null, guestCh: null, guestCode: null, guestCount: 0, guestSongsSig: "", online: false, iLead: false, leader: null, remote: null, people: {}, showPeople: false, joined: false, endArm: 0 });
  wakeOff();
}

// the leader ends the set for everyone (guests too)
function syncEnd() {
  const p = { id: SYNC_DEV, ts: sync.leader?.ts || 0 };
  send("end", p);
  if (sync.guestCh) send("end", p, sync.guestCh);
  try { localStorage.removeItem(LIVE_POS(sync.date)); } catch {}
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

// ---------- team / guest link ----------
// One link per meeting date, the same on every device, so it can be sent days ahead (Saturday night for Sunday) and
// keeps working whoever ends up leading. It opens live.html, which follows the leader without signing in; the songs
// come from the leader's phone, so the link shows something only while someone leads that set.
async function guestCodeFor(date) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("orhasharon-ws-live:" + date));
  return [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function guestLink(date) {
  return location.origin + location.pathname.replace(/[^/]*$/, "") + "live.html?c=" + (await guestCodeFor(date)) + "&d=" + date;
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

// while I lead: answer the guest page (songs + where we are)
async function guestServe() {
  if (sync.guestCh || !sync.date) return;
  const date = sync.date, code = await guestCodeFor(date);
  if (!sync.iLead || sync.guestCh || sync.date !== date) return;
  sync.guestCode = code;
  const ch = sb.channel("ws-guest-" + code, { config: { broadcast: { self: false }, presence: { key: "leader" } } });
  const push = () => { if (!sync.iLead) return; sendGuestSongs(true); send("state", buildState(), ch); };
  ch.on("broadcast", { event: "hello" }, push)
    .on("presence", { event: "sync" }, () => { const ps = ch.presenceState(); sync.screenOn = "screen" in ps; sync.guestCount = Object.keys(ps).filter((k) => k !== "leader" && k !== "screen").length; renderLive(); })
    .subscribe((status) => { if (status === "SUBSCRIBED") { ch.track({ leader: true }); push(); } });
  sync.guestCh = ch;
}
function guestUnserve() {
  if (sync.guestCh) sb.removeChannel(sync.guestCh);
  Object.assign(sync, { guestCh: null, guestCode: null, guestCount: 0, guestSongsSig: "", screenOn: false });
}

async function guestShare() {
  const url = await guestLink(sync.date);
  const text = "הצטרפות לסט ההלל (צפייה, בלי התחברות):";
  if (navigator.share) navigator.share({ title: "סט הלל", text, url }).catch(() => {});
  else navigator.clipboard?.writeText(url).then(() => toast("הלינק הועתק"), () => prompt("הלינק לסט:", url));
}

// ---------- "📣 send the live-set link to the team" (from the session dialog) ----------
const TEAM_ROLES = ["leader", "musician", "sound"];
const teamFor = (date) => state.signups
  .filter((s) => s.meeting_date === date && TEAM_ROLES.includes(s.role) && s.status !== "declined")
  .sort((a, b) => TEAM_ROLES.indexOf(a.role) - TEAM_ROLES.indexOf(b.role));

function teamText(date, url, firstName = "") {
  const mt = state.meetings.find((x) => x.iso === date);
  const ld = state.signups.find((s) => s.meeting_date === date && s.role === "leader");
  const leaderName = ld ? byId(ld.member_id)?.name : "";
  const when = `${mt ? meetingKind(mt) + " " : ""}${date.split("-").reverse().join("/")}`;
  return `היי ${firstName || "צוות"}! 🎶\n` +
    `הסט של ההלל ב*${when}* מוכן.\n` +
    `בזמן ההלל הלינק מראה את השיר הנוכחי בסולם הנכון, וזז יחד עם ${leaderName ? "*" + leaderName + "*" : "מוביל/ת ההלל"}. בלי התחברות:\n` +
    `${url}\n\n` +
    `אפשר לפתוח כבר עכשיו — הדף יתעדכן לבד כשהסט יתחיל. כדאי לשמור אותו במסך הבית.\n\n` +
    `_הודעה ממערכת OrHasharon/WorshipAndSound_`;
}

async function showTeamLinkDialog(date) {
  const url = await guestLink(date);
  const team = teamFor(date);
  // one row per person: "גיטרה ושירה", the leader keeps the leader's message
  const people = new Map();
  for (const s of team) {
    if (!people.has(s.member_id)) people.set(s.member_id, []);
    people.get(s.member_id).push(s);
  }
  const rows = [...people.entries()].map(([id, list]) => {
    const m = byId(id); if (!m) return "";
    const c = contactOf(id) || {};
    const isLeader = list.some((s) => s.role === "leader");
    const parts = [];
    for (const s of list) {
      const p = s.instrument ? s.instrument.trim() : SLOTS.find((x) => x.role === s.role)?.label || "";
      if (p && !parts.includes(p)) parts.push(p);
    }
    parts.sort((a, b) => (a === "שירה") - (b === "שירה")); // singing last
    const role = parts.length > 1 ? parts.slice(0, -1).join(", ") + " ו" + parts[parts.length - 1] : parts[0] || "";
    const first = m.name.split(" ")[0];
    const text = isLeader && typeof leadText === "function" ? leadText(date, first) : teamText(date, url, first);
    const wa = `https://wa.me/${c.phone ? waNumber(c.phone) : ""}?text=${encodeURIComponent(text)}`;
    return `<li class="team-row"><span><b>${esc(m.name)}</b> <small>${esc(role)}</small></span>
      ${isMe(id) ? `<small>(את/ה)</small>` : `<a class="btn wa" href="${wa}" target="_blank" rel="noopener" data-team-sent>${WA_ICON} ${c.phone ? "שליחה" : "בחירת נמען/ת"}</a>`}</li>`;
  }).join("");
  const group = teamText(date, url);
  let d = document.getElementById("team-dialog");
  if (!d) { d = document.createElement("dialog"); d.id = "team-dialog"; d.className = "setlist-dialog"; document.body.append(d); }
  d.innerHTML = `<div class="sl-box">
    <button class="sl-close" data-close-team aria-label="סגירה">✕</button>
    <h2>📣 לינק לסט החי לצוות</h2>
    <p class="hint">לינק אחד לכל המפגש, בלי התחברות. הוא מראה את השיר כשמישהו מוביל את הסט (פותח/ת "מצב הלל"). אפשר לשלוח כבר עכשיו.</p>
    <div class="sl-actions">
      <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(group)}" target="_blank" rel="noopener">${WA_ICON} לקבוצת הוואטסאפ</a>
      <button class="btn ghost" type="button" data-team-copy>📋 העתקת ההודעה</button>
    </div>
    ${rows ? `<p class="hint">או לכל אחד/ת בנפרד:</p><ul class="team-list">${rows}</ul>` : `<p class="status">אין עדיין משובצים להלל במפגש הזה.</p>`}
  </div>`;
  d._group = group;
  if (!d.open) d.showModal();
}
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-sl-team]")) { showTeamLinkDialog(setlist.openDate); return; }
  if (e.target.closest("[data-close-team]") || e.target.id === "team-dialog") { document.getElementById("team-dialog")?.close(); return; }
  if (e.target.closest("[data-team-copy]")) {
    const g = document.getElementById("team-dialog")?._group || "";
    navigator.clipboard?.writeText(g).then(() => toast("ההודעה הועתקה"), () => prompt("ההודעה:", g));
    return;
  }
  const sent = e.target.closest("[data-team-sent]");
  if (sent) sent.classList.add("sent");
});

// ---------- what the live view shows ----------
// the live bar: who leads + connection (always visible)
function syncStatusHtml() {
  if (!syncActive()) return "";
  const n = Object.keys(sync.people).length;
  const dot = `<span class="live-dot${sync.online ? " on" : ""}" title="${sync.online ? "מחובר/ת" : "מתחבר/ת…"}"></span>`;
  const who = sync.leader ? `👑 ${esc(sync.leader.name || "")}` : "אין מוביל/ה";
  const people = n === 1 ? "מחובר/ת 1" : `${n} מחוברים`;
  return `<button class="tool link live-who" data-live="people">${dot}${who} · ${people}${sync.guestCount ? ` + ${sync.guestCount} בלינק` : ""}${sync.screenOn ? " · 🖥️ מסך ✓" : ""}</button>`;
}
// quick actions next to it: the leader shares the link, a follower follows / not
function syncQuickHtml() {
  if (!syncActive()) return "";
  if (sync.iLead) return `<button class="tool" data-live="guest">🔗 לינק לצוות</button>`;
  return `<button class="tool${sync.follow ? " on" : ""}" data-live="follow">${sync.follow ? "עוקב/ת ✓" : "לא עוקב/ת"}</button>`;
}
// inside "⚙ תצוגה": my capo, take the lead, end the set
function syncPanelHtml() {
  if (!syncActive()) return "";
  let html = `<button class="tool${live.myCapo ? " on" : ""}" data-live="capo-me" title="קאפו אישי, רק אצלך">${live.myCapo ? "קאפו שלי: " + live.myCapo : "קאפו שלי"}</button>`;
  if (!sync.iLead && mayLead(sync.date)) html += `<button class="tool" data-live="lead">👑 לקחת הובלה</button>`;
  if (sync.iLead) html += `<button class="tool live-end${sync.endArm ? " on" : ""}" data-live="end">${sync.endArm ? "⏹ לחיצה נוספת = סיום לכולם" : "⏹ סיום הסט לכולם"}</button>`;
  return html;
}

function syncPeopleHtml() {
  if (!syncActive() || !sync.showPeople) return "";
  const rows = Object.entries(sync.people).map(([, metas]) => {
    const m = metas[0] || {};
    return `<li>${m.lead ? "👑 " : ""}${esc(m.name || "?")}</li>`;
  }).join("");
  return `<div class="live-people"><ul>${rows || "<li>אף אחד עדיין</li>"}</ul>${sync.guestCount ? `<p>+ ${sync.guestCount} אורחים בלינק</p>` : ""}</div>`;
}

function syncAwayHtml() {
  if (!syncActive() || sync.iLead) return "";
  if (sync.leader && !sync.people[leaderKey(sync.leader)]) return `<div class="live-away">המוביל/ה התנתק/ה · ממשיכים מאיפה שהיינו</div>`;
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
  if (a === "guest") { guestShare(); return true; }
  if (a === "end") {
    if (!sync.endArm) { sync.endArm = setTimeout(() => { sync.endArm = 0; renderLive(); }, 4000); return true; }
    clearTimeout(sync.endArm); sync.endArm = 0;
    syncEnd(); live.on = false; if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    return true;
  }
  if (a === "capo-me") { live.myCapo = ((live.myCapo || 0) + 1) % 8; try { localStorage.setItem("ws-live-capo", live.myCapo); } catch {} return true; }
  return false;
}
