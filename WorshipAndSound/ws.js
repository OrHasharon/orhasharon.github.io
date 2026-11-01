// WorshipAndSound: self sign-up for worship/sound teams + editable team info (Supabase, schema or_hasharon_worship)
const SUPABASE_URL = "https://pualpwrkztjzhgpaqudm.supabase.co";
const SUPABASE_KEY = "sb_publishable_TFMMqLxLWHatd3lXYrUlTQ_aO7MvaQ9";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { db: { schema: "or_hasharon_worship" } });

const SLOTS = [
  { role: "leader", label: "מוביל/ת הלל", max: 1, eligible: (m) => !!m.lead_frequency, why: "לא מסומן/ת כמוביל/ת הלל" },
  { role: "musician", label: "נגנים", max: Infinity, eligible: (m) => !!m.instruments, why: "לא רשומים כלים" },
  { role: "sound", label: "סאונד", max: 1, eligible: (m) => m.sound, why: "לא מסומן/ת כאיש/ת סאונד" },
  { role: "setup", label: "הקמת סאונד", max: 2, eligible: (m) => m.setup, why: "לא מסומן/ת כמקים/ה" },
];
const PAGE = 6;
const ME_KEY = "ws-me";

const state = { members: [], signups: [], meetings: [], tab: "signup", shown: PAGE, editing: null, picking: null };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byId = (id) => state.members.find((m) => m.id === id);
const instrumentsOf = (m) => (m.instruments || "").split(/[,/]/).map((s) => s.trim()).filter(Boolean);

let me = null;
try { me = Number(localStorage.getItem(ME_KEY)) || null; } catch {}

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

// ---------- who am I ----------
function renderMe() {
  const sel = $("me");
  sel.innerHTML = `<option value="">בחר/י את השם שלך…</option>` +
    state.members.map((m) => `<option value="${m.id}"${m.id === me ? " selected" : ""}>${esc(m.name)}</option>`).join("");
  $("me-hint").textContent = me ? "לחיצה על \"+ אני\" משבצת אותך, ועל ✕ מבטלת" : "בחירת השם מאפשרת לשבץ את עצמך";
}
$("me").addEventListener("change", (e) => {
  me = Number(e.target.value) || null;
  try { me ? localStorage.setItem(ME_KEY, me) : localStorage.removeItem(ME_KEY); } catch {}
  if (me) sb.from("usage_logs").insert({ visitor_name: byId(me)?.name, action: "identify" }).then(() => {});
  renderMe(); render();
});

// ---------- sign-up ----------
function renderSignup() {
  const upcoming = upcomingMeetings(state.meetings);
  if (!upcoming.length) { $("signup").innerHTML = `<p class="status">אין מפגשים קרובים בלוח</p>`; $("more").hidden = true; return; }
  $("signup").innerHTML = `<div class="meetings-list">${upcoming.slice(0, state.shown).map((mt, i) => meetingCard(mt, i === 0)).join("")}</div>`;
  $("more").hidden = upcoming.length <= state.shown;
}

function meetingCard(mt, isNext) {
  const rows = SLOTS.map((slot) => {
    const taken = state.signups.filter((s) => s.meeting_date === mt.iso && s.role === slot.role);
    const mineHere = taken.some((s) => s.member_id === me);
    const full = taken.length >= slot.max;
    const people = taken.map((s) => {
      const m = byId(s.member_id);
      const mine = s.member_id === me;
      return `<span class="person${mine ? " mine" : ""}">${esc(m?.name || "?")}${s.instrument ? ` <small>(${esc(s.instrument)})</small>` : ""}${mine ? `<button data-remove="${s.id}" title="ביטול השיבוץ" aria-label="ביטול">✕</button>` : ""}</span>`;
    }).join("");
    let action = "";
    const pickingHere = state.picking && state.picking.date === mt.iso;
    if (slot.role === "musician" && pickingHere) {
      const opts = instrumentsOf(byId(me));
      action = `<select class="inst-pick" data-date="${mt.iso}"><option value="">על מה תנגן/י?</option>${opts.map((o) => `<option>${esc(o)}</option>`).join("")}</select>`;
    } else if (!mineHere && !full) {
      action = `<button class="join" data-join="${slot.role}" data-date="${mt.iso}">+ אני</button>`;
    }
    const missing = !taken.length && slot.role !== "musician";
    const cap = slot.max === Infinity ? "" : `<small>${taken.length}/${slot.max}</small>`;
    return `<div class="slot${missing ? " missing" : ""}"><div class="slot-name">${slot.label}${cap}</div>
      <div class="slot-people">${people || (missing ? `<span class="empty">חסר</span>` : "")}${action}</div></div>`;
  }).join("");
  return `<article class="meeting-card${isNext ? " next" : ""}">
    <div class="meeting-head">${isNext ? `<span class="tag">המפגש הבא</span>` : ""}
      <h3>${meetingKind(mt.day)} · יום ${esc(mt.day)} ${mt.dateText.slice(0, 5)}</h3><span>${esc(mt.place)}</span></div>
    ${rows}</article>`;
}

async function join(role, date, instrument = null) {
  if (!me) { toast("קודם בחר/י את השם שלך למעלה"); $("me").focus(); return; }
  const m = byId(me);
  const slot = SLOTS.find((s) => s.role === role);
  if (!slot.eligible(m)) { toast(`${m.name} ${slot.why}. אפשר לעדכן בלשונית "הצוות"`); return; }
  if (role === "musician" && !instrument) {
    const opts = instrumentsOf(m);
    if (opts.length > 1) { state.picking = { date }; render(); return; }
    instrument = opts[0];
  }
  const { error } = await sb.from("signups").insert({ meeting_date: date, role, member_id: me, instrument });
  state.picking = null;
  if (error) toast(error.code === "23505" ? "כבר משובץ/ת בתפקיד הזה" : "השיבוץ נכשל, נסו שוב");
  else toast(`שובצת: ${slot.label} · ${date.split("-").reverse().slice(0, 2).join("/")}`);
  await refreshSignups(); render();
}

async function removeSignup(id) {
  const { error } = await sb.from("signups").delete().eq("id", id);
  if (error) toast("הביטול נכשל, נסו שוב"); else toast("השיבוץ בוטל");
  await refreshSignups(); render();
}

// ---------- team ----------
function ledRecently(memberId) {
  const now = new Date();
  const monthStart = isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const quarterStart = isoDate(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1));
  const leads = state.signups.filter((s) => s.member_id === memberId && s.role === "leader");
  return { month: leads.filter((s) => s.meeting_date >= monthStart).length, quarter: leads.filter((s) => s.meeting_date >= quarterStart).length };
}

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
  const led = ledRecently(m.id);
  const tags = [
    m.lead_frequency && `<span class="role-tag lead">מדריך/ה הלל · ${esc(m.lead_frequency)}</span>`,
    m.sound && `<span class="role-tag sound">סאונד</span>`,
    m.setup && `<span class="role-tag sound">הקמת סאונד</span>`,
  ].filter(Boolean).join("");
  return `<div class="member">
    <button class="link-btn edit" data-edit="${m.id}">עריכה</button>
    <h3>${esc(m.name)}</h3>
    ${m.instruments ? `<p>🎵 ${esc(m.instruments)}</p>` : ""}
    ${m.lead_frequency ? `<p>הדריך/ה החודש: ${led.month} · ברבעון: ${led.quarter}</p>` : ""}
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
  };
  const id = form.dataset.member;
  const { error } = id === "new" ? await sb.from("members").insert(row) : await sb.from("members").update(row).eq("id", Number(id));
  if (error) { toast(error.code === "23505" ? "השם הזה כבר קיים בצוות" : "השמירה נכשלה, נסו שוב"); return; }
  toast("נשמר");
  state.editing = null;
  await loadAll(); renderMe(); render();
}

async function deactivate(id) {
  const m = byId(id);
  if (!confirm(`להסיר את ${m.name} מהצוות? (השיבוצים הקיימים יישארו)`)) return;
  const { error } = await sb.from("members").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { toast("ההסרה נכשלה"); return; }
  if (me === id) { me = null; try { localStorage.removeItem(ME_KEY); } catch {} }
  state.editing = null;
  await loadAll(); renderMe(); render();
}

// ---------- shell ----------
function render() {
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
  $("signup").hidden = state.tab !== "signup";
  $("team").hidden = state.tab !== "team";
  if (state.tab === "signup") renderSignup(); else { $("more").hidden = true; renderTeam(); }
}

document.addEventListener("click", (e) => {
  const t = e.target;
  const tab = t.closest(".tabs button");
  if (tab) { state.tab = tab.dataset.tab; state.editing = null; render(); return; }
  if (t.closest("[data-join]")) { const b = t.closest("[data-join]"); join(b.dataset.join, b.dataset.date); return; }
  if (t.closest("[data-remove]")) { removeSignup(Number(t.closest("[data-remove]").dataset.remove)); return; }
  if (t.closest("[data-edit]")) { const v = t.closest("[data-edit]").dataset.edit; state.editing = v === "new" ? "new" : Number(v); render(); return; }
  if (t.closest("[data-cancel]")) { state.editing = null; render(); return; }
  if (t.closest("[data-deactivate]")) { deactivate(Number(t.closest("[data-deactivate]").dataset.deactivate)); return; }
});
document.addEventListener("change", (e) => {
  if (e.target.matches(".inst-pick") && e.target.value) join("musician", e.target.dataset.date, e.target.value);
});
document.addEventListener("submit", (e) => {
  if (e.target.matches("form[data-member]")) { e.preventDefault(); saveMember(e.target); }
});
$("more").addEventListener("click", () => { state.shown += PAGE; render(); });

loadAll()
  .then(() => {
    if (me && !byId(me)) me = null; // removed from the team since last visit
    $("status").textContent = "";
    renderMe(); render();
    sb.from("usage_logs").insert({ visitor_name: byId(me)?.name || null, action: "page_view" }).then(() => {});
  })
  .catch((err) => {
    console.error(err);
    $("status").textContent = err?.code === "PGRST106" || /schema/i.test(err?.message || "")
      ? "המערכת עדיין לא מחוברת למסד הנתונים (נדרשת הגדרה ב-Supabase)"
      : "שגיאה בטעינת הנתונים, נסו לרענן";
  });
