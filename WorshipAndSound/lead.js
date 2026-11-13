// The worship leader's own link: ?lead=YYYY-MM-DD opens one small screen for that meeting instead of the whole portal:
// the set (or "still empty" + quick add), "📣 live-set link for the team" and "▶ start the set".
// The date is caught by live-sync.js (LEAD_DATE, loaded before ws.js) and kept through the Google sign-in round trip;
// the screen opens once the data is in (leadAfterLoad, called at the end of loadSetlist).
// Uses sb/state/esc/toast/byId/myName/isAdmin/contactOf/waNumber/isMe from ws.js, songsState/loadSongs from songs.js,
// setlist/itemsFor/loadSetlist/canEditSetlist/openSetlist/live/renderLive from setlist.js, syncStart/teamText from live-sync.js.

const lead = { date: null, query: "", shown: false };

// the link a leader gets
function leadLink(date) {
  return location.origin + location.pathname.replace(/[^/]*$/, "") + "?lead=" + date;
}

function leadText(date, firstName = "") {
  const mt = state.meetings.find((x) => x.iso === date);
  const when = `${mt ? meetingKind(mt) + " " : ""}${date.split("-").reverse().join("/")}`;
  const n = itemsFor(date).filter((i) => i.songs).length;
  return `היי ${firstName}! 👑\n` +
    `את/ה מוביל/ה את ההלל ב*${when}*${mt?.place ? ` (${mt.place})` : ""}. תודה!\n\n` +
    `זה הלינק שלך להובלה: שם מזינים את השירים, שולחים לצוות את הלינק לסט החי, ובזמן ההלל לוחצים "התחלת הסט":\n` +
    `${leadLink(date)}\n\n` +
    (n ? `בסט כבר ${n} שירים 🎵` : `הסט עדיין ריק. אם אפשר, כדאי להזין את השירים כבר היום, כדי שהצוות יוכל להתכונן 🙏`) + `\n\n` +
    `_הודעה ממערכת OrHasharon/WorshipAndSound_`;
}

// called by loadSetlist(): open the leader screen once, after sign-in and data
function leadAfterLoad() {
  if (lead.shown || !LEAD_DATE || typeof user === "undefined" || !user || !state.meetings.length) return;
  lead.shown = true;
  try { sessionStorage.removeItem("ws-lead"); } catch {}
  showLeadScreen(LEAD_DATE);
}

function leadDialog() {
  let d = document.getElementById("lead-dialog");
  if (!d) { d = document.createElement("dialog"); d.id = "lead-dialog"; d.className = "setlist-dialog lead-dialog"; document.body.append(d); }
  return d;
}

async function showLeadScreen(date) {
  lead.date = date; lead.query = "";
  setlist.openDate = date;
  renderLeadScreen();
  if (!songsState.loaded) { await loadSongs(); renderLeadScreen(); }
}

function renderLeadScreen() {
  const date = lead.date, d = leadDialog();
  const mt = state.meetings.find((x) => x.iso === date);
  const when = `${mt ? meetingKind(mt) + " · " : ""}${date.split("-").reverse().join("/")}${mt?.place ? " · " + esc(mt.place) : ""}`;
  const ld = state.signups.find((s) => s.meeting_date === date && s.role === "leader");
  const leaderName = ld ? byId(ld.member_id)?.name : "";
  const mine = canEditSetlist(date);
  const items = itemsFor(date).filter((i) => i.songs);

  let body;
  if (!mine && !isAdmin) {
    body = `<p>הלינק הזה מיועד ל${leaderName ? "<b>" + esc(leaderName) + "</b>, " : ""}מוביל/ת ההלל של המפגש.</p>
      <p class="hint">את/ה מחובר/ת בתור <b dir="ltr">${esc(user?.email || "")}</b>${leaderName ? "" : ", ועדיין לא שובץ/ה מוביל/ה למפגש הזה"}.</p>`;
  } else {
    const list = items.length
      ? `<ol class="lead-songs">${items.map((i) => `<li>${esc(i.songs.title)}${i.songs.song_key ? ` <small dir="ltr">${esc(i.songs.song_key)}</small>` : ""}${i.notes ? ` <small>📝 ${esc(i.notes)}</small>` : ""}</li>`).join("")}</ol>`
      : `<p class="lead-empty">הסט עדיין ריק. כדאי להזין את השירים כבר עכשיו, כדי שהצוות יוכל להתכונן 🙏</p>`;
    const add = mine ? `
      <label class="field lead-add">הוספת שיר
        <input id="lead-search" type="search" placeholder="${songsState.loaded ? "חיפוש לפי שם השיר" : "טוען שירים…"}" value="${esc(lead.query)}" autocomplete="off">
      </label>
      <div id="lead-hits"></div>`
      : `<p class="hint">רק ${leaderName ? esc(leaderName) : "מוביל/ת ההלל"} יכול/ה להוסיף שירים לסט. אפשר להוביל ולשלוח לצוות.</p>`;
    body = `${list}${add}
      <div class="lead-actions">
        <button class="btn" data-lead-start ${items.length ? "" : "disabled"}>▶ התחלת הסט</button>
        <button class="btn ghost" data-sl-team ${items.length ? "" : "disabled"}>📣 לינק לסט החי לצוות</button>
        ${mine && items.length ? `<button class="btn ghost" data-lead-edit>✏️ סדר והערות</button>` : ""}
      </div>`;
  }
  d.innerHTML = `<div class="sl-box">
    <button class="sl-close" data-lead-close aria-label="סגירה">✕</button>
    <h2>👑 הובלת הלל</h2>
    <p class="lead-when">${when}${leaderName ? ` · בהובלת ${esc(leaderName)}` : ""}</p>
    ${body}
    <p class="lead-foot"><button class="link-btn" data-lead-close>לאתר המלא ←</button></p>
  </div>`;
  if (!d.open) d.showModal();
  renderLeadHits();
}

// only the results change while typing (re-drawing the input would break Hebrew typing on phones)
function renderLeadHits() {
  const box = document.getElementById("lead-hits");
  if (!box) return;
  const q = lead.query.trim();
  const inSet = new Set(itemsFor(lead.date).map((i) => i.song_id));
  const hits = q && songsState.loaded ? songsState.list.filter((s) => s.title.includes(q) && !inSet.has(s.id)).slice(0, 8) : [];
  box.innerHTML = !q ? "" : hits.length
    ? `<ul class="lead-hits">${hits.map((s) => `<li><button class="link-btn" data-lead-add="${s.id}">➕ ${esc(s.title)}${s.song_key ? ` <small dir="ltr">${esc(s.song_key)}</small>` : ""}</button></li>`).join("")}</ul>`
    : `<p class="hint">לא נמצא שיר בשם הזה. שירים חדשים מוסיפים בלשונית "שירים" באתר המלא.</p>`;
}

document.addEventListener("input", (e) => {
  if (e.target.id !== "lead-search") return;
  lead.query = e.target.value;
  renderLeadHits();
});

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.closest("[data-lead-close]") || t.id === "lead-dialog") { leadDialog().close(); render(); return; }
  const add = t.closest("[data-lead-add]");
  if (add) {
    const date = lead.date;
    if (!canEditSetlist(date)) { leaderOnly(date); return; }
    if (add.disabled) return;
    add.disabled = true;
    await loadSetlist();
    if (itemsFor(date).some((i) => i.song_id === Number(add.dataset.leadAdd))) { toast("השיר כבר בסט"); add.disabled = false; return; }
    const pos = Math.max(0, ...itemsFor(date).map((i) => i.position)) + 1;
    const { error } = await sb.from("setlist_items").insert({ meeting_date: date, song_id: Number(add.dataset.leadAdd), position: pos, notes: null });
    if (error) { error.code === "42501" ? leaderOnly(date) : toast("ההוספה נכשלה"); add.disabled = false; return; }
    await loadSetlist();
    lead.query = "";
    renderLeadScreen();
    toast("השיר נוסף לסט");
    document.getElementById("lead-search")?.focus();
    return;
  }
  const open = t.closest("[data-lead-open]");
  if (open) { showLeadScreen(open.dataset.leadOpen); return; }
  if (t.closest("[data-lead-edit]")) { leadDialog().close(); openSetlist(lead.date); return; }
  if (t.closest("[data-lead-start]")) {
    leadDialog().close();
    startLive(lead.date);
    // an admin who opened the leader screen means to lead: take it once the channel is up
    if (isAdmin && !canEditSetlist(lead.date)) {
      const t0 = Date.now(), iv = setInterval(() => {
        if (sync.online && !sync.iLead) { clearInterval(iv); claimLead(); }
        else if (sync.iLead || Date.now() - t0 > 8000 || !live.on) clearInterval(iv);
      }, 300);
    }
  }
});
