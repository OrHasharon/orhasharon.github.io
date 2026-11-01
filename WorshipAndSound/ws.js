// WorshipAndSound (Google sign-in required): sign-up for worship/sound teams + editable team info (Supabase, schema or_hasharon_worship)
const SUPABASE_URL = "https://pualpwrkztjzhgpaqudm.supabase.co";
const SUPABASE_KEY = "sb_publishable_TFMMqLxLWHatd3lXYrUlTQ_aO7MvaQ9";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "or_hasharon_worship" } });

const SLOTS = [
  { role: "leader", label: "מוביל/ת הלל", max: 1, eligible: (m) => !!m.lead_frequency, why: "לא מסומן/ת כמוביל/ת הלל" },
  { role: "musician", label: "נגנים ושירה", max: Infinity, eligible: (m) => !!m.instruments, why: "לא רשומים כלים" },
  { role: "sound", label: "סאונד", max: 1, eligible: (m) => m.sound, why: "לא מסומן/ת כאיש/ת סאונד" },
  { role: "setup", label: "הקמת סאונד", max: 2, eligible: (m) => m.setup, why: "לא מסומן/ת כמקים/ה" },
];
const PAGE = 6;

const state = { members: [], signups: [], meetings: [], tab: "signup", shown: PAGE, editing: null, picking: null }; // picking = {date, member} while choosing an instrument
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = (id) => state.members.find((m) => m.id === id);
const ICONS = [["שירה", "🎤"], ["קלידים", "🎹"], ["פסנתר", "🎹"], ["קחון", "🪘"], ["תוף", "🥁"], ["כינור", "🎻"], ["בס", "🎸"], ["גיטרה", "🎸"], ["חליל", "🪈"]];
const icon = (inst) => (ICONS.find(([k]) => inst.includes(k)) || [, "🎵"])[1];
const instHtml = (inst) => inst ? ` <small>(${icon(inst)} ${esc(inst)})</small>` : "";
const instrumentsOf = (m) => (m.instruments || "").split(/[,/]/).map((s) => s.trim()).filter(Boolean);

function toast(text) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

// ---------- data ----------
async function loadAll() {
  const since = new Date(); since.setDate(since.getDate() - 100); // enough history for "led this quarter"
  const [members, signups, meetings] = await Promise.all([
    sb.from("members").select("*").eq("active", true).order("name"),
    sb.from("signups").select("*").gte("meeting_date", isoDate(since)),
    loadMeetings(),
  ]);
  if (members.error) throw members.error;
  if (signups.error) throw signups.error;
  state.members = members.data;
  state.signups = signups.data;
  state.meetings = meetings;
}

async function refreshSignups() {
  const since = new Date(); since.setDate(since.getDate() - 100);
  const { data, error } = await sb.from("signups").select("*").gte("meeting_date", isoDate(since));
  if (!error) state.signups = data;
}

// ---------- sign-up ----------
const takenIn = (date, role) => state.signups.filter((s) => s.meeting_date === date && s.role === role);
// people + picker for one role at one meeting; shared by the table (desktop) and the cards (phone)
function slotCell(mt, slot) {
  const taken = takenIn(mt.iso, slot.role);
  const people = taken.map((s) => `<span class="person"${s.added_by ? ` title="שובץ ע״י ${esc(s.added_by)}"` : ""}>${esc(byId(s.member_id)?.name || "?")}${instHtml(s.instrument)}<button data-remove="${s.id}" title="הסרה מהשיבוץ" aria-label="הסרה">✕</button></span>`).join("");
  let action = "";
  const picking = state.picking && state.picking.date === mt.iso && slot.role === "musician" ? byId(state.picking.member) : null;
  if (picking) {
    action = `<select class="assign inst-pick" data-date="${mt.iso}" data-member="${picking.id}"><option value="">${esc(picking.name)}: על מה?</option>${instrumentsOf(picking).map((o) => `<option value="${esc(o)}">${icon(o)} ${esc(o)}</option>`).join("")}</select>`;
  } else if (taken.length < slot.max) {
    const free = state.members.filter((m) => slot.eligible(m) && !taken.some((s) => s.member_id === m.id));
    if (free.length) action = `<select class="assign" data-role="${slot.role}" data-date="${mt.iso}"><option value="">+ שיבוץ</option>${free.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}</select>`;
  }
  const missing = !taken.length && slot.role !== "musician";
  return { missing, taken, html: `<div class="slot-people">${people || (missing ? `<span class="empty">חסר</span>` : "")}${action}</div>` };
}

function summaryTable(upcoming) {
  return `<div class="summary"><div class="duty-table"><table>
    <thead><tr><th>תאריך</th>${SLOTS.map((s) => `<th>${s.label}</th>`).join("")}</tr></thead>
    <tbody>${upcoming.map((mt, i) => `<tr${i === 0 ? ' class="next"' : ""}>
      <td class="when"><strong>${mt.dateText.slice(0, 5)}</strong><small>${meetingKind(mt.day)}</small></td>
      ${SLOTS.map((s) => { const c = slotCell(mt, s); return `<td class="${c.missing ? "missing" : ""}">${c.html}</td>`; }).join("")}</tr>`).join("")}</tbody>
  </table></div></div>`;
}

function renderSignup() {
  const upcoming = upcomingMeetings(state.meetings);
  if (!upcoming.length) { $("signup").innerHTML = `<p class="status">אין מפגשים קרובים בלוח</p>`; $("more").hidden = true; return; }
  $("signup").innerHTML = summaryTable(upcoming) +
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
      <h3>${meetingKind(mt.day)} · יום ${esc(mt.day)} ${mt.dateText.slice(0, 5)}</h3><span>${esc(mt.place)}</span></div>
    ${rows}</article>`;
}

async function assign(role, date, memberId, instrument = null) {
  const m = byId(memberId);
  if (role === "musician" && !instrument) {
    const opts = instrumentsOf(m);
    if (opts.length > 1) { state.picking = { date, member: memberId }; render(); return; }
    instrument = opts[0];
  }
  const { error } = await sb.from("signups").insert({ meeting_date: date, role, member_id: memberId, instrument });
  state.picking = null;
  const slot = SLOTS.find((s) => s.role === role);
  if (error) toast(error.code === "23505" ? `${m.name} כבר משובץ/ת בתפקיד הזה` : "השיבוץ נכשל, נסו שוב");
  else toast(`${m.name} שובץ/ה: ${slot.label} · ${date.split("-").reverse().slice(0, 2).join("/")}`);
  await refreshSignups(); render();
}

async function removeSignup(id) {
  const { error } = await sb.from("signups").delete().eq("id", id);
  if (error) toast("ההסרה נכשלה, נסו שוב"); else toast("הוסר מהשיבוץ");
  await refreshSignups(); render();
}

// ---------- team ----------
function memberForm(m = {}) {
  return `<form data-member="${m.id || "new"}">
    <label class="field">שם<input name="name" required value="${esc(m.name)}"></label>
    <label class="field">כלים (מופרדים בפסיק)<input name="instruments" value="${esc(m.instruments)}" placeholder="לדוגמה: גיטרה, בס"></label>
    <label class="field">מדריך/ה הלל (תדירות, ריק = לא)<input name="lead_frequency" value="${esc(m.lead_frequency)}" placeholder="לדוגמה: פעם בחודש"></label>
    <div class="checks"><label><input type="checkbox" name="sound"${m.sound ? " checked" : ""}> איש/ת סאונד</label>
      <label><input type="checkbox" name="setup"${m.setup ? " checked" : ""}> מקים/ה סאונד</label></div>
    <label class="field">הערות<input name="notes" value="${esc(m.notes)}"></label>
    <div class="form-actions"><button class="btn" type="submit">שמירה</button><button class="btn ghost" type="button" data-cancel>ביטול</button>
      ${m.id ? `<button class="btn ghost" type="button" data-deactivate="${m.id}">הסרה מהצוות</button>` : ""}</div>
  </form>`;
}

function memberCard(m) {
  if (state.editing === m.id) return `<div class="member">${memberForm(m)}</div>`;
  const tags = [
    m.lead_frequency && `<span class="role-tag lead">מדריך/ה הלל · ${esc(m.lead_frequency)}</span>`,
    m.sound && `<span class="role-tag sound">סאונד</span>`,
    m.setup && `<span class="role-tag sound">הקמת סאונד</span>`,
  ].filter(Boolean).join("");
  return `<div class="member">
    <button class="link-btn edit" data-edit="${m.id}">עריכה</button>
    <h3>${esc(m.name)}</h3>
    ${instrumentsOf(m).map((x) => `<p class="inst">${icon(x)} ${esc(x)}</p>`).join("")}
    ${m.notes ? `<p>${esc(m.notes)}</p>` : ""}
    <div class="roles">${tags}</div>
  </div>`;
}

function renderTeam() {
  const worship = state.members.filter((m) => m.instruments || m.lead_frequency);
  const soundOnly = state.members.filter((m) => !m.instruments && !m.lead_frequency);
  $("team").innerHTML = `
    <div class="team-section"><h2>צוות הלל</h2><div class="team-grid">${worship.map(memberCard).join("")}</div></div>
    <div class="team-section"><h2>צוות סאונד</h2><div class="team-grid">${soundOnly.map(memberCard).join("")}</div>
      <p class="hint">חברי צוות הלל שעושים גם סאונד או הקמה מסומנים בכרטיס שלהם למעלה.</p></div>
    <div class="team-section"><h2>הוספת חבר/ת צוות</h2>
      ${state.editing === "new" ? `<div class="member">${memberForm()}</div>` : `<button class="join" data-edit="new">+ הוספה</button>`}</div>`;
}

async function saveMember(form) {
  const f = new FormData(form);
  const row = {
    name: f.get("name").trim(),
    instruments: f.get("instruments").trim() || null,
    lead_frequency: f.get("lead_frequency").trim() || null,
    sound: f.has("sound"), setup: f.has("setup"),
    notes: f.get("notes").trim() || null,
    updated_at: new Date().toISOString(),
    updated_by: user?.email || null,
  };
  const id = form.dataset.member;
  const { error } = id === "new" ? await sb.from("members").insert(row) : await sb.from("members").update(row).eq("id", Number(id));
  if (error) { toast(error.code === "23505" ? "השם הזה כבר קיים בצוות" : "השמירה נכשלה, נסו שוב"); return; }
  toast("נשמר");
  state.editing = null;
  await loadAll(); render();
}

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

async function loadUsers() {
  const { data, error } = await sb.from("allowed_users").select("*").order("added_at");
  if (!error) allowed = data;
}

function renderUsers() {
  const self = (u) => u.email.toLowerCase() === user.email.toLowerCase();
  $("users").innerHTML = `<div class="team-section"><h2>משתמשים מורשים</h2>
    <p class="hint">רק כתובות שברשימה יכולות להיכנס אחרי התחברות עם Google.</p>
    <div class="duty-table users-table"><table><thead><tr><th>מייל</th><th>תפקיד</th><th>נוסף ע״י</th><th></th></tr></thead><tbody>
    ${allowed.map((u) => `<tr><td dir="ltr">${esc(u.email)}</td><td>${u.is_admin ? "מנהל/ת" : "משתמש/ת"}</td><td dir="ltr">${esc(u.added_by || "")}</td>
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

// ---------- shell ----------
function render() {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
  for (const id of ["signup", "team", "songs", "users"]) $(id).hidden = state.tab !== id;
  $("more").hidden = true;
  if (state.tab === "signup") renderSignup();
  else if (state.tab === "team") renderTeam();
  else if (state.tab === "songs") renderSongs();
  else if (state.tab === "users") renderUsers();
}

document.addEventListener("click", (e) => {
  const t = e.target;
  const tab = t.closest(".tabs button");
  if (tab) { state.tab = tab.dataset.tab; state.editing = null; render(); return; }
  if (t.closest("[data-remove]")) { removeSignup(Number(t.closest("[data-remove]").dataset.remove)); return; }
  if (t.closest("[data-edit]")) { const v = t.closest("[data-edit]").dataset.edit; state.editing = v === "new" ? "new" : Number(v); render(); return; }
  if (t.closest("[data-cancel]")) { state.editing = null; render(); return; }
  if (t.closest("[data-deactivate]")) { deactivate(Number(t.closest("[data-deactivate]").dataset.deactivate)); return; }
});
document.addEventListener("change", (e) => {
  const el = e.target;
  if (!el.matches(".assign") || !el.value) return;
  if (el.matches(".inst-pick")) assign("musician", el.dataset.date, Number(el.dataset.member), el.value);
  else assign(el.dataset.role, el.dataset.date, Number(el.value));
});
document.addEventListener("submit", (e) => {
  if (e.target.matches("form[data-member]")) { e.preventDefault(); saveMember(e.target); }
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

$("google").addEventListener("click", () => {
  sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + location.pathname } });
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#logout")) sb.auth.signOut().then(() => location.reload());
});

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  user = session?.user || null;
  if (!user) { showLogin(); return; }
  const { data: me, error: meErr } = await sb.from("allowed_users").select("email,is_admin").ilike("email", user.email).maybeSingle();
  if (meErr || !me) {
    showLogin();
    $("google").hidden = true;
    $("noaccess").hidden = false;
    $("noaccess").innerHTML = `מחובר/ת בתור <b dir="ltr">${esc(user.email)}</b>, אבל הכתובת עדיין לא ברשימת המורשים. בקשו מאוריה להוסיף אותה.<br><button class="link-btn" id="logout">התחברות עם חשבון אחר</button>`;
    return;
  }
  isAdmin = me.is_admin;
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
    sb.from("usage_logs").insert({ visitor_name: user.email, action: "page_view" }).then(() => {});
  } catch (err) {
    console.error(err);
    $("status").textContent = "שגיאה בטעינת הנתונים, נסו לרענן";
  }
}
start();
