// WorshipAndSound (email sign-in + allow-list once login_migration.sql ran): sign-up for worship/sound teams + editable team info (Supabase, schema or_hasharon_worship)
const SUPABASE_URL = "https://pualpwrkztjzhgpaqudm.supabase.co";
const SUPABASE_KEY = "sb_publishable_TFMMqLxLWHatd3lXYrUlTQ_aO7MvaQ9";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: "or_hasharon_worship" },
  auth: { detectSessionInUrl: false }, // handled in consumeAuthRedirect()
});

const SLOTS = [
  { role: "leader", label: "מוביל/ת הלל", max: 1, eligible: (m) => m.can_lead ?? !!m.lead_frequency, why: "לא מסומן/ת להנחייה" },
  { role: "musician", label: "נגנים ושירה", max: Infinity, eligible: (m) => !!m.instruments, why: "לא רשומים כלים" },
  { role: "sound", label: "סאונד", max: 1, eligible: (m) => m.sound, why: "לא מסומן/ת כאיש/ת סאונד" },
  { role: "setup", label: "הקמת סאונד", max: 2, eligible: (m) => m.setup, why: "לא מסומן/ת כמקים/ה" },
];
const PAGE = 6;

const state = { members: [], signups: [], meetings: [], tab: "signup", shown: PAGE, editing: null, picking: null }; // picking = {date, member} while choosing an instrument
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = (id) => state.members.find((m) => m.id === id);
const INSTRUMENTS = ["פסנתר", "שירה", "גיטרה", "תוף", "בס", "חליל", "כינור"];
const FREQS = ["פעם בשבוע", "פעם בשבועיים", "פעם ב-3 שבועות", "פעם בחודש", "פעם ברבעון"];
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
  const people = taken.map((s) => `<span class="person">${esc(byId(s.member_id)?.name || "?")}${instHtml(s.instrument)}<button data-remove="${s.id}" title="הסרה מהשיבוץ" aria-label="הסרה">✕</button></span>`).join("");
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
      <td class="when"><strong>${mt.dateText.slice(0, 5)}</strong><small>${meetingKind(mt.day)}</small>${typeof setlistButton === "function" ? setlistButton(mt.iso) : ""}</td>
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
      <h3>${meetingKind(mt.day)} · יום ${esc(mt.day)} ${mt.dateText.slice(0, 5)}</h3><span>${esc(mt.place)}</span>${typeof setlistButton === "function" ? setlistButton(mt.iso) : ""}</div>
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

// ---------- team: one editable row per person, like the team sheet ----------
function freqSelect(m, field) {
  const v = m[field] || "";
  const opts = ["", ...FREQS, ...(v && !FREQS.includes(v) ? [v] : [])]; // keep an older free-text value visible
  return `<select class="freq" data-id="${m.id}" data-field="${field}">${opts.map((o) => `<option value="${esc(o)}"${o === v ? " selected" : ""}>${o ? esc(o) : "—"}</option>`).join("")}</select>`;
}
const box = (m, flag, on, off = false) => `<td class="cb"><input type="checkbox" data-id="${m.id}" data-flag="${esc(flag)}"${on ? " checked" : ""}${off ? " disabled" : ""}></td>`;

function renderTeam() {
  const has = (m, inst) => instrumentsOf(m).includes(inst);
  // can_lead / participation_frequency arrive with team_matrix.sql; until then those columns can't be saved
  const ready = !state.members.length || "can_lead" in state.members[0];
  $("team").innerHTML = `<div class="team-section">
    ${ready ? "" : `<p class="db-warning">עמודות "הנחייה" ו"תכיפות השתתפות" עדיין לא פעילות: צריך להריץ ב-Supabase את הסקריפט team_matrix.sql. אחרי זה רעננו את הדף.</p>`}
    <div class="matrix-wrap"><table class="matrix">
      <thead><tr><th class="name">שם</th><th>הנחייה</th>${INSTRUMENTS.map((x) => `<th>${icon(x)}<br>${x}</th>`).join("")}
        <th>תכיפות הדרכה</th><th>תכיפות השתתפות</th><th class="sep">🎚️<br>סאונד</th><th>🔌<br>הקמה</th><th></th></tr></thead>
      <tbody>${state.members.map((m) => `<tr>
        <td class="name"><button class="link-btn rename" data-rename="${m.id}" title="שינוי שם">${esc(m.name)}</button></td>
        ${box(m, "lead", m.can_lead ?? !!m.lead_frequency, !ready)}
        ${INSTRUMENTS.map((x) => box(m, "inst:" + x, has(m, x))).join("")}
        <td>${freqSelect(m, "lead_frequency")}</td><td>${ready ? freqSelect(m, "participation_frequency") : "—"}</td>
        ${box(m, "sound", m.sound).replace('class="cb"', 'class="cb sep"')}${box(m, "setup", m.setup)}
        <td><button class="link-btn del" data-deactivate="${m.id}" title="הסרה מהצוות" aria-label="הסרה">✕</button></td>
      </tr>`).join("")}
      <tr class="add-row"><td class="name"><input id="new-member" placeholder="שם חדש…"></td><td colspan="${INSTRUMENTS.length + 6}"><button class="btn" data-add-member>הוספה</button></td></tr>
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
      const ordered = [...INSTRUMENTS.filter((x) => set.has(x)), ...[...set].filter((x) => !INSTRUMENTS.includes(x))];
      updateMember(m.id, { instruments: ordered.join(", ") || null });
    }
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

async function loadUsers() {
  const { data, error } = await sb.from("allowed_users").select("*").order("added_at");
  if (!error) allowed = data;
}

function renderUsers() {
  const self = (u) => u.email.toLowerCase() === user.email.toLowerCase();
  $("users").innerHTML = `<div class="team-section"><h2>משתמשים מורשים</h2>
    <p class="hint">רק כתובות שברשימה יכולות להיכנס לאתר.</p>
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
  else renderUsers();
}

document.addEventListener("click", (e) => {
  const t = e.target;
  const tab = t.closest(".tabs button");
  if (tab) { state.tab = tab.dataset.tab; state.editing = null; render(); return; }
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
  const { data: me, error: meErr } = await sb.from("allowed_users").select("email,is_admin").ilike("email", user.email).maybeSingle();
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
    if (typeof loadSetlist === "function") loadSetlist().then(render);
    sb.from("usage_logs").insert({ visitor_name: user.email, action: "page_view" }).then(() => {});
  } catch (err) {
    console.error(err);
    $("status").textContent = "שגיאה בטעינת הנתונים, נסו לרענן";
  }
}
start();
