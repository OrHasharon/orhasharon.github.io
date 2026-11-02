// Worship sessions: ordered songs + notes per meeting, opened from the signup tab, exported to PowerPoint.
// Uses sb / esc / toast / state / render from ws.js and songsState / renderSongs / songMeta from songs.js.
const setlist = { items: [], ready: false, missing: false, openDate: null };

async function loadSetlist() {
  const { data, error } = await sb.from("setlist_items").select("*, songs(*)").order("position");
  if (error) { setlist.missing = error.code === "PGRST205" || error.code === "42P01" || error.code === "PGRST200"; setlist.ready = true; return; }
  setlist.items = data; setlist.ready = true; setlist.missing = false;
}
const itemsFor = (iso) => setlist.items.filter((i) => i.meeting_date === iso).sort((a, b) => a.position - b.position || a.id - b.id);

// small button shown next to each meeting in the signup tab (called from ws.js)
function setlistButton(iso) {
  if (!setlist.ready || setlist.missing) return "";
  const n = itemsFor(iso).length;
  return `<button class="setlist-btn${n ? " has" : ""}" data-open-setlist="${iso}">🎵 סשן הלל${n ? ` (${n})` : ""}</button>`;
}

// ---------- dialog ----------
function dialogEl() {
  let d = document.getElementById("setlist-dialog");
  if (!d) { d = document.createElement("dialog"); d.id = "setlist-dialog"; d.className = "setlist-dialog"; document.body.append(d); }
  return d;
}

function renderSetlistDialog() {
  const iso = setlist.openDate;
  const mt = state.meetings.find((m) => m.iso === iso);
  const items = itemsFor(iso);
  const d = dialogEl();
  d.innerHTML = `<div class="sl-box">
    <button class="sl-close" data-close-setlist aria-label="סגירה">✕</button>
    <h2>סשן הלל · ${mt ? `${meetingKind(mt.day)} ${mt.dateText.slice(0, 5)}` : iso.split("-").reverse().join("/")}</h2>
    ${items.length ? `<ol class="sl-list">${items.map((it, k) => `<li>
        <div class="sl-row">
          <span class="sl-num">${k + 1}</span>
          <button class="sl-title" data-open-song="${it.song_id}">${esc(it.songs?.title || "שיר שנמחק")}</button>
          ${it.songs?.song_key ? `<small dir="ltr">${esc(it.songs.song_key)}</small>` : ""}
          <span class="sl-tools">
            <button data-sl-move="${it.id}" data-dir="-1" ${k === 0 ? "disabled" : ""} title="למעלה">▲</button>
            <button data-sl-move="${it.id}" data-dir="1" ${k === items.length - 1 ? "disabled" : ""} title="למטה">▼</button>
            <button data-sl-remove="${it.id}" title="הסרה">✕</button>
          </span>
        </div>
        <input class="sl-note" data-sl-note="${it.id}" value="${esc(it.notes || "")}" placeholder="הערה (למשל: פזמון פעמיים, מעבר ל-D)">
      </li>`).join("")}</ol>` : `<p class="status">עדיין אין שירים בסשן. מוסיפים מלשונית "שירים" ← פתיחת שיר ← "לסשן הלל".</p>`}
    <div class="sl-actions">
      <button class="btn" data-sl-pptx ${items.length ? "" : "disabled"}>📽️ הורדת מצגת PowerPoint</button>
      <a id="sl-download" class="link-btn" hidden></a>
    </div>
  </div>`;
  if (!d.open) d.showModal();
}

async function openSetlist(iso) {
  setlist.openDate = iso;
  await loadSetlist();
  renderSetlistDialog();
}

// ---------- add a song (from the song page) ----------
function addToSetlistDialog(song) {
  const upcoming = upcomingMeetings(state.meetings);
  const d = dialogEl();
  d.innerHTML = `<div class="sl-box">
    <button class="sl-close" data-close-setlist aria-label="סגירה">✕</button>
    <h2>הוספת "${esc(song.title)}" לסשן הלל</h2>
    <label class="field">מפגש<select id="sl-date">${upcoming.map((m) => `<option value="${m.iso}">${meetingKind(m.day)} · ${m.dateText.slice(0, 5)} · ${esc(m.place)}</option>`).join("")}</select></label>
    <label class="field">הערה (לא חובה)<input id="sl-new-note" placeholder="למשל: בסולם D, פזמון פעמיים"></label>
    <div class="sl-actions"><button class="btn" data-sl-add="${song.id}">הוספה</button></div>
  </div>`;
  if (!d.open) d.showModal();
}

// ---------- PowerPoint ----------
// stanzas of clean lyric lines, each tagged with its section label ({פזמון}) if any
function lyricStanzas(content) {
  const stanzas = [{ label: "", lines: [] }];
  for (const raw of content.split("\n")) {
    const t = raw.trim();
    if (/^\{\s*(capo|artist|key)\s*:/i.test(t)) continue;
    const label = t.match(/^\{(.+)\}$/);
    if (label) { if (stanzas[stanzas.length - 1].lines.length) stanzas.push({ label: "", lines: [] }); stanzas[stanzas.length - 1].label = label[1]; continue; }
    const line = fixNiqqud(raw.replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim());
    if (!line) { if (stanzas[stanzas.length - 1].lines.length) stanzas.push({ label: "", lines: [] }); continue; }
    if (!/[\u05D0-\u05EAa-zA-Z]{2}/.test(line)) continue; // chord-only rows
    stanzas[stanzas.length - 1].lines.push(line);
  }
  return stanzas.filter((s) => s.lines.length);
}

// split a stanza into slides of at most 4 lines, as evenly as possible (5 -> 3+2, not 4+1)
function chunks(lines, max = 4) {
  const n = Math.ceil(lines.length / max), size = Math.ceil(lines.length / n), out = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}

async function imageData(url, width) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = width; c.height = Math.round(width * img.naturalHeight / img.naturalWidth);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png"); // PptxGenJS stores images as .png
}

// Layout copied from the community's own deck (מצגות הלל ואסיפה - ארכיון/2026-10-17.pptx), 16:9, positions in inches
async function buildPptx(iso) {
  if (!window.PptxGenJS) { toast("ספריית המצגות לא נטענה, נסו לרענן"); return; }
  const items = itemsFor(iso).filter((i) => i.songs);
  const [bg, menorah, qr] = await Promise.all([
    imageData("../img/background.jpg", 1920), imageData("img/welcome_menorah.png", 1100), imageData("img/youtube_qr.png", 187),
  ]);
  const GOLD = "D8BE83", WHITE = "F5F7FA";
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in (960 x 540 pt), like the template
  pptx.rtlMode = true;
  pptx.defineSlideMaster({ title: "BG", background: { data: bg.replace(/^data:/, "") } });
  const T = { rtlMode: true, lang: "he-IL", margin: 0 };

  // 1. welcome slide
  const w = pptx.addSlide({ masterName: "BG" });
  w.addText("ברוכים הבאים לקהילת אור השרון", { ...T, x: 0.38, y: 0.47, w: 12.57, h: 1.33, fontFace: "Guttman-Aram", fontSize: 54, color: GOLD, align: "center", valign: "middle" });
  w.addImage({ data: menorah, x: 6.87, y: 1.81, w: 6.22, h: 5.46, sizing: { type: "cover", w: 6.22, h: 5.46 } });
  w.addText("ל YouTube הקהילתי נא סרקו:", { ...T, x: 0.67, y: 2.25, w: 5.31, h: 0.75, fontFace: "David", fontSize: 40, italic: true, color: GOLD, align: "right", valign: "top" });
  w.addImage({ data: qr, x: 0.96, y: 2.99, w: 3.02, h: 2.85 });
  w.addText("אנא השקיטו את הטלפונים הניידים", { ...T, x: 0.4, y: 6.26, w: 7.2, h: 0.82, fontFace: "Guttman-Aram", fontSize: 28, color: WHITE, align: "center", valign: "middle" });
  pptx.addSlide({ masterName: "BG" }); // blank, like the template

  // 2. songs: small gold title top-right, white David lyrics centered, max 4 lines; a blank slide after each song
  for (const it of items) {
    for (const st of lyricStanzas(it.songs.content)) {
      for (const part of chunks(st.lines)) {
        const sl = pptx.addSlide({ masterName: "BG" });
        sl.addText(it.songs.title, { ...T, x: 4.17, y: 0.21, w: 8.61, h: 0.56, fontFace: "Arial", fontSize: 26, bold: true, color: GOLD, align: "right", valign: "middle" });
        const long = part.some((l) => l.length > 34);
        sl.addText(part.join("\n"), { ...T, x: 0.61, y: 1.51, w: 12.17, h: 4.94, fontFace: "David", fontSize: long ? 44 : 54, color: WHITE, align: "center", valign: "middle" });
        const meta = songMeta(it.songs.content);
        const notes = [it.notes, meta.capo ? `קאפו ${meta.capo}` : "", it.songs.song_key ? `סולם ${it.songs.song_key}` : "", st.label].filter(Boolean).join(" · ");
        if (notes) sl.addNotes(notes);
      }
    }
    pptx.addSlide({ masterName: "BG" });
  }

  const name = `סשן הלל ${iso.split("-").reverse().join("-")}.pptx`;
  const blob = await pptx.write({ outputType: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.getElementById("sl-download");
  if (a) { a.href = url; a.download = name; a.textContent = `⬇️ ${name}`; a.hidden = false; }
  const tmp = document.createElement("a"); tmp.href = url; tmp.download = name; document.body.append(tmp); tmp.click(); tmp.remove();
  toast("המצגת נוצרה");
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const t = e.target;
  const open = t.closest("[data-open-setlist]");
  if (open) { openSetlist(open.dataset.openSetlist); return; }
  if (t.closest("[data-close-setlist]") || t.id === "setlist-dialog") { dialogEl().close(); render(); return; }
  if (t.closest("[data-add-setlist]")) {
    if (setlist.missing) { toast("הסשנים עדיין לא פעילים: צריך להריץ את setlist.sql ב-Supabase"); return; }
    addToSetlistDialog(songsState.current); return;
  }
  const add = t.closest("[data-sl-add]");
  if (add) {
    const iso = document.getElementById("sl-date").value;
    const notes = document.getElementById("sl-new-note").value.trim() || null;
    await loadSetlist();
    const pos = Math.max(0, ...itemsFor(iso).map((i) => i.position)) + 1;
    const { error } = await sb.from("setlist_items").insert({ meeting_date: iso, song_id: Number(add.dataset.slAdd), position: pos, notes });
    if (error) { toast("ההוספה נכשלה"); return; }
    await loadSetlist(); dialogEl().close(); toast("השיר נוסף לסשן"); return;
  }
  const mv = t.closest("[data-sl-move]");
  if (mv) {
    const items = itemsFor(setlist.openDate);
    const k = items.findIndex((i) => i.id === Number(mv.dataset.slMove));
    const j = k + Number(mv.dataset.dir);
    if (j < 0 || j >= items.length) return;
    const order = items.map((i) => i.id);
    [order[k], order[j]] = [order[j], order[k]];
    await Promise.all(order.map((id, n) => sb.from("setlist_items").update({ position: n + 1 }).eq("id", id)));
    await loadSetlist(); renderSetlistDialog(); return;
  }
  const rm = t.closest("[data-sl-remove]");
  if (rm) {
    const { error } = await sb.from("setlist_items").delete().eq("id", Number(rm.dataset.slRemove));
    if (error) { toast("ההסרה נכשלה"); return; }
    await loadSetlist(); renderSetlistDialog(); return;
  }
  const song = t.closest("[data-open-song]");
  if (song) {
    const it = setlist.items.find((i) => i.song_id === Number(song.dataset.openSong));
    if (!it?.songs) return;
    dialogEl().close();
    state.tab = "songs"; songsState.current = it.songs; songsState.view = "song"; songsState.shift = 0; songsState.noCapo = false; songsState.present = false;
    render(); scrollTo(0, 0); return;
  }
  if (t.closest("[data-sl-pptx]")) {
    const b = t.closest("[data-sl-pptx]"); b.disabled = true; b.textContent = "יוצר מצגת…";
    try { await buildPptx(setlist.openDate); } catch (err) { console.error(err); toast("יצירת המצגת נכשלה"); }
    b.disabled = false; b.textContent = "📽️ הורדת מצגת PowerPoint";
  }
});

// notes save when you leave the field
document.addEventListener("change", async (e) => {
  const n = e.target.closest("[data-sl-note]");
  if (!n) return;
  const { error } = await sb.from("setlist_items").update({ notes: n.value.trim() || null }).eq("id", Number(n.dataset.slNote));
  toast(error ? "שמירת ההערה נכשלה" : "ההערה נשמרה");
  const it = setlist.items.find((i) => i.id === Number(n.dataset.slNote)); if (it && !error) it.notes = n.value.trim() || null;
});
