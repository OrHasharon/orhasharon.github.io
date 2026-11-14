// Worship sessions: ordered songs + notes per meeting, opened from the signup tab, exported to PowerPoint.
// Uses sb / esc / toast / state / render from ws.js and songsState / renderSongs / songMeta from songs.js.
const setlist = { items: [], ready: false, missing: false, openDate: null };

async function loadSetlist() {
  const { data, error } = await sb.from("setlist_items").select("*, songs(*)").order("position");
  if (error) { setlist.missing = error.code === "PGRST205" || error.code === "42P01" || error.code === "PGRST200"; setlist.ready = true; return; }
  setlist.items = data; setlist.ready = true; setlist.missing = false;
  if (typeof leadAfterLoad === "function") leadAfterLoad(); // the leader's own link (lead.js)
}
const itemsFor = (iso) => setlist.items.filter((i) => i.meeting_date === iso).sort((a, b) => a.position - b.position || a.id - b.id);

// small button shown next to each meeting in the signup tab (called from ws.js)
function setlistButton(iso) {
  if (!setlist.ready || setlist.missing) return "";
  const n = itemsFor(iso).length;
  const lead = LIVE_SYNC_ON && typeof user !== "undefined" && user && canEditSetlist(iso)
    ? `<button class="setlist-btn lead-btn" data-lead-open="${iso}">👑 הובלה</button>` : ""; // the leader's own meeting (lead.js)
  return `<button class="setlist-btn${n ? " has" : ""}" data-open-setlist="${iso}">🎵 סשן הלל${n ? ` (${n})` : ""}</button>${lead}`;
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
      </li>`).join("")}</ol>` : `<p class="status">עדיין אין שירים בסשן.${canEditSetlist(iso) ? " מחפשים שיר כאן למטה ומוסיפים בלחיצה." : ""}</p>`}
    ${canEditSetlist(iso) ? `<div class="sl-add-box">
      <label class="field">הוספת שיר לסט<input id="sl-search" type="search" placeholder="חיפוש לפי שם השיר" autocomplete="off" value="${esc(setlist.query || "")}"></label>
      <div id="sl-hits"></div>
    </div>` : ""}
    <div class="sl-actions">
      <button class="btn" data-sl-live ${items.length ? "" : "disabled"}>▶ מצב הלל (מסך מלא)</button>
      ${LIVE_SYNC_ON && (isAdmin || canEditSetlist(iso)) ? `<button class="btn ghost" data-sl-team>📣 לינק לסט החי לצוות</button>` : ""}
      <button class="btn ghost" data-sl-pptx ${items.length ? "" : "disabled"}>📽️ הורדת מצגת PowerPoint</button>
      ${canEditSetlist(iso) ? `<button class="btn ghost" data-sl-supper>🍞 + סעודת האדון</button>` : ""}
      <button class="btn ghost" data-sl-screen ${items.length ? "" : "disabled"} title="פותחים פעם אחת במחשב ההקרנה ושומרים כסימנייה">🖥️ מסך הקרנה</button>
      <button class="btn ghost" data-sl-pdf ${items.length ? "" : "disabled"}>📄 הורדת PDF</button>
      <a id="sl-download" class="link-btn" hidden></a>
    </div>
  </div>`;
  if (!d.open) d.showModal();
  renderSlHits();
}

async function openSetlist(iso) {
  setlist.openDate = iso;
  setlist.query = "";
  await loadSetlist();
  renderSetlistDialog();
}

// ---------- add a song straight from the session dialog: search by name, one tap adds it at the end ----------
const plainTitle = (t) => (t || "").replace(/[\u0591-\u05C7]/g, "").replace(/[״"׳'`,.\-–]/g, "").replace(/\s+/g, " ").trim();
function renderSlHits() {
  const box = document.getElementById("sl-hits");
  if (!box) return;
  const q = plainTitle(setlist.query || "");
  if (!q) { box.innerHTML = ""; return; }
  if (!songsState.loaded) { box.innerHTML = `<p class="hint">טוען שירים…</p>`; loadSongs().then(renderSlHits); return; }
  const inSet = new Set(itemsFor(setlist.openDate).map((i) => i.song_id));
  const hits = songsState.list.filter((s) => !inSet.has(s.id) && plainTitle(s.title).includes(q)).slice(0, 8);
  box.innerHTML = hits.length
    ? `<ul class="sl-hits">${hits.map((s) => `<li><button class="link-btn" data-sl-quickadd="${s.id}">➕ ${esc(s.title)}${s.song_key ? ` <small dir="ltr">${esc(s.song_key)}</small>` : ""}</button></li>`).join("")}</ul>`
    : `<p class="hint">לא נמצא שיר בשם הזה. שיר חדש מוסיפים בלשונית "שירים" ← "+ שיר חדש".</p>`;
}
document.addEventListener("input", (e) => {
  if (e.target.id !== "sl-search") return;
  setlist.query = e.target.value;
  renderSlHits(); // only the results change while typing (redrawing the input breaks Hebrew typing on phones)
});

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
// lyricStanzas / chunks (lyrics → slides) live in chords.js, shared with the projection screen
// an item that is silent on the screen ({screen: quiet}, e.g. סעודת האדון) and has no lyrics
const quietItem = (song) => (songMeta(song.content || "").screen || "").toLowerCase() === "quiet" && !lyricStanzas(song.content || "").length;

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
// template.pptx slides, in order (scripts/build_template.py KEEP)
const TPL = { welcome: 0, verse: 1, blank: 2, song: 3, communion: 4, communion_verse: 5, parasha: 6, reading: 7, blessing: 8,
  sermon_title: 9, testimonies: 10, prayers: 11, groups: 12, meetings: 13, tithes: 14, closing: 15 };
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

// homeGroupLines / meetingLines / deckPlan (the presentation's order) live in deck.js, shared with the projection screen

// The prayer requests slide (the community's own, from the 17.10.2026 deck): a bullet per line; a line starting with
// "-" is a sub-bullet; *stars* mark the orange words (names). The template keeps one sample paragraph of each level,
// each with a white run and an orange run, and every new paragraph copies their formatting.
const ORANGE = /accent2|F2AA84/i; // the names' colour: the theme's accent 2, lightened (#F2AA84)
function prayerSlideXml(xml, lines) {
  const body = shapes(xml).filter((sp) => /<p:txBody>/.test(sp)).sort((a, b) => (b.match(/<a:p>/g) || []).length - (a.match(/<a:p>/g) || []).length)[0];
  if (!body) return xml;
  const txBody = body.match(/<p:txBody>[\s\S]*?<\/p:txBody>/)[0];
  const paras = txBody.match(/<a:p>[\s\S]*?<\/a:p>/g) || [];
  const head = txBody.slice(0, txBody.indexOf("<a:p>"));
  const lvl2 = paras.find((p) => /<a:pPr[^>]*\blvl="1"/.test(p)) || paras[0];
  const lvl1 = paras.find((p) => p !== lvl2 && /<a:r>/.test(p)) || paras[0];
  const parts = (p) => {
    const pPr = (p.match(/<a:pPr[\s\S]*?<\/a:pPr>|<a:pPr[^>]*\/>/) || [""])[0];
    const rPrs = (p.match(/<a:rPr[\s\S]*?<\/a:rPr>|<a:rPr[^>]*\/>/g) || ['<a:rPr lang="he-IL"/>']);
    return { pPr, white: rPrs.find((r) => !ORANGE.test(r)) || rPrs[0], orange: rPrs.find((r) => ORANGE.test(r)) || rPrs[0] };
  };
  const s1 = parts(lvl1), s2 = parts(lvl2);
  const out = lines.map((line) => {
    const sub = /^\s*-/.test(line), s = sub ? s2 : s1;
    const text = line.replace(/^\s*-\s*/, "");
    const runs = text.split("*").map((t, n) => t ? `<a:r>${n % 2 ? s.orange : s.white}<a:t>${xmlEsc(t)}</a:t></a:r>` : "").join("");
    return `<a:p>${s.pPr}${runs}</a:p>`;
  }).join("");
  return xml.replace(body, body.replace(txBody, head + out + "</p:txBody>"));
}

async function buildPptx(iso) {
  if (!window.JSZip) { toast("ספריית המצגות לא נטענה, נסו לרענן"); return; }
  const items = itemsFor(iso).filter((i) => i.songs);
  const zip = await JSZip.loadAsync(await fetch("template.pptx", { cache: "no-cache" }).then((r) => r.arrayBuffer()));
  const read = (p) => zip.file(p).async("string");
  const presXml = await read("ppt/presentation.xml");
  const presRels = await read("ppt/_rels/presentation.xml.rels");
  const target = (rid) => (presRels.match(new RegExp(`Id="${rid}"[^>]*?Target="([^"]+)"`)) || presRels.match(new RegExp(`Target="([^"]+)"[^>]*?Id="${rid}"`)))[1];
  const tplSlides = [...presXml.matchAll(/<p:sldId [^>]*?r:id="([^"]+)"\s*\/>/g)].map((m) => "ppt/" + target(m[1]));
  const relsPath = (p) => p.replace("slides/", "slides/_rels/") + ".rels";
  let next = 100;
  const newParts = [];

  // a copy of a template slide (no speaker notes), optionally with its XML changed
  async function clone(idx, edit) {
    const src = tplSlides[idx];
    let xml = await read(src);
    if (edit) xml = edit(xml);
    const rels = (await read(relsPath(src))).replace(/<Relationship [^>]*?notesSlide[^>]*?\/>/g, "");
    let name; // a new name: never one of the template's own slides (slide100 is the song prototype)
    do name = `ppt/slides/slide${next++}.xml`; while (zip.file(name));
    zip.file(name, xml); zip.file(relsPath(name), rels);
    newParts.push(name);
    return name;
  }
  const songSlides = async (it) => {
    const out = [];
    const stanzas = slideStanzas(it.songs.content);
    if (!stanzas.length) {
      out.push(await clone(TPL.song, (xml) => {
        const [titleSp, lyricSp] = shapes(xml).filter((sp) => /<a:t>/.test(sp));
        const x = xml.replace(titleSp, setParagraphs(titleSp, [it.songs.title], (ps) => ps[0]));
        return lyricSp ? x.replace(lyricSp, setParagraphs(lyricSp, [""], (ps) => ps[0])) : x;
      }));
    }
    for (const st of stanzas) {
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

  // home groups + meetings: same slide, fresh text
  const groups = await serviceGroupLines().catch(() => null);
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

  // slide order from deckPlan (deck.js): welcome, blank, songs (a blank between), communion, …, then the fixed tail
  const order = [];
  let blanks = 0, masters = [];
  const texts = typeof meetingTextsFor === "function" ? await meetingTextsFor(iso).catch(() => null) : null;
  for (const e of deckPlan(items, (it) => it.songs.content)) {
    // prayer requests (typed in the site, presentation.js): the template's slide, 9 requests a slide
    if (e.weekly === "prayers" && typeof prayerLinesFor === "function") {
      const lines = await prayerLinesFor(iso).catch(() => []);
      for (let i = 0; i < lines.length; i += 9) {
        order.push(await clone(TPL.prayers, (xml) => prayerSlideXml(xml, lines.slice(i, i + 9))));
      }
      continue;
    }
    // the speaker's PowerPoint, as it is (animations too), right after the "דרשה" slide
    if (e.sermon && typeof sermonPptxFor === "function") {
      try {
        const s = await sermonPptxFor(iso);
        if (s) { const r = await importPptxSlides(zip, s.buf); order.push(...r.slides); masters = masters.concat(r.masters); }
      } catch (err) { console.error(err); toast("לא הצלחתי להכניס את מצגת הדרשה", { error: true }); }
      continue;
    }
    // the week's parasha + reading (typed in the site, presentation.js): only when there is one
    if ((e.weekly === "parasha" || e.weekly === "reading") && texts) {
      const two = (xml) => { const sps = shapes(xml).filter((sp) => /<p:txBody>/.test(sp)); return [sps.find((sp) => /name="Title/.test(sp)) || sps[0], sps.find((sp) => !/name="Title/.test(sp)) || sps[1]]; };
      const fill = (xml, title, lines) => { const [t, bd] = two(xml); let x = t ? xml.replace(t, setParagraphs(t, [title], (ps) => ps[0])) : xml; return bd ? x.replace(bd, setParagraphs(bd, lines, (ps) => ps[0])) : x; };
      if (e.weekly === "parasha" && (texts.parasha || texts.parasha_refs))
        order.push(await clone(TPL.parasha, (xml) => fill(xml, texts.parasha, texts.parasha_refs.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))));
      if (e.weekly === "reading") for (const ps of texts.passages || []) for (const page of (ps.text ? readingPages(ps.text) : [[]])) order.push(await clone(TPL.reading, (xml) => fill(xml, ps.ref, page)));
      continue;
    }
    // the Lord's Supper verse typed in the site replaces the template's
    if (e.tpl === "communion_verse" && texts?.communion_verse) {
      const verse = texts.communion_verse.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      order.push(await clone(TPL.communion_verse, (xml) => {
        const sp = shapes(xml).find((s) => /<a:t>/.test(s));
        return sp ? xml.replace(sp, setParagraphs(sp, [...verse, ...(texts.communion_ref ? [texts.communion_ref] : [])], (ps, t, n) => (n < verse.length ? ps[0] : ps[ps.length - 1]))) : xml;
      }));
      continue;
    }
    if (e.sermon || e.weekly) continue; // a PDF sermon and the opening verse live on the projection computer
    if (e.song) order.push(...(await songSlides(e.song)));
    else if (e.tpl === "blank") order.push(blanks++ ? await clone(TPL.blank) : tplSlides[TPL.blank]); // each slide once in a .pptx
    else order.push(tplSlides[TPL[e.tpl]]);
  }

  // template slides this presentation doesn't use (the song prototype, the weekly slides): remove them + their notes
  const unused = tplSlides.filter((p) => !order.includes(p)), unusedNotes = [];
  for (const p of unused) {
    const n = ((await read(relsPath(p)).catch(() => "")).match(/Target="\.\.\/notesSlides\/([^"]+)"/) || [])[1];
    if (n) { unusedNotes.push(n); zip.remove(`ppt/notesSlides/${n}`); zip.remove(`ppt/notesSlides/_rels/${n}.rels`); }
    zip.remove(p); zip.remove(relsPath(p));
  }

  // rewrite the slide list
  let rels = presRels.replace(/<Relationship [^>]*?Target="slides\/[^"]+"[^>]*?\/>/g, "");
  const ids = order.map((p, n) => {
    const rid = `rIdS${n + 1}`;
    rels = rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${p.replace("ppt/", "")}"/></Relationships>`);
    return `<p:sldId id="${300 + n}" r:id="${rid}"/>`;
  }).join("");
  let pres = presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${ids}</p:sldIdLst>`);
  if (masters.length) ({ presXml: pres, presRels: rels } = await registerMasters(zip, pres, rels, masters));
  zip.file("ppt/presentation.xml", pres);
  zip.file("ppt/_rels/presentation.xml.rels", rels);
  let ct = await read("[Content_Types].xml");
  for (const p of unused) ct = ct.replace(new RegExp(`<Override PartName="/${p}"[^>]*/>`), "");
  for (const n of unusedNotes) ct = ct.replace(new RegExp(`<Override PartName="/ppt/notesSlides/${n}"[^>]*/>`), "");
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
  const quick = t.closest("[data-sl-quickadd]");
  if (quick) {
    const iso = setlist.openDate;
    if (!canEditSetlist(iso)) { leaderOnly(iso); return; }
    if (quick.disabled) return;
    quick.disabled = true;
    await loadSetlist();
    if (itemsFor(iso).some((i) => i.song_id === Number(quick.dataset.slQuickadd))) { toast("השיר כבר בסט"); quick.disabled = false; return; }
    const pos = Math.max(0, ...itemsFor(iso).map((i) => i.position)) + 1;
    const { error } = await sb.from("setlist_items").insert({ meeting_date: iso, song_id: Number(quick.dataset.slQuickadd), position: pos, notes: null });
    if (error) { error.code === "42501" ? leaderOnly(iso) : toast("ההוספה נכשלה"); quick.disabled = false; return; }
    await loadSetlist();
    setlist.query = "";
    renderSetlistDialog();
    toast("השיר נוסף לסט");
    document.getElementById("sl-search")?.focus();
    return;
  }
  // the projection screen: one fixed link for the HDMI computer (screen.html picks the upcoming meeting by itself)
  if (t.closest("[data-sl-screen]")) { window.open("screen.html", "_blank"); return; }
  // "סעודת האדון": a special song ({screen: quiet} → title alone on the screen), created once, added at the end
  const supper = t.closest("[data-sl-supper]");
  if (supper) {
    const iso = setlist.openDate;
    if (!canEditSetlist(iso)) { leaderOnly(iso); return; }
    if (setlist.busy) return;
    setlist.busy = true; supper.disabled = true;
    try { await addSupper(iso); } finally { setlist.busy = false; supper.disabled = false; }
    return;
  }
  const add = t.closest("[data-sl-add]");
  if (add) {
    const iso = document.getElementById("sl-date").value;
    const notes = document.getElementById("sl-new-note").value.trim() || null;
    if (!canEditSetlist(iso)) { leaderOnly(iso); return; }
    if (add.disabled) return;
    add.disabled = true;
    await loadSetlist();
    if (itemsFor(iso).some((i) => i.song_id === Number(add.dataset.slAdd))) { toast("השיר כבר בסשן הזה"); add.disabled = false; return; }
    const pos = Math.max(0, ...itemsFor(iso).map((i) => i.position)) + 1;
    const { error } = await sb.from("setlist_items").insert({ meeting_date: iso, song_id: Number(add.dataset.slAdd), position: pos, notes });
    add.disabled = false;
    if (error) { error.code === "42501" ? leaderOnly(iso) : toast("ההוספה נכשלה"); return; }
    await loadSetlist(); dialogEl().close(); toast("השיר נוסף לסשן"); return;
  }
  const mv = t.closest("[data-sl-move]");
  if (mv) {
    if (!canEditSetlist(setlist.openDate)) { leaderOnly(setlist.openDate); return; }
    if (setlist.busy) return;
    setlist.busy = true;
    try { await moveItem(Number(mv.dataset.slMove), Number(mv.dataset.dir)); } finally { setlist.busy = false; }
    return;
  }
  const rm = t.closest("[data-sl-remove]");
  if (rm) {
    if (!canEditSetlist(setlist.openDate)) { leaderOnly(setlist.openDate); return; }
    if (setlist.busy) return;
    setlist.busy = true; rm.disabled = true;
    try { await removeItem(Number(rm.dataset.slRemove)); } finally { setlist.busy = false; }
    return;
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

// "סעודת האדון": a special song ({screen: quiet} → title alone on the screen), created once, added at the end
async function addSupper(iso) {
  if (!songsState.loaded) await loadSongs();
  let s = songsState.list.find((x) => x.title.trim() === "סעודת האדון");
  if (!s) {
    const { data, error } = await sb.from("songs").insert({ title: "סעודת האדון", content: "{screen: quiet}", song_key: null }).select().single();
    if (error || !data) { toast("לא הצלחתי ליצור את הפריט", { error: true }); return; }
    s = data; songsState.list.push(data);
  }
  await loadSetlist();
  if (itemsFor(iso).some((i) => i.song_id === s.id)) { toast("סעודת האדון כבר בסט"); return; }
  const pos = Math.max(0, ...itemsFor(iso).map((i) => i.position)) + 1;
  const { error } = await sb.from("setlist_items").insert({ meeting_date: iso, song_id: s.id, position: pos, notes: null });
  if (error) { error.code === "42501" ? leaderOnly(iso) : toast("ההוספה נכשלה"); return; }
  await loadSetlist(); renderSetlistDialog();
  toast("סעודת האדון נוספה — אפשר להוסיף שיר אחריה");
}

async function moveItem(id, dir) {
  const items = itemsFor(setlist.openDate);
  const k = items.findIndex((i) => i.id === id), j = k + dir;
  if (k < 0 || j < 0 || j >= items.length) return;
  const order = items.map((i) => i.id);
  [order[k], order[j]] = [order[j], order[k]];
  const res = await Promise.all(order.map((x, n) => sb.from("setlist_items").update({ position: n + 1 }).eq("id", x).select("id")));
  if (res.some((r) => r.error || !r.data?.length)) leaderOnly(setlist.openDate);
  await loadSetlist(); renderSetlistDialog();
}

// removing: an undo toast instead of a question (one slip on a small ✕ shouldn't lose a song + its note)
async function removeItem(id) {
  const it = setlist.items.find((i) => i.id === id);
  const { data, error } = await sb.from("setlist_items").delete().eq("id", id).select("id");
  if (error) { toast("ההסרה נכשלה"); renderSetlistDialog(); return; }
  if (!data?.length) { // nothing deleted: already gone (a double tap) or blocked by the DB
    await loadSetlist(); renderSetlistDialog();
    if (setlist.items.some((i) => i.id === id)) leaderOnly(setlist.openDate);
    return;
  }
  await loadSetlist(); renderSetlistDialog();
  if (it) {
    const u = { meeting_date: it.meeting_date, song_id: it.song_id, position: it.position, notes: it.notes };
    toast(`"${it.songs?.title || "השיר"}" הוסר`, { action: { label: "ביטול", fn: async () => {
      const { error } = await sb.from("setlist_items").insert(u);
      if (error) { toast("ההחזרה נכשלה"); return; }
      await loadSetlist(); renderSetlistDialog(); toast("השיר חזר לסט");
    } } });
  }
}

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
const live = { on: false, idx: 0, shift: {}, noCapo: {}, chords: true, zoom: 1, myCapo: 0, panel: false };
try { live.zoom = Number(localStorage.getItem("ws-live-zoom")) || 1; } catch {}
try { live.myCapo = Number(localStorage.getItem("ws-live-capo")) || 0; } catch {} // personal capo, only with live sync (live-sync.js)

// open the live view for a date: from the last position on this device (live-sync.js keeps it per date)
function startLive(date) {
  setlist.openDate = date;
  Object.assign(live, { on: true, idx: 0, shift: {} });
  if (typeof restoreLivePos === "function") restoreLivePos(date);
  // key changes kept from an earlier opening (e.g. the rehearsal) come back with the position: say so out loud,
  // so nobody finds out in the middle of the set that a song isn't in its key
  live.shiftWarn = Object.values(live.shift).some(Boolean);
  document.documentElement.requestFullscreen?.().catch(() => {});
  renderLive();
  if (typeof syncStart === "function") syncStart(date);
}

function liveEl() {
  let el = document.getElementById("live-view");
  if (!el) { el = document.createElement("div"); el.id = "live-view"; el.className = "live-view"; el.hidden = true; document.body.append(el); }
  return el;
}

function renderLive() {
  const items = itemsFor(setlist.openDate).filter((i) => i.songs);
  const el = liveEl();
  if (!live.on || !items.length) { el.hidden = true; el._sig = ""; return; }
  live.idx = Math.max(0, Math.min(live.idx, items.length - 1));
  const it = items[live.idx], song = it.songs, meta = songMeta(song.content);
  const capo = Number(meta.capo) || 0;
  const myCapo = syncActive() ? live.myCapo || 0 : 0;
  const shift = (live.shift[it.id] || 0) + (live.noCapo[it.id] ? capo : 0) - myCapo;
  const base = song.song_key || firstChord(song.content);
  const key = base ? transposeChord(base, shift + myCapo, prefersFlats(base, shift + myCapo)) : "";          // the key everyone plays in
  const shapes = base && myCapo ? transposeChord(base, shift, prefersFlats(base, shift)) : "";       // what my fingers play with my capo
  const next = items[live.idx + 1];
  const sig = [it.id, shift, live.chords, live.zoom, song.content.length].join("|");
  const old = el.querySelector(".live-body");
  const keep = el._sig === sig && old ? { l: old.scrollLeft, t: old.scrollTop } : null;
  el._sig = sig;
  el.hidden = false;
  el.style.setProperty("--live-zoom", live.zoom);
  el.innerHTML = `
    <div class="live-bar">
      <div class="live-row">
        <span class="live-pos">${live.idx + 1}/${items.length}</span>
        <strong class="live-title">${esc(song.title)}</strong>
        <span class="live-key">סולם <b dir="ltr">${esc(key)}</b>${shapes ? `<small> · קאפו ${myCapo}: <b dir="ltr">${esc(shapes)}</b></small>` : ""}${live.shift[it.id] && base ? `<small class="live-shifted"> · מקורי <b dir="ltr">${esc(base)}</b></small>` : ""}</span>
        <button class="tool live-exit" data-live="exit" aria-label="יציאה ממצב הלל" title="יציאה">✕</button>
      </div>
      ${it.notes ? `<div class="live-note">📝 ${esc(it.notes)}</div>` : ""}
      <div class="live-row live-quick">
        ${syncStatusHtml()}
        ${syncLocksKey() ? "" : `<span class="live-keys"><button class="tool" dir="ltr" data-live="key-1" aria-label="חצי טון למטה">−½</button><button class="tool" dir="ltr" data-live="key+1" aria-label="חצי טון למעלה">+½</button>${live.shift[it.id] ? `<button class="tool link" data-live="key0">מקורי</button>` : ""}</span>`}
        ${syncQuickHtml()}
        <button class="tool live-gear${live.panel ? " on" : ""}" data-live="panel" aria-expanded="${live.panel}">⚙ תצוגה</button>
      </div>
      ${live.panel ? `<div class="live-panel">
        <span class="live-zoom"><button class="tool" data-live="zoom-1" aria-label="הקטנה">א−</button><button class="tool" data-live="zoom+1" aria-label="הגדלה">א+</button></span>
        <button class="tool${live.chords ? " on" : ""}" data-live="chords">${live.chords ? "אקורדים ✓" : "בלי אקורדים"}</button>
        ${capo ? `<button class="tool${live.noCapo[it.id] ? " on" : ""}" data-live="capo">${live.noCapo[it.id] ? "עם קאפו " + capo : "בלי קאפו"}</button>` : ""}
        ${syncPanelHtml()}
      </div>` : ""}
    </div>
    ${shiftWarnHtml(items)}${syncPeopleHtml()}${syncAwayHtml()}
    <div class="live-body"><div class="chordpro song-body">${quietItem(song) ? `<p class="quiet-item">🍞 ${esc(song.title)} · שקט</p>` : renderChordPro(song.content, shift, { chords: live.chords, key: base })}</div></div>
    <div class="live-nav">
      <button class="tool" data-live="prev" ${live.idx ? "" : "disabled"}>→ הקודם</button>
      <span class="live-next">${next ? `הבא: ${esc(next.songs.title)}` : "שיר אחרון"}</span>
      <button class="tool" data-live="next" ${next ? "" : "disabled"}>הבא ←</button>
    </div>`;
  fitLive(el);
  if (keep) { const b = el.querySelector(".live-body"); b.scrollLeft = keep.l; b.scrollTop = keep.t; }
}

// the banner for key changes left over from an earlier opening (only for whoever can change keys: the leader / no sync)
function shiftWarnHtml(items) {
  const moved = items.filter((i) => live.shift[i.id]);
  if (!live.shiftWarn || !moved.length || syncLocksKey()) return "";
  const list = moved.map((i) => {
    const base = i.songs.song_key || firstChord(i.songs.content || ""), n = live.shift[i.id];
    return `${esc(i.songs.title)}: ${base ? `<b dir="ltr">${esc(transposeChord(base, n, prefersFlats(base, n)))}</b> במקום <b dir="ltr">${esc(base)}</b>` : `${n > 0 ? "+" : "−"}${n * n === 1 ? "½" : Math.abs(n) / 2} טון`}`;
  }).join(" · ");
  return `<div class="live-away live-shift-warn">⚠ לא בסולם המקורי (נשמר מפתיחה קודמת): ${list}
    <button class="tool" data-live="shiftreset">הכל לסולם המקורי</button><button class="tool" data-live="shiftkeep">להשאיר</button></div>`;
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
  if (a === "panel") { live.panel = !live.panel; renderLive(); return; }
  if (syncAction(a)) { renderLive(); return; }
  // a follower who moves on their own stops following (a bar offers the way back), like OnSong
  if (syncActive() && !sync.iLead && sync.follow && (a === "next" || a === "prev")) sync.follow = false;
  if (a === "shiftreset") { live.shift = {}; live.shiftWarn = false; }
  else if (a === "shiftkeep") live.shiftWarn = false;
  else if (a === "exit") { live.on = false; syncStop(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }
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
  if (sync.iLead && (a === "next" || a === "prev" || a.startsWith("key") || a === "shiftreset")) broadcastState();
}

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-sl-live]")) {
    dialogEl().close();
    startLive(setlist.openDate); return;
  }
  const b = e.target.closest("[data-live]");
  if (b) liveAction(b.dataset.live);
});
// keyboard / foot pedal: arrows or PageUp/PageDown change song, +/- zoom, Esc leaves
document.addEventListener("keydown", (e) => {
  if (!live.on) return;
  // while following the leader, the pedal / arrows only turn columns inside the song: the leader changes songs
  const locked = typeof syncLocksKey === "function" && syncLocksKey();
  if (["ArrowLeft", "PageDown", " "].includes(e.key)) { e.preventDefault(); liveCanScroll("next") ? liveScroll("next") : locked || liveAction("next"); }
  else if (["ArrowRight", "PageUp"].includes(e.key)) { e.preventDefault(); liveCanScroll("prev") ? liveScroll("prev") : locked || liveAction("prev"); }
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
  // finger to the right reveals the next column (Hebrew reads right to left); past the last column = next song,
  // except while following the leader (then a swipe never changes the song by accident)
  if (typeof syncLocksKey === "function" && syncLocksKey()) return;
  if (dx > 70 && touchNext) liveAction("next");
  else if (dx < -70 && touchPrev) liveAction("prev");
}, { passive: true });

window.addEventListener("resize", () => { if (live.on) fitLive(liveEl()); });
