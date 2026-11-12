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

// ---------- who may change a session: that meeting's worship leader only, admins too (the DB enforces the same, setlist_leader.sql) ----------
function canEditSetlist(iso) {
  if (typeof user === "undefined" || !user) return true; // open mode without sign-in
  return myMemberId != null && state.signups.some((s) => s.meeting_date === iso && s.role === "leader" && s.member_id === myMemberId);
}
function leaderOnly(iso) {
  const ld = state.signups.find((s) => s.meeting_date === iso && s.role === "leader");
  const name = ld ? byId(ld.member_id)?.name : "";
  toast(name ? `אין הרשאה: רק מוביל/ת ההלל של המפגש (${name}) יכול/ה לשנות את הסשן` : "אין הרשאה: רק מוביל/ת ההלל של המפגש יכול/ה לשנות את הסשן, ועדיין לא שובץ/ה מוביל/ה", { error: true });
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
    <h2>סשן הלל · ${mt ? `${meetingKind(mt)} ${mt.dateText.slice(0, 5)}` : iso.split("-").reverse().join("/")}</h2>
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
      <button class="btn" data-sl-live ${items.length ? "" : "disabled"}>▶ מצב הלל (מסך מלא)</button>
      ${LIVE_SYNC_ON && (isAdmin || canEditSetlist(iso)) ? `<button class="btn ghost" data-sl-team>📣 לינק לסט החי לצוות</button>` : ""}
      <button class="btn ghost" data-sl-pptx ${items.length ? "" : "disabled"}>📽️ הורדת מצגת PowerPoint</button>
      <button class="btn ghost" data-sl-pdf ${items.length ? "" : "disabled"}>📄 הורדת השירים כ-PDF</button>
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
    <label class="field">מפגש<select id="sl-date">${upcoming.map((m) => `<option value="${m.iso}">${meetingKind(m)} · ${m.dateText.slice(0, 5)} · ${esc(m.place)}</option>`).join("")}</select></label>
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
    const line = fixNiqqudLine(raw).replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim();
    if (!line) { if (stanzas[stanzas.length - 1].lines.length) stanzas.push({ label: "", lines: [] }); continue; }
    if (!/[\u05D0-\u05EAa-zA-Z]{2}/.test(line.replace(/[\u0591-\u05C7]/g, ""))) continue; // chord-only rows (niqqud ignored)
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

// The deck is built from template.pptx (a clean copy of the community's own 2026-10-17 deck).
// Its slides, in order: 0 welcome, 1 blank, 2 song (prototype), 3 "זאת עשו לזכרי", 4 children's blessing,
// 5 testimonies & prayer, 6 home groups, 7 upcoming meetings. Fixed slides are kept as they are; songs are
// cloned from the prototype (Arial 26 title, David 54 lyrics); groups and meetings are refilled from the site.
const TPL = { welcome: 0, blank: 1, song: 2, communion: 3, blessing: 4, testimonies: 5, groups: 6, meetings: 7 };
const xmlEsc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// replace all paragraphs of a text body with new ones, styled like given sample paragraphs
function setParagraphs(spXml, lines, pickSample) {
  const body = spXml.match(/<p:txBody>[\s\S]*?<\/p:txBody>/)[0];
  const paras = body.match(/<a:p>[\s\S]*?<\/a:p>/g) || [];
  const head = body.slice(0, body.indexOf("<a:p>"));
  const build = (text, sample) => {
    const pPr = (sample.match(/<a:pPr[\s\S]*?<\/a:pPr>|<a:pPr[^>]*\/>/) || [""])[0];
    const rPr = (sample.match(/<a:rPr[\s\S]*?<\/a:rPr>|<a:rPr[^>]*\/>/) || ['<a:rPr lang="he-IL"/>'])[0];
    return text ? `<a:p>${pPr}<a:r>${rPr}<a:t>${xmlEsc(text)}</a:t></a:r></a:p>` : `<a:p>${pPr}<a:endParaRPr lang="he-IL"/></a:p>`;
  };
  const newBody = head + lines.map((t, n) => build(t, pickSample(paras, t, n))).join("") + "</p:txBody>";
  return spXml.replace(body, newBody);
}
const shapes = (xml) => xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
const firstText = (sp) => (sp.match(/<a:t>([^<]*)<\/a:t>/) || [, ""])[1];

// home groups straight from the community site's front page
async function homeGroupLines() {
  const html = await fetch("../index.html", { cache: "no-cache" }).then((r) => r.text());
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = [];
  doc.querySelectorAll(".groups .group").forEach((g, n) => {
    const city = g.querySelector("strong")?.textContent.trim() || "";
    const small = g.querySelector("small")?.textContent.replace(/^[\s·]+/, "").trim() || "";
    let when = g.textContent.replace(city, "").replace(g.querySelector("small")?.textContent || "", "").replace(/[·]/g, " ").replace(/\s+/g, " ").trim();
    when = when.replace(/(\d{1,2}:\d{2})/, "ב $1");
    if (n) out.push("");
    out.push(city, `${when}${small ? `. ${small}` : ""}`);
  });
  return out;
}

// next meetings after this session: this month and the next, like the template
function meetingLines(iso) {
  const after = state.meetings.filter((m) => m.iso > iso);
  if (!after.length) return [];
  const first = after[0].date, months = new Set([first.getMonth(), (first.getMonth() + 1) % 12]);
  const list = after.filter((m) => months.has(m.date.getMonth()) && (m.date - first) < 70 * 864e5);
  const out = [];
  let month = null;
  for (const m of list) {
    const name = m.date.toLocaleDateString("he-IL", { month: "long" });
    if (name !== month) { if (month) out.push(""); out.push(`${name}:`); month = name; }
    const kind = meetingKind(m);
    const extra = kind !== "אסיפה" && !kind.startsWith("יום ") ? kind : /בפטיסט/.test(m.place) ? "צ'אפל" : (m.notes || "");
    out.push(`\t${m.dateText.slice(0, 5)} ${m.place}${extra ? ` | ${extra}` : ""}`);
  }
  return out;
}

async function buildPptx(iso) {
  if (!window.JSZip) { toast("ספריית המצגות לא נטענה, נסו לרענן"); return; }
  const items = itemsFor(iso).filter((i) => i.songs);
  const zip = await JSZip.loadAsync(await fetch("template.pptx", { cache: "no-cache" }).then((r) => r.arrayBuffer()));
  const read = (p) => zip.file(p).async("string");
  const presXml = await read("ppt/presentation.xml");
  const presRels = await read("ppt/_rels/presentation.xml.rels");
  const target = (rid) => (presRels.match(new RegExp(`Id="${rid}"[^>]*?Target="([^"]+)"`)) || presRels.match(new RegExp(`Target="([^"]+)"[^>]*?Id="${rid}"`)))[1];
  const tplSlides = [...presXml.matchAll(/<p:sldId [^>]*?r:id="(rId\d+)"\s*\/>/g)].map((m) => "ppt/" + target(m[1]));
  const relsPath = (p) => p.replace("slides/", "slides/_rels/") + ".rels";
  let next = 100;
  const newParts = [];

  // a copy of a template slide (no speaker notes), optionally with its XML changed
  async function clone(idx, edit) {
    const src = tplSlides[idx];
    let xml = await read(src);
    if (edit) xml = edit(xml);
    const rels = (await read(relsPath(src))).replace(/<Relationship [^>]*?notesSlide[^>]*?\/>/g, "");
    const name = `ppt/slides/slide${next++}.xml`;
    zip.file(name, xml); zip.file(relsPath(name), rels);
    newParts.push(name);
    return name;
  }
  const songSlides = async (it) => {
    const out = [];
    for (const st of lyricStanzas(it.songs.content)) {
      const long = st.lines.some((l) => l.length > 34);
      for (const part of chunks(st.lines, 4)) {
        out.push(await clone(TPL.song, (xml) => {
          const [titleSp, lyricSp] = shapes(xml).filter((sp) => /<a:t>/.test(sp));
          let x = xml.replace(titleSp, setParagraphs(titleSp, [it.songs.title], (ps) => ps[0]));
          // David 54 like the template; long lines shrink so each line stays on one line (876pt box, ~0.5em per letter)
          const longest = Math.max(...part.map((l) => l.replace(/[֑-ׇ]/g, "").length));
          const size = Math.max(30, Math.min(54, Math.floor(876 / (0.5 * longest))));
          const lyr = setParagraphs(lyricSp, part, (ps) => ps[0]).replace(/sz="\d+"/g, `sz="${size * 100}"`);
          return x.replace(lyricSp, lyr);
        }));
      }
    }
    return out;
  };

  // slide order: welcome, blank, all songs but the last (each followed by a blank), communion, last song, then the fixed tail
  const before = items.slice(0, Math.max(0, items.length - 1)), last = items.slice(-1);
  const order = [tplSlides[TPL.welcome], tplSlides[TPL.blank]];
  for (const it of before) { order.push(...(await songSlides(it))); order.push(await clone(TPL.blank)); }
  order.push(tplSlides[TPL.communion]);
  for (const it of last) order.push(...(await songSlides(it)));
  order.push(tplSlides[TPL.blessing], tplSlides[TPL.testimonies]);

  // home groups + meetings: same slide, fresh text
  const groups = await homeGroupLines().catch(() => null);
  const gx = await read(tplSlides[TPL.groups]);
  if (groups?.length) {
    const sp = shapes(gx).filter((s) => /<a:t>/.test(s))[1];
    zip.file(tplSlides[TPL.groups], gx.replace(sp, setParagraphs(sp, groups, (ps, t) => ps.find((p) => /<a:t>/.test(p) && (t && !/[:.]/.test(t) ? !/ימי/.test(firstText(p)) : /ימי/.test(firstText(p)))) || ps[0])));
  }
  const meetings = meetingLines(iso);
  const mx = await read(tplSlides[TPL.meetings]);
  if (meetings.length) {
    const sp = shapes(mx).filter((s) => /<a:t>/.test(s))[1];
    zip.file(tplSlides[TPL.meetings], mx.replace(sp, setParagraphs(sp, meetings, (ps, t) => ps.find((p) => /<a:t>/.test(p) && (t.startsWith("\t") ? firstText(p).startsWith("\t") : /:$/.test(firstText(p)))) || ps[0])));
  }
  order.push(tplSlides[TPL.groups], tplSlides[TPL.meetings]);

  // the song prototype itself is not used: remove it (and its notes)
  const proto = tplSlides[TPL.song];
  const protoRels = await read(relsPath(proto));
  const protoNotes = (protoRels.match(/Target="\.\.\/notesSlides\/([^"]+)"/) || [])[1];
  zip.remove(proto); zip.remove(relsPath(proto));
  if (protoNotes) { zip.remove(`ppt/notesSlides/${protoNotes}`); zip.remove(`ppt/notesSlides/_rels/${protoNotes}.rels`); }

  // rewrite the slide list
  let rels = presRels.replace(/<Relationship [^>]*?Target="slides\/[^"]+"[^>]*?\/>/g, "");
  const ids = order.map((p, n) => {
    const rid = `rIdS${n + 1}`;
    rels = rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${p.replace("ppt/", "")}"/></Relationships>`);
    return `<p:sldId id="${300 + n}" r:id="${rid}"/>`;
  }).join("");
  zip.file("ppt/presentation.xml", presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`));
  zip.file("ppt/_rels/presentation.xml.rels", rels);
  let ct = await read("[Content_Types].xml");
  ct = ct.replace(new RegExp(`<Override PartName="/${proto}"[^>]*/>`), "");
  if (protoNotes) ct = ct.replace(new RegExp(`<Override PartName="/ppt/notesSlides/${protoNotes}"[^>]*/>`), "");
  ct = ct.replace("</Types>", newParts.map((p) => `<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("") + "</Types>");
  zip.file("[Content_Types].xml", ct);

  const name = `סשן הלל ${iso.split("-").reverse().join("-")}.pptx`;
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", compression: "DEFLATE" });
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
    if (!canEditSetlist(iso)) { leaderOnly(iso); return; }
    await loadSetlist();
    const pos = Math.max(0, ...itemsFor(iso).map((i) => i.position)) + 1;
    const { error } = await sb.from("setlist_items").insert({ meeting_date: iso, song_id: Number(add.dataset.slAdd), position: pos, notes });
    if (error) { error.code === "42501" ? leaderOnly(iso) : toast("ההוספה נכשלה"); return; }
    await loadSetlist(); dialogEl().close(); toast("השיר נוסף לסשן"); return;
  }
  const mv = t.closest("[data-sl-move]");
  if (mv) {
    if (!canEditSetlist(setlist.openDate)) { leaderOnly(setlist.openDate); return; }
    const items = itemsFor(setlist.openDate);
    const k = items.findIndex((i) => i.id === Number(mv.dataset.slMove));
    const j = k + Number(mv.dataset.dir);
    if (j < 0 || j >= items.length) return;
    const order = items.map((i) => i.id);
    [order[k], order[j]] = [order[j], order[k]];
    const res = await Promise.all(order.map((id, n) => sb.from("setlist_items").update({ position: n + 1 }).eq("id", id).select("id")));
    if (res.some((r) => r.error || !r.data?.length)) leaderOnly(setlist.openDate);
    await loadSetlist(); renderSetlistDialog(); return;
  }
  const rm = t.closest("[data-sl-remove]");
  if (rm) {
    if (!canEditSetlist(setlist.openDate)) { leaderOnly(setlist.openDate); return; }
    const { data, error } = await sb.from("setlist_items").delete().eq("id", Number(rm.dataset.slRemove)).select("id");
    if (error) { toast("ההסרה נכשלה"); return; }
    if (!data?.length) { leaderOnly(setlist.openDate); return; } // blocked by the DB (nothing deleted)
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

// ---------- PDF of the songs themselves (chords + lyrics), one song per page, via the browser's "Save as PDF" ----------
function printSongs(iso) {
  const items = itemsFor(iso).filter((i) => i.songs);
  if (!items.length) return;
  const mt = state.meetings.find((m) => m.iso === iso);
  const date = iso.split("-").reverse().join("-");
  document.getElementById("print-book")?.remove();
  const book = document.createElement("div");
  book.id = "print-book";
  book.innerHTML = items.map((it, k) => {
    const s = it.songs, meta = songMeta(s.content);
    const key = s.song_key || firstChord(s.content);
    const info = [key && `סולם <b dir="ltr">${esc(key)}</b>`, Number(meta.capo) && `קאפו ${Number(meta.capo)}`].filter(Boolean).join(" · ");
    return `<section class="pb-song">
      <div class="pb-head"><span class="pb-num">${k + 1}</span><h2 class="song-title">${esc(s.title)}</h2></div>
      ${meta.artist ? `<p class="song-artist">${esc(meta.artist)}</p>` : ""}
      ${info ? `<p class="pb-info">${info}</p>` : ""}
      ${it.notes ? `<p class="pb-note">📝 ${esc(it.notes)}</p>` : ""}
      <div class="chordpro song-body" style="--song-scale:1">${renderChordPro(s.content, 0)}</div>
    </section>`;
  }).join("");
  document.body.append(book);
  const oldTitle = document.title;
  document.title = `סשן הלל ${date}${mt ? " " + meetingKind(mt) : ""}`; // the PDF's default file name
  document.body.classList.add("print-book");
  const done = () => { document.body.classList.remove("print-book"); book.remove(); document.title = oldTitle; removeEventListener("afterprint", done); };
  addEventListener("afterprint", done);
  dialogEl().close();
  setTimeout(() => window.print(), 50);
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-sl-pdf]")) printSongs(setlist.openDate); });

// notes save when you leave the field
document.addEventListener("change", async (e) => {
  const n = e.target.closest("[data-sl-note]");
  if (!n) return;
  const it = setlist.items.find((i) => i.id === Number(n.dataset.slNote));
  if (!canEditSetlist(setlist.openDate)) { n.value = it?.notes || ""; leaderOnly(setlist.openDate); return; }
  const { data, error } = await sb.from("setlist_items").update({ notes: n.value.trim() || null }).eq("id", Number(n.dataset.slNote)).select("id");
  if (!error && !data?.length) { n.value = it?.notes || ""; leaderOnly(setlist.openDate); return; }
  toast(error ? "שמירת ההערה נכשלה" : "ההערה נשמרה");
  if (it && !error) it.notes = n.value.trim() || null;
});

// ---------- live worship mode: the whole session full screen, for the musicians ----------
const live = { on: false, idx: 0, shift: {}, noCapo: {}, chords: true, zoom: 1, myCapo: 0 };
try { live.zoom = Number(localStorage.getItem("ws-live-zoom")) || 1; } catch {}
try { live.myCapo = Number(localStorage.getItem("ws-live-capo")) || 0; } catch {} // personal capo, only with live sync (live-sync.js)

function liveEl() {
  let el = document.getElementById("live-view");
  if (!el) { el = document.createElement("div"); el.id = "live-view"; el.className = "live-view"; el.hidden = true; document.body.append(el); }
  return el;
}

function renderLive() {
  const items = itemsFor(setlist.openDate).filter((i) => i.songs);
  const el = liveEl();
  if (!live.on || !items.length) { el.hidden = true; return; }
  live.idx = Math.max(0, Math.min(live.idx, items.length - 1));
  const it = items[live.idx], song = it.songs, meta = songMeta(song.content);
  const capo = Number(meta.capo) || 0;
  const myCapo = syncActive() ? live.myCapo || 0 : 0;
  const shift = (live.shift[it.id] || 0) + (live.noCapo[it.id] ? capo : 0) - myCapo;
  const base = song.song_key || firstChord(song.content);
  const key = base ? transposeChord(base, shift + myCapo) : "";          // the key everyone plays in
  const shapes = base && myCapo ? transposeChord(base, shift) : "";       // what my fingers play with my capo
  const next = items[live.idx + 1];
  el.hidden = false;
  el.style.setProperty("--live-zoom", live.zoom);
  el.innerHTML = `
    <div class="live-bar">
      <span class="live-pos">${live.idx + 1} / ${items.length}</span>
      <strong class="live-title">${esc(song.title)}</strong>
      ${it.notes ? `<span class="live-note">📝 ${esc(it.notes)}</span>` : ""}
      <span class="live-tools">
        <span class="tool-label">סולם <b dir="ltr">${esc(key)}</b>${shapes ? ` · קאפו ${myCapo}: <b dir="ltr">${esc(shapes)}</b>` : ""}</span>
        ${syncLocksKey() ? "" : `<button class="tool" data-live="key-1" title="חצי טון למטה">−½</button><button class="tool" data-live="key+1" title="חצי טון למעלה">+½</button>
        ${live.shift[it.id] ? `<button class="tool link" data-live="key0">מקורי</button>` : ""}`}
        ${capo ? `<button class="tool${live.noCapo[it.id] ? " on" : ""}" data-live="capo">${live.noCapo[it.id] ? "עם קאפו " + capo : "בלי קאפו"}</button>` : ""}
        <button class="tool" data-live="zoom+1" title="הגדלה">🔍+</button><button class="tool" data-live="zoom-1" title="הקטנה">🔍−</button>
        <button class="tool${live.chords ? " on" : ""}" data-live="chords">אקורדים</button>
        ${syncToolsHtml()}
        <button class="tool" data-live="exit">✕ יציאה</button>
      </span>
    </div>
    ${syncPeopleHtml()}${syncAwayHtml()}
    <div class="live-body"><div class="chordpro song-body">${renderChordPro(song.content, shift, { chords: live.chords })}</div></div>
    <div class="live-nav">
      <button class="tool" data-live="prev" ${live.idx ? "" : "disabled"}>→ הקודם</button>
      <span class="live-next">${next ? `הבא: ${esc(next.songs.title)}` : "שיר אחרון"}</span>
      <button class="tool" data-live="next" ${next ? "" : "disabled"}>הבא ←</button>
    </div>`;
  fitLive(el);
}

// Columns of a fixed width: one per screen on a phone, two side by side on a wide screen.
// Whatever doesn't fit in the height continues in another column to the left (scroll / swipe sideways).
// The font size is only ever what the zoom says: nothing is shrunk behind your back.
function fitLive(el) {
  const outer = el.querySelector(".live-body"), body = outer?.querySelector(".song-body");
  if (!body) return;
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  const gap = narrow ? 28 : Math.round(window.innerWidth * 0.05);
  const w = Math.floor(narrow ? outer.clientWidth - 24 : (outer.clientWidth - 48 - gap) / 2);
  body.style.columnGap = gap + "px";
  body.style.columnWidth = w + "px";
  body.style.width = w + "px";            // the box is one column wide; extra columns overflow to the side
  if (!narrow) body.style.width = (w * 2 + gap) + "px";
  outer.scrollLeft = 0;
}

// how far the columns can still move in a direction ("next" = towards the next column, i.e. left in Hebrew)
function liveCanScroll(dir) {
  const outer = document.querySelector("#live-view .live-body");
  if (!outer) return false;
  const max = outer.scrollWidth - outer.clientWidth;
  const pos = Math.abs(outer.scrollLeft);   // RTL scrollLeft runs 0 .. -max
  return dir === "next" ? pos < max - 4 : pos > 4;
}
function liveScroll(dir) {
  const outer = document.querySelector("#live-view .live-body");
  const step = outer.clientWidth * (window.matchMedia("(max-width: 760px)").matches ? 1 : 0.5);
  outer.scrollBy({ left: (dir === "next" ? -1 : 1) * step, behavior: "smooth" });
}

function liveAction(a) {
  const items = itemsFor(setlist.openDate).filter((i) => i.songs);
  const it = items[live.idx];
  if (syncAction(a)) { renderLive(); return; }
  // a follower who moves on their own stops following (a bar offers the way back), like OnSong
  if (syncActive() && !sync.iLead && sync.follow && (a === "next" || a === "prev")) sync.follow = false;
  if (a === "exit") { live.on = false; syncStop(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
  else if (a === "next") live.idx++;
  else if (a === "prev") live.idx--;
  else if (a.startsWith("key")) { const n = Number(a.slice(3)); live.shift[it.id] = n ? (live.shift[it.id] || 0) + n : 0; }
  else if (a === "capo") live.noCapo[it.id] = !live.noCapo[it.id];
  else if (a.startsWith("zoom")) {
    live.zoom = Math.min(3, Math.max(0.6, +(live.zoom + 0.15 * Number(a.slice(4))).toFixed(2)));
    try { localStorage.setItem("ws-live-zoom", live.zoom); } catch {}
  }
  else if (a === "chords") live.chords = !live.chords;
  renderLive();
  if (sync.iLead && (a === "next" || a === "prev" || a.startsWith("key"))) broadcastState();
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-sl-live]")) {
    dialogEl().close();
    Object.assign(live, { on: true, idx: 0 });
    document.documentElement.requestFullscreen?.().catch(() => {});
    renderLive(); syncStart(setlist.openDate); return;
  }
  const b = e.target.closest("[data-live]");
  if (b) liveAction(b.dataset.live);
});
// keyboard / foot pedal: arrows or PageUp/PageDown change song, +/- zoom, Esc leaves
document.addEventListener("keydown", (e) => {
  if (!live.on) return;
  if (["ArrowLeft", "PageDown", " "].includes(e.key)) { e.preventDefault(); liveCanScroll("next") ? liveScroll("next") : liveAction("next"); }
  else if (["ArrowRight", "PageUp"].includes(e.key)) { e.preventDefault(); liveCanScroll("prev") ? liveScroll("prev") : liveAction("prev"); }
  else if (e.key === "+" || e.key === "=") liveAction("zoom+1");
  else if (e.key === "-") liveAction("zoom-1");
  else if (e.key === "Escape") liveAction("exit");
});
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && live.on) { live.on = false; syncStop(); renderLive(); } });
// swipe on a phone/tablet
let touchX = null, touchNext = false, touchPrev = false;
document.addEventListener("touchstart", (e) => {
  if (!live.on) return;
  touchX = e.touches[0].clientX; touchNext = !liveCanScroll("next"); touchPrev = !liveCanScroll("prev");
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!live.on || touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX; touchX = null;
  // finger to the right reveals the next column (Hebrew reads right to left); past the last column = next song
  if (dx > 70 && touchNext) liveAction("next");
  else if (dx < -70 && touchPrev) liveAction("prev");
}, { passive: true });

window.addEventListener("resize", () => { if (live.on) fitLive(liveEl()); });
