// "The upcoming assembly" hero, above the tabs (on every tab): who leads, who plays what, sound and set-up,
// the songs, and big buttons — live, session, PowerPoint, PDF. Three columns on a wide screen, stacked on a phone.
// renderHero() is called from render() (ws.js). Uses state/esc/byId/takenIn/icon/instLabel/meetingKind/SLOTS from ws.js,
// setlist/itemsFor/openSetlist/buildPptx/printSongs/live/renderLive from setlist.js, syncStart/LIVE_SYNC_ON from live-sync.js.

// on a phone the card shows only the top (buttons + leader / sound / set-up); "more" opens the band and the songs
let heroOpen = false;
try { heroOpen = localStorage.getItem("ws-hero-open") === "1"; } catch {}

function renderHero() {
  const el = document.getElementById("hero");
  if (!el) return;
  const mt = upcomingMeetings(state.meetings)[0];
  el.hidden = !mt;
  el.innerHTML = mt ? nextMeetingCard(mt) : "";
}

function nextMeetingCard(mt) {
  if (!mt) return "";
  const iso = mt.iso;
  const who = (s) => {
    const m = byId(s.member_id);
    const pending = s.status === "pending";
    return `<span class="nc-name${pending ? " pending" : ""}"${pending ? ' title="ממתין/ה לאישור"' : ""}>${pending ? "⏳ " : ""}${esc(m?.name || "?")}</span>`;
  };
  const people = (role) => takenIn(iso, role);
  const missing = `<span class="nc-missing">עדיין חסר</span>`;
  const leaders = people("leader");

  // column 1: leader, sound, set-up
  const col1 = `
    <div class="nc-block nc-lead">
      <div class="nc-label">מוביל/ת הלל</div>
      <div class="nc-lead-name">${leaders.length ? "👑 " + leaders.map(who).join(", ") : missing}</div>
    </div>
    <div class="nc-block">
      <div class="nc-label">🎚️ סאונד</div>
      <div>${people("sound").map(who).join(", ") || missing}</div>
    </div>
    <div class="nc-block">
      <div class="nc-label">🔌 הקמת סאונד</div>
      <div>${people("setup").map(who).join(", ") || missing}</div>
    </div>`;

  // column 2: every instrument / voice with its player
  const band = people("musician");
  const col2 = `
    <div class="nc-block">
      <div class="nc-label">נגינה ושירה</div>
      ${band.length ? `<ul class="nc-band">${band.map((s) => `<li>
          <span class="nc-inst">${s.instrument ? `${icon(s.instrument)} ${esc(instLabel(s.instrument))}` : "🎵"}</span>
          ${who(s)}</li>`).join("")}</ul>` : missing}
    </div>`;

  // column 3: the songs + the big buttons
  const songs = setlist.ready ? itemsFor(iso).filter((i) => i.songs) : null;
  const has = !!songs?.length;
  const col3 = `
    <div class="nc-block">
      <div class="nc-label">🎵 שירים${has ? ` (${songs.length})` : ""}</div>
      ${songs === null ? `<p class="nc-muted">טוען…</p>`
        : has ? `<ol class="nc-songs">${songs.map((i) => `<li>${esc(i.songs.title)}${i.songs.song_key ? ` <small dir="ltr">${esc(i.songs.song_key)}</small>` : ""}</li>`).join("")}</ol>`
        : `<p class="nc-muted">עדיין לא נבחרו שירים.</p>`}
    </div>`;
  // empty set: one clear way forward instead of three greyed-out buttons
  const mine = typeof user !== "undefined" && user && canEditSetlist(iso);
  const actions = songs === null ? "" : !has ? `
    <div class="nc-actions">
      ${mine
        ? `<button class="btn nc-wide" data-nc="lead" data-date="${iso}">➕ בחירת שירים לסט</button>`
        : `<button class="btn ghost nc-wide" data-nc="session" data-date="${iso}">🎵 סשן הלל</button>`}
      <p class="nc-muted nc-wide nc-hint">${mine ? "את/ה מוביל/ה את האסיפה הזו. " : "מוביל/ת ההלל עוד לא בחר/ה שירים. "}כשיהיו שירים יופיעו כאן לייב, מצגת ו-PDF.</p>
    </div>` : `
    <div class="nc-actions">
      <button class="btn nc-live" data-nc="live" data-date="${iso}">▶ לייב</button>
      <button class="btn ghost" data-nc="session" data-date="${iso}">🎵 סשן הלל</button>
      <button class="btn ghost" data-nc="pptx" data-date="${iso}">📽️ מצגת</button>
      <button class="btn ghost" data-nc="pdf" data-date="${iso}">📄 PDF</button>
      ${typeof LIVE_SYNC_ON !== "undefined" && LIVE_SYNC_ON && (isAdmin || mine)
        ? `<button class="btn ghost nc-wide" data-nc="team" data-date="${iso}">📣 לינק לסט החי לצוות</button>` : ""}
    </div>`;

  const nBand = band.length, nSongs = has ? songs.length : 0;
  const more = `<button class="nc-more" data-nc="more" aria-expanded="${heroOpen}" aria-controls="nc-details">
      <span>${heroOpen ? "הסתרת הפירוט" : `נגינה ושירה${nBand ? ` (${nBand})` : ""} · שירים${nSongs ? ` (${nSongs})` : ""}`}</span>
      <span class="nc-chev" aria-hidden="true">▾</span></button>`;

  return `<section class="next-card${heroOpen ? " open" : ""}" aria-label="האסיפה הקרובה">
    <header class="nc-head">
      <span class="tag">האסיפה הקרובה</span>
      <h2>${esc(meetingKind(mt))} · יום ${esc(mt.day || "")} ${mt.dateText.slice(0, 5)}</h2>
      ${mt.place ? `<span class="nc-place">📍 ${esc(mt.place)}</span>` : ""}
    </header>
    <div class="nc-cols">
      <div class="nc-col nc-c1">${col1}</div>
      <div class="nc-more-wrap">${more}</div>
      <div class="nc-col nc-c2" id="nc-details">${col2}</div>
      <div class="nc-col nc-c3">${col3}</div>
      <div class="nc-col nc-act">${actions}</div>
    </div>
  </section>`;
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-nc]");
  if (!b) return;
  const iso = b.dataset.date, act = b.dataset.nc;
  setlist.openDate = iso;
  if (act === "more") {
    heroOpen = !heroOpen;
    try { localStorage.setItem("ws-hero-open", heroOpen ? "1" : "0"); } catch {}
    renderHero(); return;
  }
  if (act === "session") { openSetlist(iso); return; }
  if (act === "lead") { if (typeof showLeadScreen === "function") showLeadScreen(iso); else openSetlist(iso); return; }
  if (act === "team") { showTeamLinkDialog(iso); return; }
  if (act === "pdf") { printSongs(iso); return; }
  if (act === "pptx") {
    const label = b.textContent; b.disabled = true; b.textContent = "יוצר מצגת…";
    try { await buildPptx(iso); } catch (err) { console.error(err); toast("יצירת המצגת נכשלה"); }
    b.disabled = false; b.textContent = label; return;
  }
  if (act === "live") {
    Object.assign(live, { on: true, idx: 0 });
    document.documentElement.requestFullscreen?.().catch(() => {});
    renderLive();
    if (typeof syncStart === "function") syncStart(iso);
  }
});
