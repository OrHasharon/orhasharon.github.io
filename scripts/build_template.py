"""Build WorshipAndSound/template.pptx — the service presentation's fixed slides, in order.

    python scripts/build_template.py BASE.pptx EXTRA.pptx

BASE (e.g. the 14.11.2026 presentation) gives the look — its master background and theme — and the slides it has.
EXTRA (e.g. the 31.10.2026 presentation) gives the slides BASE doesn't have; they are copied over and made to stand
on their own in BASE's look: positions their layout used to give them are written in, text with no colour of its own
becomes white (BASE's dark background), theme fonts are written out (David / Arial as in EXTRA).

The song slide is kept as a prototype with placeholder words. The weekly slides (opening verse, parasha, reading,
prayer requests) keep only their design: every word is removed — the prayer requests name people with health and
family details, and this repository is public. Speaker notes are dropped everywhere. The source files themselves are
never published (lyrics, sermon notes).

Then run scripts/pptx_to_deck.py so the projection screen follows. The names below are the ones setlist.js (TPL),
deck.js (deckPlan) and pptx_to_deck.py (ORDER) use.
"""
import re, sys, zipfile, posixpath

BASE_KEEP = {1: "welcome", 2: "blank", 3: "song", 31: "communion", 35: "blessing", 36: "testimonies", 37: "groups", 38: "meetings"}
EXTRA_TAKE = {2: "verse", 25: "communion_verse", 32: "parasha", 33: "reading", 36: "sermon_title", 55: "prayers", 58: "tithes", 59: "closing"}
ORDER = ["welcome", "verse", "blank", "song", "communion", "communion_verse", "parasha", "reading", "blessing",
         "sermon_title", "testimonies", "prayers", "groups", "meetings", "tithes", "closing"]
SCRUB = {"song": None, "verse": None, "parasha": None, "reading": None, "prayers": [1]}  # text boxes by order; None = all
DST = "WorshipAndSound/template.pptx"


def load(path):
    z = zipfile.ZipFile(path)
    return z, {n: z.read(n) for n in z.namelist()}

zb, B = load(sys.argv[1])
ze, E = load(sys.argv[2])
T = lambda files, n: files[n].decode("utf-8")
rels_of = lambda p: posixpath.join(posixpath.dirname(p), "_rels", posixpath.basename(p) + ".rels")

def rel_target(rels, rid):
    m = re.search(r'<Relationship [^>]*?Id="%s"[^>]*?Target="([^"]+)"' % re.escape(rid), rels) or \
        re.search(r'<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="%s"' % re.escape(rid), rels)
    return m.group(1)

def slides(files):
    pres, prels = T(files, "ppt/presentation.xml"), T(files, "ppt/_rels/presentation.xml.rels")
    return [("ppt/" + rel_target(prels, rid), tag, rid) for tag, rid in re.findall(r'(<p:sldId [^>]*?r:id="([^"]+)"\s*/>)', pres)]

bs, es = slides(B), slides(E)
removed = set()
def drop(files, part):
    for n in (part, rels_of(part)):
        if n in files: del files[n]; removed.add("/" + n)

# ---------- BASE: keep its fixed slides, drop the rest and every note ----------
keep = {name: bs[n - 1] for n, name in BASE_KEEP.items()}
for p, _, _ in bs:
    if p not in [k[0] for k in keep.values()]: drop(B, p)
for n in list(B):
    if n.startswith("ppt/notesSlides/"): del B[n]; removed.add("/" + n)
def strip_notes(files, p):
    r = rels_of(p)
    if r in files: files[r] = re.sub(r'<Relationship [^>]*?notesSlide[^>]*?/>', "", T(files, r)).encode("utf-8")
for p, _, _ in keep.values(): strip_notes(B, p)
base_layout = re.search(r'Target="(\.\./slideLayouts/[^"]+)"', T(B, rels_of(keep["blank"][0]))).group(1)

# ---------- EXTRA: theme fonts + placeholder geometry, to write into the copied slides ----------
eth = T(E, "ppt/theme/theme1.xml")
def tfont(kind):
    blk = re.search(r"<a:%s>(.*?)</a:%s>" % (kind, kind), eth, re.S).group(1)
    heb = re.search(r'<a:font script="Hebr" typeface="([^"]+)"', blk)
    return (heb.group(1) if heb else "") or re.search(r'<a:latin typeface="([^"]*)"', blk).group(1)
EFONT = {"+mn-lt": tfont("minorFont"), "+mn-cs": tfont("minorFont"), "+mj-lt": tfont("majorFont"), "+mj-cs": tfont("majorFont")}

def ph_xfrm(slide_path, ph_tag):
    """the <a:xfrm> the slide's own layout (or master) gives this placeholder"""
    typ = (re.search(r'type="(\w+)"', ph_tag) or [0, "body"])[1]
    idx = (re.search(r'idx="(\d+)"', ph_tag) or [0, None])[1]
    layout = posixpath.normpath(posixpath.join("ppt/slides", re.search(r'Target="(\.\./slideLayouts/[^"]+)"', T(E, rels_of(slide_path))).group(1)))
    master = posixpath.normpath(posixpath.join("ppt/slideLayouts", re.search(r'Target="(\.\./slideMasters/[^"]+)"', T(E, rels_of(layout))).group(1)))
    for part in (layout, master):
        for sp in re.findall(r"<p:sp>.*?</p:sp>", T(E, part), re.S):
            m = re.search(r"<p:ph([^>]*)/?>", sp)
            if not m: continue
            t2 = (re.search(r'type="(\w+)"', m.group(1)) or [0, "body"])[1]
            i2 = (re.search(r'idx="(\d+)"', m.group(1)) or [0, None])[1]
            if t2 == typ or (t2 in ("title", "ctrTitle") and typ in ("title", "ctrTitle")) or (idx and i2 == idx):
                x = re.search(r"<a:xfrm[^>]*>.*?</a:xfrm>", sp, re.S)
                if x: return x.group(0)
    return None

def standalone(xml, slide_path):
    """placeholders → plain shapes with their position written in; runs get a colour and a font of their own"""
    def fix_sp(m):
        sp = m.group(0)
        ph = re.search(r"<p:ph([^>]*)/?>", sp)
        if ph:
            if not re.search(r"<p:spPr[^>]*>.*?<a:xfrm", sp, re.S):
                xf = ph_xfrm(slide_path, ph.group(1)) or ""
                if re.search(r"<p:spPr\s*/>", sp): sp = re.sub(r"<p:spPr\s*/>", "<p:spPr>%s</p:spPr>" % xf, sp, 1)
                else: sp = re.sub(r"(<p:spPr[^>]*>)", r"\1" + xf.replace("\\", "\\\\"), sp, 1)
            sp = re.sub(r"<p:ph[^>]*/>|<p:ph[^>]*>.*?</p:ph>", "", sp, 1, flags=re.S)
        return sp
    xml = re.sub(r"<p:sp>.*?</p:sp>", fix_sp, xml, flags=re.S)
    WHITE = '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>'
    def font_for(attrs_and_body):
        f = EFONT["+mn-cs"]
        return '<a:latin typeface="%s"/><a:cs typeface="%s"/>' % (f, f)
    def fix_rpr(m):
        tag, attrs, body = m.group(1), m.group(2), m.group(3) or ""
        for k, v in EFONT.items(): body = body.replace('typeface="%s"' % k, 'typeface="%s"' % v)
        if "<a:solidFill>" not in body and "<a:gradFill>" not in body and "<a:noFill/>" not in body:
            body = (re.sub(r"^(<a:ln\b.*?</a:ln>|<a:ln[^>]*/>)", r"\1" + WHITE, body, 1, flags=re.S) if body.startswith("<a:ln") else WHITE + body)
        if "<a:latin " not in body and "<a:cs " not in body:
            hl = body.find("<a:hlinkClick")
            body = body[:hl] + font_for(body) + body[hl:] if hl >= 0 else body + font_for(body)
        return "<a:%s%s>%s</a:%s>" % (tag, attrs, body, tag)
    xml = re.sub(r"<a:(rPr|endParaRPr|defRPr)(\b[^>]*?)(?:/>|>(.*?)</a:\1>)", fix_rpr, xml, flags=re.S)
    xml = re.sub(r"<a:r><a:t>", '<a:r><a:rPr lang="he-IL">%s%s</a:rPr><a:t>' % (WHITE, font_for("")), xml)
    return xml

# ---------- copy EXTRA's slides into BASE ----------
ct = T(B, "[Content_Types].xml")
for ext, mime in (("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("gif", "image/gif"), ("svg", "image/svg+xml"), ("webp", "image/webp"), ("emf", "image/x-emf"), ("wmf", "image/x-wmf")):
    if 'Extension="%s"' % ext not in ct.lower() and 'extension="%s"' % ext not in ct.lower():
        ct = ct.replace("</Types>", '<Default Extension="%s" ContentType="%s"/></Types>' % (ext, mime))
added = {}
for i, (n, name) in enumerate(EXTRA_TAKE.items()):
    src = es[n - 1][0]
    dst = "ppt/slides/slide%d.xml" % (900 + i)
    B[dst] = standalone(T(E, src), src).encode("utf-8")
    rels = T(E, rels_of(src))
    out = []
    for r in re.findall(r"<Relationship [^>]*?/>", rels):
        if "notesSlide" in r: continue
        if "/slideLayout" in r:
            out.append(re.sub(r'Target="[^"]+"', 'Target="%s"' % base_layout, r)); continue
        tg = re.search(r'Target="([^"]+)"', r).group(1)
        if "TargetMode=\"External\"" in r or tg.startswith("http"): out.append(r); continue
        full = posixpath.normpath(posixpath.join("ppt/slides", tg))
        newm = "ppt/media/x%d_%s" % (900 + i, posixpath.basename(full))
        B[newm] = E[full]
        out.append(re.sub(r'Target="[^"]+"', 'Target="../media/%s"' % posixpath.basename(newm), r))
    B[rels_of(dst)] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>' % "".join(out)).encode("utf-8")
    ct = ct.replace("</Types>", '<Override PartName="/%s" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>' % dst)
    added[name] = dst

# ---------- weekly / song slides: words → placeholders ----------
paths = {name: k[0] for name, k in keep.items()}
paths.update(added)
for key, which in SCRUB.items():
    x = T(B, paths[key])
    shapes = [sp for sp in re.findall(r"<p:sp>.*?</p:sp>", x, re.S) if re.search(r"<a:t>[^<]", sp)]
    for i, sp in enumerate(shapes):
        if which is not None and i not in which: continue
        new = sp
        for p in re.findall(r"<a:p>.*?</a:p>", sp, re.S):
            first = [True]
            def blank(m):
                if first[0]: first[0] = False; return "<a:t>טקסט</a:t>"
                return "<a:t></a:t>"
            new = new.replace(p, re.sub(r"<a:t>[^<]*</a:t>", blank, p), 1)
        x = x.replace(sp, new)
    B[paths[key]] = x.encode("utf-8")

# ---------- the slide list, in ORDER ----------
pres, prels = T(B, "ppt/presentation.xml"), T(B, "ppt/_rels/presentation.xml.rels")
for p, _, rid in bs:
    if p not in paths.values(): prels = re.sub(r'<Relationship [^>]*?Id="%s"[^>]*?/>' % re.escape(rid), "", prels)
next_id = max(int(v) for v in re.findall(r'<p:sldId id="(\d+)"', pres)) + 1
tags = []
for name in ORDER:
    if name in keep: tags.append(keep[name][1]); continue
    rid = "rIdT%d" % next_id
    prels = prels.replace("</Relationships>", '<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="%s"/></Relationships>' % (rid, added[name].replace("ppt/", "")))
    tags.append('<p:sldId id="%d" r:id="%s"/>' % (next_id, rid)); next_id += 1
B["ppt/presentation.xml"] = re.sub(r"<p:sldIdLst>.*?</p:sldIdLst>", "<p:sldIdLst>" + "".join(tags) + "</p:sldIdLst>", pres, flags=re.S).encode("utf-8")
B["ppt/_rels/presentation.xml.rels"] = prels.encode("utf-8")

# ---------- pictures nothing uses, content types, app.xml ----------
used = set()
for n, data in B.items():
    if n.endswith(".rels"):
        base = posixpath.dirname(posixpath.dirname(n))
        for tg in re.findall(r'Target="([^"]+)"', data.decode("utf-8")):
            if not tg.startswith("http"): used.add(posixpath.normpath(posixpath.join(base, tg)))
for n in list(B):
    if n.startswith("ppt/media/") and n not in used: del B[n]; removed.add("/" + n)
for part in removed: ct = re.sub(r'<Override PartName="%s"[^>]*/>' % re.escape(part), "", ct)
B["[Content_Types].xml"] = ct.encode("utf-8")
if "docProps/app.xml" in B:
    app = T(B, "docProps/app.xml")
    app = re.sub(r"<HeadingPairs>.*?</HeadingPairs>|<TitlesOfParts>.*?</TitlesOfParts>", "", app, flags=re.S)
    app = re.sub(r"<Slides>\d+</Slides>", "<Slides>%d</Slides>" % len(ORDER), app)
    app = re.sub(r"<Notes>\d+</Notes>", "<Notes>0</Notes>", app)
    B["docProps/app.xml"] = app.encode("utf-8")

order_names = [n for n in zb.namelist() if n in B] + [n for n in B if n not in zb.namelist()]
with zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as z:
    for n in order_names: z.writestr(n, B[n])
print("template:", len(ORDER), "slides,", sum(1 for n in B if n.startswith("ppt/media/")), "pictures ->", DST)
