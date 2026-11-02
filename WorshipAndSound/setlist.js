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
    const extra = meetingKind(m.day) === "קבלת שבת" ? "קבלת שבת" : /בפטיסט/.test(m.place) ? "צ'אפל" : (m.notes || "");
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
      for (const part of chunks(st.lines, long ? 3 : 4)) {
        out.push(await clone(TPL.song, (xml) => {
          const [titleSp, lyricSp] = shapes(xml).filter((sp) => /<a:t>/.test(sp));
          let x = xml.replace(titleSp, setParagraphs(titleSp, [it.songs.title], (ps) => ps[0]));
          return x.replace(lyricSp, setParagraphs(lyricSp, part, (ps) => ps[0]));
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
