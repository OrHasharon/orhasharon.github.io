// Admin → "תורנות": which phones belong to each duty team (duty.sql → duty_teams), a preview of the weekly WhatsApp
// reminder, and the latest swaps. The reminder itself goes out automatically every Sunday at 10:00 from a job on Liah's
// computer (my-aios: automations/jobs/duty_reminder.py) — it reads the same teams and builds the same text as here.
// Uses sb / esc / $ / toast / user from admin.html, siteAcc / normPhone / fmtPhone / loadSiteAccess from site-access.js,
// loadMeetings / upcomingMeetings / meetingKind / dutyTeams / SATURDAY_TIMES from schedule.js.

const dutyAdm = { loaded: false, missing: false, teams: {}, swaps: [], meetings: [], open: null };

// dutyReminderText(firstName, meeting) lives in schedule.js (shared with duty-send.html)

async function dutyLoad() {
  if (!siteAcc.loaded) await loadSiteAccess();
  const [ms, t, s] = await Promise.all([
    loadMeetings().catch(() => []),
    sb.from("duty_teams").select("*"),
    sb.from("duty_swaps").select("*").order("created_at", { ascending: false }).limit(10),
  ]);
  dutyAdm.meetings = upcomingMeetings(ms);
  dutyAdm.missing = !!t.error;
  dutyAdm.teams = Object.fromEntries((t.data || []).map((r) => [r.name, r.phones || []]));
  dutyAdm.swaps = s.data || [];
  dutyAdm.loaded = true;
}

// "רנדי ומירי" → ["רנדי", "מירי"]; "משפחת רוז" → ["רוז"]; "חגית ואבירם" → ["חגית", "אבירם"]
function dutyTokens(team) {
  return team.replace(/משפחת|משפ'/g, " ").split(/[\s&+/]+/).map((w) => w.replace(/^ו(?=[א-ת]{2})/, "")).filter((w) => w.length >= 2);
}
// phones from the entry list whose name contains a token as a word
function dutySuggest(team) {
  const phones = siteAcc.phones || [];
  return dutyTokens(team).map((tok) => {
    const re = new RegExp(`(^|[\\s"'(])ו?${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s"'),.-])`);
    return { tok, hits: phones.filter((p) => re.test(" " + (p.name || "") + " ")) };
  }).map((x, _, all) => {
    // "אור וטימור": two people named אור — prefer the one who shares a surname with טימור (a couple / family)
    if (x.hits.length < 2) return x;
    const last = (n) => String(n || "").trim().split(/\s+/).pop();
    const fam = new Set(all.filter((y) => y !== x && y.hits.length === 1).map((y) => last(y.hits[0].name)));
    const same = x.hits.filter((h) => fam.has(last(h.name)));
    return same.length === 1 ? { tok: x.tok, hits: same } : x;
  });
}

const dutyName = (phone) => (siteAcc.phones || []).find((p) => p.phone === phone)?.name || fmtPhone(phone);

function renderDuty() {
  const el = $("adm-duty");
  if (!dutyAdm.loaded) { el.innerHTML = `<h2>תורנות</h2><p class="adm-hint">טוען…</p>`; dutyLoad().then(renderDuty); return; }
  if (dutyAdm.missing) {
    el.innerHTML = `<h2>תורנות</h2><p class="db-warning">כדי לשייך טלפונים לצוותים, לשלוח תזכורות ולאפשר החלפות, צריך להריץ ב-Supabase את <b dir="ltr">duty.sql</b>.</p>`;
    return;
  }
  const inRoster = new Set(dutyAdm.meetings.flatMap((m) => dutyTeams(m.duty)));
  // teams in the coming roster first, then teams saved here that aren't scheduled yet (e.g. a new team)
  const names = [...inRoster, ...Object.keys(dutyAdm.teams).filter((n) => !inRoster.has(n)).sort((a, b) => a.localeCompare(b, "he"))];
  const unmapped = [...inRoster].filter((n) => !(dutyAdm.teams[n] || []).length);
  const teamRow = (n) => {
    const saved = dutyAdm.teams[n] || [];
    const sug = saved.length ? [] : dutySuggest(n);
    const sugHtml = sug.map(({ tok, hits }) => hits.length === 1
      ? `<button class="duty-chip sug" data-duty-add="${esc(n)}" data-phone="${hits[0].phone}">＋ ${esc(hits[0].name)}</button>`
      : hits.length > 1 ? `<span class="duty-pick">"${esc(tok)}" — כמה אפשרויות: ${hits.map((h) => `<button class="duty-chip amb" data-duty-add="${esc(n)}" data-phone="${h.phone}">${esc(h.name)} <small dir="ltr">${fmtPhone(h.phone)}</small></button>`).join("")}</span>`
      : `<span class="duty-miss">"${esc(tok)}" לא נמצא/ה ברשימה</span>`).join("");
    const one = sug.length && sug.every((x) => x.hits.length === 1);
    return `<li class="duty-team${saved.length ? "" : " unmapped"}">
      <strong>${esc(n)}${inRoster.has(n) ? "" : ` <small class="adm-hint">(עוד לא משובץ/ת)</small> <button class="link-btn" data-duty-drop="${esc(n)}">מחיקת הצוות</button>`}</strong>
      <span class="duty-phones">${saved.map((p) => `<span class="duty-chip">${esc(dutyName(p))} <small dir="ltr">${fmtPhone(p)}</small> <button class="link-btn" data-duty-del="${esc(n)}" data-phone="${p}" aria-label="הסרה">✕</button></span>`).join("")}
        ${sugHtml}${one ? `<button class="adm-btn duty-all" data-duty-all="${esc(n)}">אישור ההתאמה</button>` : ""}</span>
      <select data-duty-pick="${esc(n)}" aria-label="הוספת טלפון ל${esc(n)}"><option value="">+ הוספה מהרשימה…</option>${(siteAcc.phones || []).map((p) => `<option value="${p.phone}">${esc(p.name || "")} · ${fmtPhone(p.phone)}</option>`).join("")}</select>
    </li>`;
  };
  // the coming week's reminder (Sunday → Saturday)
  const next = dutyAdm.meetings.filter((m) => dutyTeams(m.duty).length).slice(0, 2);
  const preview = next.map((m) => `<div class="duty-rem">
      <h4>${esc(meetingKind(m))} · ${m.dateText.slice(0, 5)} — ${esc(m.duty)}</h4>
      ${dutyTeams(m.duty).map((n) => (dutyAdm.teams[n] || []).map((p) => {
        const first = ((siteAcc.phones || []).find((x) => x.phone === p)?.name || "").trim().split(/\s+/)[0];
        return `<div class="duty-msg"><span>${esc(dutyName(p))}</span>
          <a class="adm-btn" target="_blank" rel="noopener" href="https://wa.me/${("972" + p.replace(/^0/, ""))}?text=${encodeURIComponent(dutyReminderText(first, m))}">שליחה ידנית</a></div>`;
      }).join("") || `<p class="duty-miss">${esc(n)}: אין טלפון — לא תצא תזכורת</p>`).join("")}
    </div>`).join("");
  const sample = next[0] ? dutyReminderText("[שם התורן/ית]", next[0]) : "";   // each message uses that person's own first name
  const swapRow = (s) => `<li><span>${s.from_date.slice(8, 10)}/${s.from_date.slice(5, 7)} ${esc(s.from_team)} ⇄ ${s.to_date.slice(8, 10)}/${s.to_date.slice(5, 7)} ${esc(s.to_team)}</span>
    <small>${{ pending: "ממתינה לאישור", approved: "אושרה ✓", declined: "נדחתה", cancelled: "בוטלה" }[s.status]} · ${esc(s.req_name || "")}</small>
    ${s.status === "approved" || s.status === "pending" ? `<button class="link-btn" data-duty-cancel="${s.id}">ביטול</button>` : ""}</li>`;
  el.innerHTML = `<h2>תורנות</h2>
    <p class="adm-hint">כל יום ראשון ב-10:00 מיכל מקבלת בוואטסאפ לינק לעמוד שליחה, ומשם שולחת לתורנים של השבוע מהוואטסאפ שלה, בלחיצה לכל אחד. לכל צוות צריך לשייך את הטלפונים שלו — פעם אחת.</p>
    ${unmapped.length ? `<p class="sa-alert" role="alert">⚠ בלי טלפון (לא יקבלו תזכורת ולא יוכלו להתחלף): ${unmapped.map(esc).join(", ")}</p>` : ""}
    <h3>צוותים וטלפונים</h3>
    <ul class="duty-teams">${names.map(teamRow).join("") || `<li>אין שיבוצים קרובים</li>`}</ul>
    <form class="duty-new" data-duty-new>
      <input name="team" maxlength="60" required placeholder="שם צוות חדש, למשל: דוד ושרה" aria-label="שם צוות חדש">
      <button class="adm-btn">+ הוספת צוות</button>
    </form>
    <p class="adm-hint">אחרי ההוספה משייכים לצוות טלפונים, והוא מופיע לבחירה בשיבוץ של מיכל.</p>
    <h3>התזכורת הקרובה</h3>
    ${sample ? `<pre class="duty-sample">${esc(sample)}</pre>` : ""}
    ${preview || `<p class="adm-hint">אין תורנות קרובה.</p>`}
    <h3>החלפות אחרונות</h3>
    <ul class="adm-list duty-swaps">${dutyAdm.swaps.map(swapRow).join("") || `<li class="adm-hint">עוד אין</li>`}</ul>`;
}

async function dutySave(team, phones) {
  const { error } = await sb.from("duty_teams").upsert({ name: team, phones, updated_at: new Date().toISOString() });
  if (error) { toast("השמירה נכשלה"); return; }
  dutyAdm.teams[team] = phones; renderDuty(); toast("נשמר");
}
document.addEventListener("click", async (e) => {
  const add = e.target.closest("[data-duty-add]"), del = e.target.closest("[data-duty-del]");
  const all = e.target.closest("[data-duty-all]"), cancel = e.target.closest("[data-duty-cancel]");
  if (add) { const n = add.dataset.dutyAdd; dutySave(n, [...new Set([...(dutyAdm.teams[n] || []), add.dataset.phone])]); }
  else if (del) { const n = del.dataset.dutyDel; dutySave(n, (dutyAdm.teams[n] || []).filter((p) => p !== del.dataset.phone)); }
  else if (all) { const n = all.dataset.dutyAll; dutySave(n, [...new Set(dutySuggest(n).map((x) => x.hits[0].phone))]); }
  else if (e.target.closest("[data-duty-drop]")) {
    const n = e.target.closest("[data-duty-drop]").dataset.dutyDrop;
    if (!confirm(`למחוק את הצוות "${n}"?`)) return;
    const { error } = await sb.from("duty_teams").delete().eq("name", n);
    if (error) { toast("המחיקה נכשלה"); return; }
    delete dutyAdm.teams[n]; renderDuty(); toast("נמחק");
  }
  else if (cancel) {
    if (!confirm("לבטל את ההחלפה? השיבוץ באתר יחזור למה שהיה.")) return;
    const { error } = await sb.from("duty_swaps").update({ status: "cancelled", decided_at: new Date().toISOString() }).eq("id", Number(cancel.dataset.dutyCancel));
    toast(error ? "הביטול נכשל" : "בוטל"); dutyAdm.loaded = false; renderDuty();
  }
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("[data-duty-new]");
  if (!f) return;
  e.preventDefault();
  const n = f.team.value.replace(/\s+/g, " ").trim().replace(/,/g, " ");   // a comma separates teams in the roster
  if (!n) return;
  if (dutyAdm.teams[n]) { toast("הצוות כבר קיים"); return; }
  dutySave(n, []);
});
document.addEventListener("change", (e) => {
  const s = e.target.closest("[data-duty-pick]");
  if (!s || !s.value) return;
  const n = s.dataset.dutyPick; dutySave(n, [...new Set([...(dutyAdm.teams[n] || []), s.value])]);
});

// "שיבוצים" tab: the same roster editor as Michal's page (duty-roster.js), saving straight to duty_roster
// (RLS: admins + duty contributors — duty.sql / duty_editors.sql). Teams come from duty_teams.
let rosterEd = null;
function renderRosterAdmin() {
  const el = $("adm-roster");
  if (!rosterEd) {
    el.innerHTML = `<h2>שיבוצים</h2>
      <p class="adm-hint">השיבוץ שמופיע באתר. כל שינוי נשמר מיד ומופיע לכולם. מיכל עורכת את אותו שיבוץ מהלינק שלה.</p>
      <div id="adm-roster-box"><p class="adm-hint">טוען…</p></div>`;
    rosterEd = dutyRosterEditor($("adm-roster-box"), {
      save: async (r) => {
        const { error } = await sb.from("duty_roster").upsert({ ...r, updated_at: new Date().toISOString(), updated_by: (user && user.email) || "admin" });
        return error ? { error: /duty_roster/.test(error.message || "") && /exist|find/i.test(error.message || "") ? "missing" : "save" } : {};
      },
      teams: async () => {
        const { data, error } = await sb.from("duty_teams").select("name, phones");
        if (error) throw error;
        return (data || []).map((t) => ({ name: t.name, phones: (t.phones || []).length })).sort((a, b) => a.name.localeCompare(b.name, "he"));
      },
      teamsHint: `צוות חדש מקבל טלפונים בלשונית "תורניות" → צוותים וטלפונים.`,
      onSaved: () => { dutyAdm.loaded = false; },   // the duty tab reloads with the new roster
    });
  }
  rosterEd.reload();
}
