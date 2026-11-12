"""Build WorshipAndSound/template.pptx from a full service presentation (e.g. 2026-10-31.pptx).

Keeps only the fixed slides, in the service's order, plus ONE song slide as the prototype (its words replaced by
placeholders). Removes the songs, the sermon, the weekly reading, every speaker note and every picture nothing uses.
The site never publishes the source file: it may hold lyrics and sermon notes.

    python scripts/build_template.py "path/to/service.pptx"

Then run scripts/pptx_to_deck.py so the projection screen follows.

KEEP lists the source slide numbers (1-based) and the name each gets. The names are what setlist.js (TPL) and
deck.js (deckPlan) use. NOT kept on purpose: the standing prayer-requests slide — it lists people with health and
family details, and this repository is public.
"""
import io, re, sys, zipfile, posixpath

KEEP = [  # (source slide number, name)
    (1, "welcome"), (2, "verse"), (3, "blank"), (4, "song"), (23, "communion"), (25, "communion_verse"),
    (34, "blessing"), (36, "sermon_title"), (54, "testimonies"), (56, "groups"), (57, "meetings"),
    (58, "tithes"), (59, "closing"),
]
SRC = sys.argv[1]
DST = "WorshipAndSound/template.pptx"

zin = zipfile.ZipFile(SRC)
files = {n: zin.read(n) for n in zin.namelist()}
txt = lambda n: files[n].decode("utf-8")

pres = txt("ppt/presentation.xml")
prels = txt("ppt/_rels/presentation.xml.rels")
def rel_target(rels, rid):
    m = re.search(r'<Relationship [^>]*?Id="%s"[^>]*?Target="([^"]+)"' % rid, rels) or re.search(r'<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="%s"' % rid, rels)
    return m.group(1)
sld = re.findall(r'(<p:sldId [^>]*?r:id="(rId\d+)"\s*/>)', pres)
slide_of = [("ppt/" + rel_target(prels, rid), tag, rid) for tag, rid in sld]
keep_paths = [slide_of[n - 1][0] for n, _ in KEEP]
keep_tags = [slide_of[n - 1][1] for n, _ in KEEP]
drop_slides = [p for p, _, _ in slide_of if p not in keep_paths]
rels_of = lambda p: posixpath.join(posixpath.dirname(p), "_rels", posixpath.basename(p) + ".rels")

# the slide list: kept slides only, in KEEP order
pres = re.sub(r"<p:sldIdLst>.*?</p:sldIdLst>", "<p:sldIdLst>" + "".join(keep_tags) + "</p:sldIdLst>", pres, flags=re.S)
files["ppt/presentation.xml"] = pres.encode("utf-8")
for p, tag, rid in slide_of:
    if p in drop_slides:
        prels = re.sub(r'<Relationship [^>]*?Id="%s"[^>]*?/>' % rid, "", prels)
files["ppt/_rels/presentation.xml.rels"] = prels.encode("utf-8")

removed = set()
def remove(part):
    for n in (part, rels_of(part)):
        if n in files: del files[n]; removed.add("/" + n)

# no speaker notes anywhere (they hold sermon notes)
for n in list(files):
    if n.startswith("ppt/notesSlides/"): del files[n]; removed.add("/" + n)
for p in keep_paths:
    r = rels_of(p)
    if r in files:
        files[r] = re.sub(r'<Relationship [^>]*?notesSlide"?[^>]*?/>', "", txt(r)).encode("utf-8")
        files[r] = re.sub(r'<Relationship [^>]*?Target="\.\./notesSlides/[^"]+"[^>]*?/>', "", txt(r)).encode("utf-8")
for p in drop_slides: remove(p)

# the song prototype: words → placeholders (the site writes the real title and lines)
song = keep_paths[[k for _, k in KEEP].index("song")]
sx = txt(song)
shapes = [s for s in re.findall(r"<p:sp>.*?</p:sp>", sx, re.S) if re.search(r"<a:t>[^<]", s)]
for i, sp in enumerate(shapes):
    first = [True]
    def blank(m):
        if first[0]: first[0] = False; return "<a:t>%s</a:t>" % ("שם השיר" if i == 0 else "שורה")
        return "<a:t></a:t>"
    sx = sx.replace(sp, re.sub(r"<a:t>[^<]*</a:t>", blank, sp))
files[song] = sx.encode("utf-8")

# pictures nothing points at any more
used = set()
for n, data in files.items():
    if n.endswith(".rels"):
        base = posixpath.dirname(posixpath.dirname(n))
        for t in re.findall(r'Target="([^"]+)"', data.decode("utf-8")):
            if not t.startswith("http"): used.add(posixpath.normpath(posixpath.join(base, t)))
for n in list(files):
    if n.startswith("ppt/media/") and n not in used: del files[n]; removed.add("/" + n)

# content types + app.xml (slide titles / counts would describe the removed slides)
ct = txt("[Content_Types].xml")
for part in removed:
    ct = re.sub(r'<Override PartName="%s"[^>]*/>' % re.escape(part), "", ct)
files["[Content_Types].xml"] = ct.encode("utf-8")
if "docProps/app.xml" in files:
    app = txt("docProps/app.xml")
    app = re.sub(r"<HeadingPairs>.*?</HeadingPairs>|<TitlesOfParts>.*?</TitlesOfParts>", "", app, flags=re.S)
    app = re.sub(r"<Slides>\d+</Slides>", "<Slides>%d</Slides>" % len(KEEP), app)
    app = re.sub(r"<Notes>\d+</Notes>", "<Notes>0</Notes>", app)
    files["docProps/app.xml"] = app.encode("utf-8")

with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
    for n in zin.namelist():
        if n in files: zout.writestr(n, files[n])
print("template:", len(KEEP), "slides,", sum(1 for n in files if n.startswith("ppt/media/")), "pictures ->", DST)
