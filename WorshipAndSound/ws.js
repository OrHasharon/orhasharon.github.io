// WorshipAndSound (email sign-in + allow-list once login_migration.sql ran): sign-up for worship/sound teams + editable team info (Supabase, schema or_hasharon_worship)
const SUPABASE_URL = "https://pualpwrkztjzhgpaqudm.supabase.co";
const SUPABASE_KEY = "sb_publishable_TFMMqLxLWHatd3lXYrUlTQ_aO7MvaQ9";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: "or_hasharon_worship" },
  auth: { detectSessionInUrl: false }, // handled in consumeAuthRedirect()
});

const GROUP = "קבוצה";
const isGroup = (m) => !!m && m.notes === GROUP;
const GROUPS = ["נוער"];
const SLOTS = [
  { role: "leader", label: "מוביל/ת הלל", max: 1, eligible: (m) => isGroup(m) || (m.can_lead ?? !!m.lead_frequency), why: "לא מסומן/ת להנחייה" },
  { role: "musician", label: "נגנים ושירה", max: Infinity, eligible: (m) => isGroup(m) || !!m.instruments, why: "לא רשומים כלים" },
  { role: "sound", label: "סאונד", max: 1, eligible: (m) => m.sound, why: "לא מסומן/ת כאיש/ת סאונד" },
  { role: "setup", label: "הקמת סאונד", max: 2, eligible: (m) => m.setup, why: "לא מסומן/ת כמקים/ה" },
];
const PAGE = 6;
// Google Apps Script web app that emails invitations (see email/Code.gs). Empty = invitations off.
const INVITE_HOOK = "";

const state = { members: [], signups: [], meetings: [], tab: "signup", shown: PAGE, editing: null, picking: null }; // picking = {date, member} while choosing an instrument
const $ = (id) => document.getElementById(id);
// the WhatsApp mark (Simple Icons, CC0) on every "send by WhatsApp" button
// a check-mark icon (instead of the ✅ emoji) for "confirmed"
const CHECK_ICON = `<svg class="ok-icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11" fill="currentColor"/><path d="m7.4 12.4 3.1 3.1 6.2-6.6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const WA_ICON = `<svg class="wa-icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = (id) => state.members.find((m) => m.id === id) || state.former?.find((m) => m.id === id); // former = no longer active, still named in history
const BASE_INSTRUMENTS = ["פסנתר", "שירה", "גיטרה", "קחון", "בס", "כינור"];
// table columns: the base list + any instrument someone in the team plays + columns added in this visit
const extraInstruments = [];
const allInstruments = () => {
  const seen = new Set(BASE_INSTRUMENTS);
  for (const m of state.members) for (const x of instrumentsOf(m)) seen.add(x);
  for (const x of extraInstruments) seen.add(x);
  return [...seen];
};
const FREQS = ["פעם בשבוע", "פעם בשבועיים", "פעם ב-3 שבועות", "פעם בחודש", "פעם ברבעון"];
const ICONS = [["שירה", "🎤"], ["קלידים", "🎹"], ["פסנתר", "🎹"], ["קחון", "🪘"], ["תוף", "🥁"], ["תופ", "🥁"], ["כינור", "🎻"], ["בס", "🎸"], ["גיטרה", "🎸"]];
ICONS.unshift(["סקסופון", "🎷"]);
const icon = (inst) => (ICONS.find(([k]) => inst.includes(k)) || [, "🎵"])[1];
// guitars all show the guitar icon, so the text says which one: אקוסטית / בס / חשמלית
const instLabel = (inst) => /חשמל/.test(inst) ? "חשמלית" : /בס/.test(inst) ? "בס" : inst.trim() === "גיטרה" || /אקוסט/.test(inst) ? "אקוסטית" : inst;
// which colour family an instrument belongs to (ws.css .inst-*): the label, brackets and icon share it
const instKind = (inst) => /שירה/.test(inst) ? "vocal" : /קליד|פסנתר/.test(inst) ? "keys"
  : /תוף|תופ|קחון/.test(inst) ? "drum" : /גיטר|בס/.test(inst) ? "guitar" : "other";
const instHtml = (inst) => inst ? ` <small class="inst inst-${instKind(inst)}">(${[icon(inst), esc(instLabel(inst))].filter(Boolean).join(" ")})</small>` : "";
const instrumentsOf = (m) => (m.instruments || "").split(/[,/]/).map((s) => s.trim()).filter(Boolean);

function toast(text, { error = false } = {}) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast" + (error ? " toast-error" : ""); t.textContent = (error ? "⛔ " : "") + text;
  // an open modal dialog sits in the top layer above <body>, so the toast goes inside it to be seen
  ([...document.querySelectorAll("dialog[open]")].pop() || document.body).append(t);
  setTimeout(() => t.remove(), error ? 6000 : 3500);
}

// ---------- data ----------
function renameInstrument(from, to) {
  for (const m of state.members) {
    const list = instrumentsOf(m);
    if (!list.includes(from)) continue;
    m.instruments = [...new Set(list.map((x) => (x === from ? to : x)))].join(", ");
    sb.from("members").update({ instruments: m.instruments }).eq("id", m.id).then(() => {});
  }
  sb.from("signups").update({ instrument: to }).eq("instrument", from).then(() => {});
}

// every sign-up, past ones too (history); the server gives at most 1000 rows per request
async function fetchSignups() {
  let rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await sb.from("signups").select("*").order("id").range(from, from + 999);
    if (r.error) return r;
    rows = rows.concat(r.data);
    if (r.data.length < 1000) return { data: rows, error: null };
  }
}

async function loadAll() {
  const [members, signups, meetings, former] = await Promise.all([
    sb.from("members").select("*").eq("active", true).order("name"),
    fetchSignups(),
    loadMeetings(),
    sb.from("members").select("*").eq("active", false),
  ]);
  state.former = former.data || [];
  if (members.error) throw members.error;
  if (signups.error) throw signups.error;
  state.members = members.data;
  renameInstrument("תוף", "קחון");
  for (const name of GROUPS) {
    if (state.members.some((m) => m.name === name)) continue;
    const { data } = await sb.from("members").insert({ name, notes: GROUP, can_lead: true }).select().single();
    if (data) state.members.push(data);
  }
  state.signups = signups.data;
  const probe = await sb.from("signups").select("status").limit(1);
  state.invitesReady = !probe.error;
  if (state.invitesReady) await loadUsers();
  state.meetings = meetings;
}

async function refreshSignups() {
  const { data, error } = await fetchSignups();
  if (!error) state.signups = data;
}

// ---------- sign-up ----------
const takenIn = (date, role) => state.signups.filter((s) => s.meeting_date === date && s.role === role);
// instruments this person isn't already playing at that meeting
const freeInstruments = (m, date) => isGroup(m) ? (takenIn(date, "musician").some((s) => s.member_id === m.id) ? [] : [""]) : instrumentsOf(m).filter((x) => !takenIn(date, "musician").some((s) => s.member_id === m.id && s.instrument === x));

// people + picker for one role at one meeting; shared by the table (desktop) and the cards (phone)
function slotCell(mt, slot) {
  const taken = takenIn(mt.iso, slot.role);
  // history: who served, read only
  if (state.history) return { missing: false, taken, html: `<div class="slot-people">${taken.map((s) =>
    `<span class="person">${esc(byId(s.member_id)?.name || "?")}${instHtml(s.instrument)}</span>`).join("") || `<span class="empty">—</span>`}</div>` };
  const people = taken.map((s) => {
    const pending = s.status === "pending";
    return `<span class="person${pending ? " pending" : ""}"${pending ? ' title="נשלחה הזמנה, ממתין לאישור"' : ""}>${pending ? "⏳ " : s.invite_token && s.status === "confirmed" ? '<span class="ok" title="אושר">' + CHECK_ICON + '</span> ' : ""}${esc(byId(s.member_id)?.name || "?")}${instHtml(s.instrument)}${state.invitesReady && !isGroup(byId(s.member_id)) ? `<button data-notify="${s.id}" title="הודעה בוואטסאפ / מייל" aria-label="הודעה">${WA_ICON}</button>` : ""}<button data-remove="${s.id}" title="הסרה מהשיבוץ" aria-label="הסרה">✕</button></span>`;
  }).join("");
  let action = "";
  const picking = state.picking && state.picking.date === mt.iso && slot.role === "musician" ? byId(state.picking.member) : null;
  if (picking) {
    action = `<select class="assign inst-pick" data-date="${mt.iso}" data-member="${picking.id}"><option value="">${esc(picking.name)}: על מה?</option>${freeInstruments(picking, mt.iso).map((o) => `<option value="${esc(o)}">${icon(o)} ${esc(instLabel(o))}</option>`).join("")}</select>`;
  } else if (taken.length < slot.max) {
    const free = state.members.filter((m) => slot.eligible(m) && (slot.role === "musician" ? freeInstruments(m, mt.iso).length : !taken.some((s) => s.member_id === m.id)));
    if (free.length) action = `<select class="assign" data-role="${slot.role}" data-date="${mt.iso}"><option value="">+ שיבוץ</option>${free.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>`;
  }
  const missing = !taken.length && slot.role !== "musician";
  return { missing, taken, html: `<div class="slot-people">${people || (missing ? `<span class="empty">חסר</span>` : "")}${action}</div>` };
}

function summaryTable(upcoming) {
  return `<div class="summary"><div class="duty-table"><table>
    <thead><tr><th>תאריך</th>${SLOTS.map((s) => `<th>${s.label}</th>`).join("")}</tr></thead>
    <tbody>${upcoming.map((mt, i) => `<tr${i === 0 && !state.history ? ' class="next"' : ""}>
      <td class="when"><strong>${mt.dateText.slice(0, 5)}</strong><small>${meetingKind(mt)}</small>${typeof setlistButton === "function" ? setlistButton(mt.iso) : ""}</td>
      ${SLOTS.map((s) => { const c = slotCell(mt, s); return `<td class="${c.missing ? "missing" : ""}">${c.html}</td>`; }).join("")}</tr>`).join("")}</tbody>
  </table></div></div>`;
}

function renderSignup() {
  const bar = `<div class="signup-bar"><button class="history-btn" type="button" data-history aria-pressed="${!!state.history}">${state.history ? "← חזרה לשיבוצים" : "🕘 היסטוריה"}</button></div>`;
  if (state.history) {
    // past meetings that had sign-ups, newest first
    const now = new Date();
    const past = state.meetings.filter((m) => meetingEnd(m) <= now && state.signups.some((s) => s.meeting_date === m.iso)).reverse();
    $("signup").innerHTML = bar + (!past.length ? `<p class="status">עדיין אין מפגשים שעברו. אחרי המפגש הראשון הוא יופיע כאן.</p>` : summaryTable(past) +
      `<div class="cards-view"><div class="meetings-list">${past.slice(0, state.shown).map((mt) => meetingCard(mt, false)).join("")}</div></div>`);
    $("more").hidden = past.length <= state.shown;
    return;
  }
  const upcoming = upcomingMeetings(state.meetings);
  if (!upcoming.length) { $("signup").innerHTML = bar + `<p class="status">אין מפגשים קרובים בלוח</p>`; $("more").hidden = true; return; }
  $("signup").innerHTML = bar + summaryTable(upcoming) +
    `<div class="cards-view"><div class="meetings-list">${upcoming.slice(0, state.shown).map((mt, i) => meetingCard(mt, i === 0)).join("")}</div></div>`;
  $("more").hidden = upcoming.length <= state.shown;
}

function meetingCard(mt, isNext) {
  const slotHtml = (slot) => {
    const c = slotCell(mt, slot);
    const cap = slot.max === Infinity ? "" : `<small>${c.taken.length}/${slot.max}</small>`;
    return `<div class="slot${c.missing ? " missing" : ""}"><div class="slot-name">${slot.label}${cap}</div>${c.html}</div>`;
  };
  const group = (roles) => `<div class="slot-group">${SLOTS.filter((s) => roles.includes(s.role)).map(slotHtml).join("")}</div>`;
  const rows = `<div class="slot-groups">${group(["leader", "musician"])}${group(["sound", "setup"])}</div>`;
  return `<article class="meeting-card${isNext ? " next" : ""}">
    <div class="meeting-head">${isNext ? `<span class="tag">המפגש הבא</span>` : ""}
      <h3>${meetingKind(mt)} · יום ${esc(mt.day)} ${mt.dateText.slice(0, 5)}</h3><span>${esc(mt.place)}</span>${typeof setlistButton === "function" ? setlistButton(mt.iso) : ""}</div>
    ${rows}</article>`;
}

async function assign(role, date, memberId, instrument = null) {
  const m = byId(memberId);
  if (isGroup(m)) {
    // a group just goes on the schedule: confirmed, no message to send
    const { error } = await sb.from("signups").insert({ meeting_date: date, role, member_id: memberId });
    toast(error ? (error.code === "23505" ? `${m.name} כבר משובצ/ת כאן` : "השיבוץ נכשל, נסו שוב") : `${m.name} שובצו`);
    await refreshSignups(); render(); return;
  }
  if (role === "musician" && !instrument) {
    const opts = freeInstruments(m, date);
    if (opts.length > 1) { state.picking = { date, member: memberId }; render(); return; }
    instrument = opts[0];
  }
  // every sign-up (yours too) is pending ⏳ until the person confirms from the link; only then ✅
  const me = (typeof user !== "undefined" && user?.email || "").toLowerCase();
  const contact = state.invitesReady ? contactOf(memberId) : null;
  const self = isMe(memberId);
  const row = { meeting_date: date, role, member_id: memberId, instrument };
  if (state.invitesReady) Object.assign(row, { status: "pending", invite_token: crypto.randomUUID(), invited_by: me || null });
  const { error } = await sb.from("signups").insert(row);
  state.picking = null;
  if (error) toast(error.code === "23505" ? `${m.name} כבר משובץ/ת בתפקיד הזה` : "השיבוץ נכשל, נסו שוב");
  else if (state.invitesReady) {
    if (INVITE_HOOK && !self) fetch(INVITE_HOOK, { method: "POST", mode: "no-cors", body: JSON.stringify({ type: "invite", token: row.invite_token, from: myName() }) }).catch(() => {});
    showInviteDialog(m, contact, { role, instrument, date, token: row.invite_token, self, pending: true });
  } else toast(`${m.name} שובץ/ה`);
  await refreshSignups(); render();
}

// is this team member the person who is logged in?
function isMe(memberId) {
  const me = (typeof user !== "undefined" && user?.email || "").toLowerCase();
  return !!me && allowed.some((u) => u.email.toLowerCase() === me && u.member_id === memberId);
}
// a team member's contact details, from the users tab (phone + linked member)
const contactOf = (memberId) => allowed.find((u) => u.member_id === memberId) || null;
function waNumber(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  return d.startsWith("0") ? "972" + d.slice(1) : d;
}

function myName() {
  const me = (typeof user !== "undefined" && user?.email || "").toLowerCase();
  const mine = allowed.find((u) => u.email.toLowerCase() === me);
  return (mine && byId(mine.member_id)?.name) || (typeof user !== "undefined" && user?.user_metadata?.full_name) || me;
}

// the invitation goes out by the sender's own WhatsApp / email: one click each, nothing to set up
function inviteText(m, { role, instrument, date, token }) {
  const slot = SLOTS.find((s) => s.role === role);
  const base = location.origin + location.pathname.replace(/[^/]*$/, "") + "respond.html?t=" + token;
  const what = (role === "musician" ? "הלל" : slot.label) + (instrument ? ` (${instrument})` : "");
  const leader = state.signups.find((x) => x.meeting_date === date && x.role === "leader");
  const leaderName = leader ? byId(leader.member_id)?.name : "";
  const mt = state.meetings.find((x) => x.iso === date);
  const day = mt ? `${meetingKind(mt)}, ` : "";
  return `היי ${m.name.split(" ")[0]}! 👋\n` +
    `שובצת ל*${what}* ב${day}*${date.split("-").reverse().join("/")}*${mt?.place ? ` (${mt.place})` : ""}${leaderName ? `, בהובלת ${leaderName}` : ""}.\n` +
    `שיבץ/ה: ${myName()}\n\n` +
    `✅ לאישור: ${base}&a=yes\n` +
    `❌ לא אוכל (עם סיבה): ${base}&a=no\n\n` +
    `_הודעה ממערכת OrHasharon/WorshipAndSound_`;
}

function showInviteDialog(m, contact, inv, text = inviteText(m, inv), title = `${esc(m.name)} שובץ/ה, ממתין/ה לאישור ⏳`) {
  contact = contact || {};
  const wa = `https://wa.me/${contact.phone ? waNumber(contact.phone) : ""}?text=${encodeURIComponent(text)}`;
  const mail = contact.email ? `mailto:${contact.email}?subject=${encodeURIComponent("הזמנה לשיבוץ · אור השרון")}&body=${encodeURIComponent(text)}` : "";
  let d = document.getElementById("invite-dialog");
  if (!d) { d = document.createElement("dialog"); d.id = "invite-dialog"; d.className = "setlist-dialog"; document.body.append(d); }
  d.innerHTML = `<div class="sl-box">
    <button class="sl-close" data-close-invite aria-label="סגירה">✕</button>
    <h2>${title}</h2>
    <p class="hint">${contact.phone ? "ההודעה מוכנה לשליחה." : "אין מספר טלפון ל" + esc(m.name) + " בלשונית משתמשים: וואטסאפ ייפתח ותבחרו למי לשלוח."} ${inv.token && !inv.self ? "אישור או סירוב מהקישור מעדכנים את השיבוץ באתר." : ""}</p>
    <div class="sl-actions">
      <a class="btn wa" href="${wa}" target="_blank" rel="noopener">${WA_ICON} שליחה בוואטסאפ</a>
      ${mail ? `<a class="btn ghost" href="${mail}">✉️ שליחה במייל</a>` : ""}
      ${inv.token && inv.pending ? `<button class="btn ghost" type="button" data-no-confirm="${inv.token}">${CHECK_ICON} לא צריך אישור</button>` : ""}
    </div></div>`;
  if (!d.open) d.showModal();
}
function reminderText(m, { role, instrument, date }) {
  const slot = SLOTS.find((s) => s.role === role);
  const mt = state.meetings.find((x) => x.iso === date);
  const what = slot.label.replace("נגנים ושירה", "נגינה / שירה") + (instrument ? ` (${instrument})` : "");
  return `שלום ${m.name}, תזכורת: את/ה משובץ/ת ל${what} ב${mt ? meetingKind(mt) + " " : ""}${date.split("-").reverse().join("/")}${mt?.place ? `, ${mt.place}` : ""}. תודה!`;
}
document.addEventListener("click", (e) => {
  const n = e.target.closest("[data-notify]");
  if (n) {
    const sgn = state.signups.find((x) => x.id === Number(n.dataset.notify));
    const m = byId(sgn.member_id), c = contactOf(sgn.member_id);
    const inv = { role: sgn.role, instrument: sgn.instrument, date: sgn.meeting_date, token: sgn.invite_token, self: isMe(sgn.member_id), pending: sgn.status === "pending" };
    if (inv.token) showInviteDialog(m, c, inv, inviteText(m, inv), `הודעה ל${esc(m.name)}`);
    else showInviteDialog(m, c, inv, reminderText(m, inv), `הודעה ל${esc(m.name)}`);
    return;
  }
  if (e.target.closest("[data-close-invite]") || e.target.id === "invite-dialog") document.getElementById("invite-dialog")?.close();
  const nc = e.target.closest("[data-no-confirm]");
  if (nc) markConfirmed(nc.dataset.noConfirm);
});

// "no confirmation needed": the sign-up is confirmed right away, nothing waits for an answer
async function markConfirmed(token) {
  const { error } = await sb.from("signups").update({ status: "confirmed" }).eq("invite_token", token);
  if (error) { toast("העדכון נכשל, נסו שוב"); return; }
  document.getElementById("invite-dialog")?.close();
  toast("השיבוץ אושר ✅");
  await refreshSignups(); render();
}

async function removeSignup(id) {
  const sgn = state.signups.find((x) => x.id === id);
  const name = sgn ? byId(sgn.member_id)?.name : "";
  const when = sgn ? sgn.meeting_date.split("-").reverse().slice(0, 2).join("/") : "";
  if (!confirm(`להסיר את ${name || "המשובץ/ת"} מהשיבוץ${when ? " של " + when : ""}?`)) return;
  const { error } = await sb.from("signups").delete().eq("id", id);
  if (error) toast("ההסרה נכשלה, נסו שוב"); else toast("הוסר מהשיבוץ");
  await refreshSignups(); render();
}

// ---------- team: one editable row per person, like the team sheet ----------
function freqSelect(m, field) {
  const v = m[field] || "";
  const opts = ["", ...FREQS, ...(v && !FREQS.includes(v) ? [v] : [])]; // keep an older free-text value visible
  return `<select class="freq" data-id="${m.id}" data-field="${field}">${opts.map((o) => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${o ? esc(o) : "—"}</option>`).join("")}</select>`;
}
const box = (m, flag, on, off = false) => `<td class="cb"><input type="checkbox" data-id="${m.id}" data-flag="${esc(flag)}"${on ? " checked" : ""}${off ? " disabled" : ""}></td>`;

function renderTeam() {
  const INSTRUMENTS = allInstruments();
  const has = (m, inst) => instrumentsOf(m).includes(inst);
  // can_lead / participation_frequency arrive with team_matrix.sql; until then those columns can't be saved
  const ready = !state.members.length || "can_lead" in state.members[0];
  $("team").innerHTML = `<div class="team-section">
    ${ready ? "" : `<p class="db-warning">עמודות "הנחייה" ו"תכיפות השתתפות" עדיין לא פעילות: צריך להריץ ב-Supabase את הסקריפט team_matrix.sql. אחרי זה רעננו את הדף.</p>`}
    <div class="matrix-wrap"><table class="matrix">
      <thead><tr><th class="name">שם</th><th>הנחייה</th>${INSTRUMENTS.map((x) => `<th>${icon(x)}<br>${esc(instLabel(x))}</th>`).join("")}<th><button class="link-btn add-inst" data-add-instrument title="הוספת כלי">+ כלי</button></th>
        <th>תכיפות הדרכה</th><th>תכיפות השתתפות</th><th class="sep">🎚️<br>סאונד</th><th>🔌<br>הקמה</th><th></th></tr></thead>
      <tbody>${state.members.map((m) => `<tr>
        <td class="name"><button class="link-btn rename" data-rename="${m.id}" title="שינוי שם">${esc(m.name)}</button></td>
        ${box(m, "lead", m.can_lead ?? !!m.lead_frequency, !ready)}
        ${INSTRUMENTS.map((x) => box(m, "inst:" + x, has(m, x))).join("")}<td></td>
        <td>${freqSelect(m, "lead_frequency")}</td><td>${ready ? freqSelect(m, "participation_frequency") : "—"}</td>
        ${box(m, "sound", m.sound).replace('class="cb"', 'class="cb sep"')}${box(m, "setup", m.setup)}
        <td><button class="link-btn del" data-deactivate="${m.id}" title="הסרה מהצוות" aria-label="הסרה">✕</button></td>
      </tr>`).join("")}
      <tr class="add-row"><td class="name"><input id="new-member" placeholder="שם חדש…"></td><td colspan="${INSTRUMENTS.length + 7}"><button class="btn" data-add-member>הוספה</button></td></tr>
      </tbody></table></div>
    <p class="hint">כל שינוי נשמר מיד. לחיצה על שם מאפשרת לשנות אותו.</p></div>`;
}

async function updateMember(id, patch) {
  const { error } = await sb.from("members").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { toast(error.code === "23505" ? "השם הזה כבר קיים בצוות" : "השמירה נכשלה, נסו שוב"); await loadAll(); render(); return false; }
  Object.assign(byId(id), patch);
  toast("נשמר");
  return true;
}

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches(".matrix input[type=checkbox]")) {
    const m = byId(Number(t.dataset.id));
    const flag = t.dataset.flag;
    if (flag === "lead") updateMember(m.id, { can_lead: t.checked });
    else if (flag === "sound" || flag === "setup") updateMember(m.id, { [flag]: t.checked });
    else {
      const inst = flag.slice(5);
      const set = new Set(instrumentsOf(m));
      t.checked ? set.add(inst) : set.delete(inst);
      const cols = allInstruments();
      const ordered = [...cols.filter((x) => set.has(x)), ...[...set].filter((x) => !cols.includes(x))];
      updateMember(m.id, { instruments: ordered.join(", ") || null });
    }
  } else if (t.matches(".matrix .mail")) {
    const v = t.value.trim().toLowerCase();
    if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast("כתובת מייל לא תקינה"); return; }
    updateMember(Number(t.dataset.mail), { email: v || null });
  } else if (t.matches(".matrix .freq")) {
    updateMember(Number(t.dataset.id), { [t.dataset.field]: t.value || null });
  }
});

document.addEventListener("click", async (e) => {
  const rn = e.target.closest("[data-rename]");
  if (rn) {
    const m = byId(Number(rn.dataset.rename));
    const name = prompt("שם חדש:", m.name);
    if (name && name.trim() && name.trim() !== m.name && await updateMember(m.id, { name: name.trim() })) render();
    return;
  }
  if (e.target.closest("[data-add-instrument]")) {
    const name = (prompt("שם הכלי החדש:") || "").trim();
    if (!name) return;
    if (allInstruments().includes(name)) { toast("הכלי כבר בטבלה"); return; }
    extraInstruments.push(name); render(); toast(`נוסף "${name}". מסמנים מי מנגן בו והוא נשמר`);
    return;
  }
  if (e.target.closest("[data-add-member]")) {
    const name = $("new-member").value.trim();
    if (!name) { $("new-member").focus(); return; }
    const { error } = await sb.from("members").insert({ name });
    if (error) { toast(error.code === "23505" ? "השם הזה כבר קיים בצוות" : "ההוספה נכשלה"); return; }
    toast(`${name} נוסף/ה`); await loadAll(); render();
  }
});

async function deactivate(id) {
  const m = byId(id);
  if (!confirm(`להסיר את ${m.name} מהצוות? (השיבוצים הקיימים יישארו)`)) return;
  const { error } = await sb.from("members").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { toast("ההסרה נכשלה"); return; }
  state.editing = null;
  await loadAll(); render();
}

// ---------- users (admins only) ----------
let allowed = [];
let isAdmin = false;
let myMemberId = null; // the team member linked to the signed-in user (Users tab)

async function loadUsers() {
  const { data, error } = await sb.from("allowed_users").select("*").order("added_at");
  if (!error) allowed = data;
}

function renderUsers() {
  const self = (u) => u.email.toLowerCase() === user.email.toLowerCase();
  $("users").innerHTML = `<div class="team-section"><h2>משתמשים מורשים</h2>
    <p class="hint">רק כתובות שברשימה יכולות להיכנס לאתר.</p>
    <div class="duty-table users-table"><table><thead><tr><th>מייל</th>${state.invitesReady ? "<th>טלפון</th><th>איש/אשת צוות</th>" : ""}<th>תפקיד</th><th>נוסף ע״י</th><th></th></tr></thead><tbody>
    ${allowed.map((u) => `<tr><td dir="ltr">${esc(u.email)}</td>
      ${state.invitesReady ? `<td><input class="u-phone" type="tel" dir="ltr" data-u-phone="${esc(u.email)}" value="${esc(u.phone || "")}" placeholder="050-0000000"></td>
      <td><select class="u-member" data-u-member="${esc(u.email)}"><option value="">—</option>${[...state.members].sort((a, b) => a.name.localeCompare(b.name, "he")).map((m) => `<option value="${m.id}"${m.id === u.member_id ? " selected" : ""}>${esc(m.name)}</option>`).join("")}</select></td>` : ""}
      <td>${u.is_admin ? "מנהל/ת" : "משתמש/ת"}</td><td dir="ltr">${esc(u.added_by || "")}</td>
      <td>${self(u) ? "" : `<button class="link-btn" data-toggle-admin="${esc(u.email)}">${u.is_admin ? "הסרת ניהול" : "הפיכה למנהל/ת"}</button> · <button class="link-btn" data-del-user="${esc(u.email)}">הסרה</button>`}</td></tr>`).join("")}
    </tbody></table></div>
    <form class="add-user"><input name="email" type="email" required placeholder="name@gmail.com" dir="ltr">
      <label><input type="checkbox" name="admin"> מנהל/ת</label><button class="btn" type="submit">הוספה</button></form></div>`;
}

document.addEventListener("submit", async (e) => {
  if (!e.target.matches(".add-user")) return;
  e.preventDefault();
  const f = new FormData(e.target);
  const email = f.get("email").trim().toLowerCase();
  const { error } = await sb.from("allowed_users").insert({ email, is_admin: f.has("admin") });
  toast(error ? (error.code === "23505" ? "הכתובת כבר ברשימה" : "ההוספה נכשלה") : `${email} נוסף/ה`);
  await loadUsers(); render();
});
document.addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del-user]");
  const adm = e.target.closest("[data-toggle-admin]");
  if (del) {
    if (!confirm(`להסיר את ${del.dataset.delUser}?`)) return;
    const { error } = await sb.from("allowed_users").delete().eq("email", del.dataset.delUser);
    toast(error ? "ההסרה נכשלה" : "הוסר/ה"); await loadUsers(); render();
  } else if (adm) {
    const u = allowed.find((x) => x.email === adm.dataset.toggleAdmin);
    const { error } = await sb.from("allowed_users").update({ is_admin: !u.is_admin }).eq("email", u.email);
    toast(error ? "העדכון נכשל" : "עודכן"); await loadUsers(); render();
  }
});

document.addEventListener("change", async (e) => {
  const ph = e.target.closest("[data-u-phone]"), mm = e.target.closest("[data-u-member]");
  if (!ph && !mm) return;
  const email = (ph || mm).dataset[ph ? "uPhone" : "uMember"];
  const patch = ph ? { phone: ph.value.trim() || null } : { member_id: mm.value ? Number(mm.value) : null };
  if (ph && patch.phone && waNumber(patch.phone).length < 11) { toast("מספר טלפון לא תקין"); return; }
  const { error } = await sb.from("allowed_users").update(patch).eq("email", email);
  toast(error ? "השמירה נכשלה" : "נשמר");
  await loadUsers();
});

// ---------- shell ----------
function render() {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
  for (const id of ["signup", "team", "songs", "users"]) $(id).hidden = state.tab !== id;
  $("more").hidden = true;
  if (typeof renderHero === "function") renderHero(); // the upcoming assembly, above the tabs (next-card.js)
  if (state.tab === "signup") renderSignup();
  else if (state.tab === "team") renderTeam();
  else if (state.tab === "songs") renderSongs();
  else renderUsers();
}

document.addEventListener("click", (e) => {
  const t = e.target;
  const tab = t.closest(".tabs button");
  if (tab) { state.tab = tab.dataset.tab; state.editing = null; state.history = false; render(); return; }
  if (t.closest("[data-history]")) { state.history = !state.history; state.shown = PAGE; render(); return; }
  if (t.closest("[data-remove]")) { removeSignup(Number(t.closest("[data-remove]").dataset.remove)); return; }
  if (t.closest("[data-deactivate]")) { deactivate(Number(t.closest("[data-deactivate]").dataset.deactivate)); return; }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (!el.matches(".assign") || !el.value) return;
  if (el.matches(".inst-pick")) assign("musician", el.dataset.date, Number(el.dataset.member), el.value);
  else assign(el.dataset.role, el.dataset.date, Number(el.value));
});
$("more").addEventListener("click", () => { state.shown += PAGE; render(); });

// ---------- sign-in ----------
let user = null;

function showLogin() {
  $("login").hidden = false;
  document.querySelector(".tabs").hidden = true;
  $("signup").hidden = $("team").hidden = $("more").hidden = true;
  $("status").textContent = "";
  $("who").innerHTML = "";
}

const redirectTo = location.origin + location.pathname;

// email + password: no emails involved (needs "Confirm email" off in Supabase)
let pwMode = "in";
document.addEventListener("click", (e) => { const b = e.target.closest("#pw-login [data-mode]"); if (b) pwMode = b.dataset.mode; });
$("pw-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const email = f.get("email").trim().toLowerCase();
  const password = f.get("password");
  e.target.querySelectorAll("button").forEach((b) => (b.disabled = true));
  const res = pwMode === "up"
    ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
    : await sb.auth.signInWithPassword({ email, password });
  e.target.querySelectorAll("button").forEach((b) => (b.disabled = false));
  const err = res.error?.message || "";
  if (res.data?.session) { location.reload(); return; }
  let msg;
  if (/invalid login credentials/i.test(err)) msg = "מייל או סיסמה שגויים. אם זו הפעם הראשונה שלכם כאן, לחצו \"כניסה ראשונה: יצירת סיסמה\".";
  else if (/already registered|already exists/i.test(err)) msg = "למייל הזה כבר יש סיסמה. לחצו \"כניסה\". אם שכחתם אותה, השתמשו בקישור למייל למטה.";
  else if (/email not confirmed/i.test(err) || (pwMode === "up" && !err)) msg = "החשבון נוצר אבל Supabase עדיין דורש אישור במייל. צריך לכבות את Confirm email בהגדרות (ראו הוראות).";
  else if (/password/i.test(err)) msg = "הסיסמה צריכה להיות לפחות 6 תווים.";
  else msg = `הכניסה נכשלה: ${err}`;
  $("sent").hidden = false;
  $("sent").innerHTML = `<span class="login-error">${esc(msg)}</span>`;
});
$("magic-toggle").addEventListener("click", () => { $("email-login").hidden = !$("email-login").hidden; });

// email magic link (fallback, e.g. forgotten password)
$("email-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = new FormData(e.target).get("email").trim().toLowerCase();
  const btn = e.target.querySelector("button"); btn.disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  btn.disabled = false;
  if (error) {
    const wait = error.message.match(/after (\d+) seconds/);
    toast(wait ? `אפשר לשלוח שוב בעוד ${wait[1]} שניות` : /rate|limit/i.test(error.message) ? "נשלחו יותר מדי מיילים בשעה האחרונה. עדיף להיכנס עם סיסמה" : "השליחה נכשלה, בדקו את הכתובת ונסו שוב");
    return;
  }
  $("sent").hidden = false;
  $("sent").innerHTML = `נשלח מייל ל-<b dir="ltr">${esc(email)}</b>. פתחו אותו ולחצו על הקישור כדי להיכנס (אם לא הגיע, בדקו בתיקיית הספאם).`;
});

// Google is the sign-in; password / email-link forms stay hidden as a fallback
$("google").addEventListener("click", () => sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo } }));
document.addEventListener("click", (e) => {
  if (e.target.closest("#logout")) sb.auth.signOut().then(() => location.reload());
});

// the email link comes back as #access_token=… (or ?code=… / #error_description=…)
async function consumeAuthRedirect() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const query = new URLSearchParams(location.search);
  let err = hash.get("error_description") || query.get("error_description");
  try {
    if (hash.get("access_token") && hash.get("refresh_token")) {
      const { error } = await sb.auth.setSession({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token") });
      if (error) err = error.message;
    } else if (query.get("code")) {
      const { error } = await sb.auth.exchangeCodeForSession(query.get("code"));
      if (error) err = error.message;
    }
  } catch (e) { err = e.message; }
  if (location.hash || location.search) history.replaceState(null, "", location.pathname); // don't leave tokens in the address bar
  return err;
}

function loginProblem(msg) {
  if (!msg) return;
  const friendly = /expired|invalid|not found|used/i.test(msg) ? "קישור הכניסה פג תוקף או שכבר השתמשו בו. שלחו קישור חדש ולחצו עליו פעם אחת." : `הכניסה נכשלה: ${msg}`;
  $("sent").hidden = false;
  $("sent").innerHTML = `<span class="login-error">${esc(friendly)}</span>`;
}

// Before login_migration.sql runs there is no allowed_users table: keep the site open (as before).
async function loginEnabled() {
  const { error } = await sb.from("allowed_users").select("email").limit(1);
  return !(error && (error.code === "PGRST205" || error.code === "42P01"));
}

async function startOpen() {
  $("login").hidden = true;
  document.querySelector(".tabs").hidden = false;
  try {
    await loadAll();
    $("status").textContent = "";
    render();
    if (typeof loadSetlist === "function") loadSetlist().then(render);
    sb.from("usage_logs").insert({ action: "page_view" }).then(() => {});
  } catch (err) {
    console.error(err);
    $("status").textContent = "שגיאה בטעינת הנתונים, נסו לרענן";
  }
}

async function start() {
  if (!(await loginEnabled())) { await consumeAuthRedirect(); return startOpen(); }
  const authErr = await consumeAuthRedirect();
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user || null;
  if (!user) { showLogin(); loginProblem(authErr); return; }
  const { data: me, error: meErr } = await sb.from("allowed_users").select("*").ilike("email", user.email).maybeSingle();
  if (meErr?.code === "PGRST205" || meErr?.code === "42P01") {
    showLogin();
    $("email-login").hidden = true; $("google").hidden = true; $("pw-login").hidden = true; $("magic-toggle").hidden = true;
    $("noaccess").hidden = false;
    $("noaccess").innerHTML = `מחובר/ת בתור <b dir="ltr">${esc(user.email)}</b> ✓<br>אבל המערכת עדיין לא הוגדרה עד הסוף: צריך להריץ את סקריפט ההגדרה (auth_migration.sql) ב-Supabase. אחרי שהוא רץ, רעננו את הדף.<br><button class="link-btn" id="logout">התנתקות</button>`;
    return;
  }
  if (meErr || !me) {
    showLogin();
    $("email-login").hidden = true; $("pw-login").hidden = true; $("magic-toggle").hidden = true;
    $("google").hidden = true;
    $("noaccess").hidden = false;
    $("noaccess").innerHTML = `מחובר/ת בתור <b dir="ltr">${esc(user.email)}</b>, אבל הכתובת עדיין לא ברשימת המורשים. בקשו מאוריה להוסיף אותה.<br><button class="link-btn" id="logout">התחברות עם חשבון אחר</button>`;
    return;
  }
  isAdmin = me.is_admin; myMemberId = me.member_id ?? null;
  try { localStorage.setItem("oh-access", "1"); } catch {} // signed in here = no entry code on the community site (gate.js)
  document.querySelector('[data-tab="users"]').hidden = !isAdmin;
  if (isAdmin) await loadUsers();
  $("login").hidden = true;
  document.querySelector(".tabs").hidden = false;
  $("who").innerHTML = `${esc(user.user_metadata?.full_name || user.email)} · <button class="link-btn" id="logout">התנתקות</button>`;
  $("status").textContent = "טוען…";
  try {
    await loadAll();
    $("status").textContent = "";
    render();
    if (typeof loadSetlist === "function") loadSetlist().then(render);
    sb.from("usage_logs").insert({ visitor_name: user.email, action: "page_view" }).then(() => {});
  } catch (err) {
    console.error(err);
    $("status").textContent = "שגיאה בטעינת הנתונים, נסו לרענן";
  }
}
start();
