"""Turn WorshipAndSound/template.pptx into WorshipAndSound/deck/ — the projection screen's copy of the presentation.

The screen (WorshipAndSound/screen.js) draws each template slide in HTML from deck/template.json: positions as
fractions of the slide, text with its size (pt), colour, font and alignment, pictures (cropped, faded) extracted to
deck/*.jpg|webp, and the master background. Run again whenever template.pptx changes:

    python scripts/pptx_to_deck.py

Slides are mapped by position, the same names as setlist.js (TPL) and scripts/build_template.py (KEEP). The song slide keeps only the geometry and style of its title and lyrics boxes —
never the sample words; songs always come from the set. Groups / meetings keep their paragraphs as style samples,
and the screen fills them with fresh lines (deck.js), like the PowerPoint export does.
Needs Pillow.
"""
import io, json, os, re, sys, zipfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "WorshipAndSound", "template.pptx")
OUT = os.path.join(ROOT, "WorshipAndSound", "deck")
# the slide names, in template.pptx order (made by scripts/build_template.py — the same list as its KEEP)
ORDER = ["welcome", "verse", "blank", "song", "communion", "communion_verse", "parasha", "reading", "blessing",
         "sermon_title", "testimonies", "prayers", "groups", "meetings", "tithes", "closing"]
# text boxes (in drawing order) that the screen fills: the set's song, the week's words, the site's lists.
# None = a box that keeps the template's own words. Boxes listed here never store the template's text.
ROLES = {
    "song": ["title", "lyrics"],
    "verse": ["verse"],
    "parasha": ["parasha_name", "parasha_refs"],
    "reading": ["reading_ref", "reading_body"],
    "prayers": [None, "prayers"],
    "groups": [None, "groups"],
    "meetings": [None, "meetings"],
}
WEEKLY = {"song", "verse", "parasha", "reading"}  # every word of these slides is filled in (prayers: the body only)

z = zipfile.ZipFile(SRC)
read = lambda p: z.read(p).decode("utf-8")

pres = read("ppt/presentation.xml")
W, H = map(int, re.search(r'<p:sldSz cx="(\d+)" cy="(\d+)"', pres).groups())
prels = read("ppt/_rels/presentation.xml.rels")
def target(rid, rels):
    m = re.search(r'<Relationship [^>]*?Id="%s"[^>]*?Target="([^"]+)"' % re.escape(rid), rels) or re.search(r'<Relationship [^>]*?Target="([^"]+)"[^>]*?Id="%s"' % re.escape(rid), rels)
    return m.group(1)
slide_paths = ["ppt/" + target(rid, prels) for rid in re.findall(r'<p:sldId [^>]*?r:id="([^"]+)"', pres)]

# theme colours (through the master's colour map) and fonts
theme = read("ppt/theme/theme1.xml")
scheme = {}
for name, body in re.findall(r"<a:(dk1|lt1|dk2|lt2|accent\d|hlink|folHlink)>(.*?)</a:\1>", theme, re.S):
    m = re.search(r'srgbClr val="(\w{6})"', body) or re.search(r'lastClr="(\w{6})"', body)
    scheme[name] = m.group(1) if m else "FFFFFF"
master = read("ppt/slideMasters/slideMaster1.xml")
cmap = dict(re.findall(r'(\w+)="(\w+)"', re.search(r"<p:clrMap ([^>]*)/?>", master).group(1)))
def font_of(kind):
    blk = re.search(r"<a:%s>(.*?)</a:%s>" % (kind, kind), theme, re.S).group(1)
    heb = re.search(r'<a:font script="Hebr" typeface="([^"]+)"', blk)
    latin = re.search(r'<a:latin typeface="([^"]*)"', blk)
    return (heb.group(1) if heb else "") or (latin.group(1) if latin else "")
FONTS = {"+mj-lt": font_of("majorFont"), "+mn-lt": font_of("minorFont"), "+mj-cs": font_of("majorFont"), "+mn-cs": font_of("minorFont")}

def color(xml):
    """first colour in a fill, as #rrggbb plus alpha (0..1)"""
    m = re.search(r"<a:(srgbClr|schemeClr) val=\"(\w+)\"\s*(/>|>(.*?)</a:\1>)", xml, re.S)
    if not m: return None
    kind, val, _, mods = m.groups()
    hexv = val if kind == "srgbClr" else scheme.get(cmap.get(val, val), "FFFFFF")
    r, g, b = int(hexv[0:2], 16), int(hexv[2:4], 16), int(hexv[4:6], 16)
    mods = mods or ""
    lm = re.search(r'lumMod val="(\d+)"', mods); lo = re.search(r'lumOff val="(\d+)"', mods)
    if lm or lo:  # approximate HSL luminance modulation on RGB
        k = int(lm.group(1)) / 1e5 if lm else 1; off = int(lo.group(1)) / 1e5 * 255 if lo else 0
        r, g, b = (min(255, int(v * k + off)) for v in (r, g, b))
    a = re.search(r'alpha val="(\d+)"', mods)
    return {"c": "#%02x%02x%02x" % (r, g, b), "a": round(int(a.group(1)) / 1e5, 3) if a else 1}

media_done = {}
def save_media(path, crop_alpha=False):
    if path in media_done: return media_done[path]
    im = Image.open(io.BytesIO(z.read(path)))
    im.load()
    has_alpha = im.mode in ("RGBA", "LA", "P") and im.convert("RGBA").getextrema()[3][0] < 250
    im = im.convert("RGBA" if has_alpha else "RGB")
    if max(im.size) > 1920: im.thumbnail((1920, 1920), Image.LANCZOS)
    base = os.path.splitext(os.path.basename(path))[0]
    name = base + (".webp" if has_alpha else ".jpg")
    dst = os.path.join(OUT, name)
    if has_alpha: im.save(dst, "WEBP", quality=86, method=6)
    else: im.save(dst, "JPEG", quality=86, optimize=True, progressive=True)
    media_done[path] = "deck/" + name
    return media_done[path]

def frac_box(xml):
    m = re.search(r'<a:off x="(-?\d+)" y="(-?\d+)"\s*/>\s*<a:ext cx="(\d+)" cy="(\d+)"', xml)
    if not m: return None
    x, y, cx, cy = map(int, m.groups())
    return [round(x / W, 5), round(y / H, 5), round(cx / W, 5), round(cy / H, 5)]

def runs_of(p, default_sz):
    out = []
    for m in re.finditer(r"<a:r>(.*?)</a:r>|<a:br\b[^>]*/>|<a:br>.*?</a:br>", p, re.S):
        if m.group(0).startswith("<a:br"): out.append({"br": 1}); continue
        r = m.group(1)
        rpr = (re.search(r"<a:rPr[^>]*/>|<a:rPr.*?</a:rPr>", r, re.S) or [None])[0] if re.search(r"<a:rPr", r) else ""
        t = "".join(re.findall(r"<a:t>([^<]*)</a:t>", r, re.S))
        t = t.replace("&quot;", '"').replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&apos;", "'")
        sz = re.search(r' sz="(\d+)"', rpr or ""); fill = re.search(r"<a:solidFill>(.*?)</a:solidFill>", rpr or "", re.S)
        cs = re.search(r'<a:cs typeface="([^"]*)"', rpr or ""); lt = re.search(r'<a:latin typeface="([^"]*)"', rpr or "")
        font = (cs.group(1) if cs else "") or (lt.group(1) if lt else "")
        out.append({"t": t, "sz": int(sz.group(1)) / 100 if sz else default_sz,
                    "c": (color(fill.group(1)) or {}).get("c") if fill else None,
                    "b": bool(re.search(r' b="1"', rpr or "")), "i": bool(re.search(r' i="1"', rpr or "")),
                    "f": FONTS.get(font, font) if font else ""})
    return out

def text_el(sp, keep_text=True):
    tx = re.search(r"<p:txBody>(.*?)</p:txBody>", sp, re.S).group(1)
    body = re.search(r"<a:bodyPr([^>]*)", tx).group(1) if "<a:bodyPr" in tx else ""
    ins = [int((re.search(r'%s="(\d+)"' % k, body) or [0, d])[1]) for k, d in (("lIns", 91440), ("tIns", 45720), ("rIns", 91440), ("bIns", 45720))]
    anchor = (re.search(r'anchor="(\w+)"', body) or [0, "t"])[1]
    scale = re.search(r'fontScale="(\d+)"', tx)
    paras = []
    for p in re.findall(r"<a:p>.*?</a:p>|<a:p/>", tx, re.S):
        ppr = (re.search(r"<a:pPr[^>]*>", p) or [""])[0] if "<a:pPr" in p else ""
        algn = (re.search(r'algn="(\w+)"', ppr) or [0, ""])[1]
        ln = re.search(r"<a:lnSpc><a:spcPct val=\"(\d+)\"", p); bef = re.search(r"<a:spcBef><a:spcPts val=\"(\d+)\"", p)
        end_sz = re.search(r'<a:endParaRPr[^>]* sz="(\d+)"', p)
        default_sz = int(end_sz.group(1)) / 100 if end_sz else 18
        runs = runs_of(p, default_sz) if keep_text else []
        sample = runs_of(p, default_sz)
        style = next((r for r in sample if r.get("t")), sample[0] if sample else {"sz": default_sz})
        style = {k: v for k, v in style.items() if k != "t"}
        paras.append({"algn": algn, "rtl": 'rtl="1"' in ppr, "ln": int(ln.group(1)) / 1e5 if ln else None,
                      "bef": int(bef.group(1)) / 100 if bef else 0, "runs": runs, "style": style, "endSz": default_sz})
    return {"t": "text", "box": frac_box(sp), "ins": [round(ins[0] / W, 5), round(ins[1] / H, 5), round(ins[2] / W, 5), round(ins[3] / H, 5)],
            "anchor": anchor, "scale": int(scale.group(1)) / 1e5 if scale else 1, "paras": paras}

def inherited_box(body, path):
    """a placeholder with no <a:xfrm> sits where its layout (or master) puts the same placeholder"""
    ph = re.search(r"<p:ph([^>]*)/?>", body)
    if not ph: return None
    typ = (re.search(r'type="(\w+)"', ph.group(1)) or [0, "body"])[1]
    idx = (re.search(r'idx="(\d+)"', ph.group(1)) or [0, None])[1]
    rels = read(path.replace("slides/", "slides/_rels/") + ".rels")
    layout = "ppt/slideLayouts/" + re.search(r'Target="\.\./slideLayouts/([^"]+)"', rels).group(1)
    lrels = read(layout.replace("slideLayouts/", "slideLayouts/_rels/") + ".rels")
    master = "ppt/slideMasters/" + re.search(r'slideMasters/([^"]+)"', lrels).group(1)
    for part in (layout, master):
        for sp in re.findall(r"<p:sp>.*?</p:sp>", read(part), re.S):
            m = re.search(r"<p:ph([^>]*)/?>", sp)
            if not m: continue
            t2 = (re.search(r'type="(\w+)"', m.group(1)) or [0, "body"])[1]
            i2 = (re.search(r'idx="(\d+)"', m.group(1)) or [0, None])[1]
            same = (t2 == typ) or (t2 in ("title", "ctrTitle") and typ in ("title", "ctrTitle")) or (idx and i2 == idx)
            if same and frac_box(sp): return frac_box(sp)
    return None

def slide(path, key):
    xml = read(path)
    rels = read(path.replace("slides/", "slides/_rels/") + ".rels")
    els = []
    for m in re.finditer(r"<p:(sp|pic)>(.*?)</p:\1>", xml, re.S):
        kind, body = m.groups()
        box = frac_box(body) or (inherited_box(body, path) if kind == "sp" else None)
        if kind == "pic":
            rid = re.search(r'r:embed="(rId\d+)"', body).group(1)
            src = save_media("ppt/" + target(rid, rels).replace("../", ""))
            crop = re.search(r"<a:srcRect([^>]*)/>", body)
            cr = []
            for k in ("l", "t", "r", "b"):  # crop of each side, as a fraction of the picture
                mm = re.search(r'\b%s="(-?\d+)"' % k, crop.group(1)) if crop else None
                cr.append(int(mm.group(1)) / 1e5 if mm else 0)
            alpha = re.search(r'alphaModFix amt="(\d+)"', body)
            els.append({"t": "img", "box": box, "src": src, "crop": cr, "op": int(alpha.group(1)) / 1e5 if alpha else 1})
            continue
        sppr = re.search(r"<p:spPr.*?</p:spPr>|<p:spPr/>", body, re.S)
        sppr = sppr.group(0) if sppr else ""
        fill = None if "<a:noFill/>" in sppr.split("<a:ln")[0] else color((re.search(r"<a:solidFill>(.*?)</a:solidFill>", sppr.split("<a:ln")[0], re.S) or [None, ""])[1]) if "<a:solidFill>" in sppr.split("<a:ln")[0] else None
        has_text = bool(re.search(r"<a:t>[^<]", body))
        if fill and box: els.append({"t": "rect", "box": box, "fill": fill})
        if "<p:txBody>" in body and box and (has_text or key in ROLES):
            n_text = sum(1 for e in els if e["t"] == "text" and e.get("_has"))
            # only boxes with words get a role (an empty full-slide text box isn't the title)
            role = (ROLES.get(key) or [])[n_text] if has_text and n_text < len(ROLES.get(key) or []) else None
            filled = key in WEEKLY or role in ("prayers",)
            el = text_el(body, keep_text=not filled)
            el["box"] = box  # incl. a position inherited from the layout
            el["_has"] = has_text
            if role: el["role"] = role
            els.append(el)
    for e in els: e.pop("_has", None)
    return {"els": els}

os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith((".jpg", ".webp", ".json")): os.remove(os.path.join(OUT, f))

# master background picture, stretched like <a:fillRect r="…"/> says
bgm = re.search(r'<p:bg>.*?r:embed="(rId\d+)".*?</p:bg>', master, re.S)
mrels = read("ppt/slideMasters/_rels/slideMaster1.xml.rels")
bg = None
if bgm:
    fr = re.search(r'<a:fillRect([^>]*)/>', re.search(r"<p:bg>.*?</p:bg>", master, re.S).group(0))
    ext = {k: int(v) / 1e5 for k, v in re.findall(r'(\w)="(-?\d+)"', fr.group(1))} if fr else {}
    bg = {"src": save_media("ppt/" + target(bgm.group(1), mrels).replace("../", "")), "fill": ext}

# …or a gradient (<a:gradFill>: stops + a linear angle, 0° = left→right, clockwise)
if not bg:
    gb = re.search(r"<p:bg>.*?<a:gradFill.*?</a:gradFill>.*?</p:bg>", master, re.S)
    if gb:
        stops = []
        for pos, body in re.findall(r'<a:gs pos="(\d+)">(.*?)</a:gs>', gb.group(0), re.S):
            c = color(body) or {"c": "#000000", "a": 1}
            stops.append([int(pos) / 1e5, c["c"]])
        ang = re.search(r'<a:lin ang="(\d+)"', gb.group(0))
        bg = {"grad": {"ang": int(ang.group(1)) / 60000 if ang else 90, "stops": sorted(stops)}}

deck = {"size": [W, H], "bg": bg, "fonts": FONTS, "slides": {}}
for key, path in zip(ORDER, slide_paths):
    deck["slides"][key] = slide(path, key)
with open(os.path.join(OUT, "template.json"), "w", encoding="utf-8") as fh:
    json.dump(deck, fh, ensure_ascii=False, separators=(",", ":"))
print("deck:", {k: len(v["els"]) for k, v in deck["slides"].items()}, "| media:", len(media_done), "| fonts:", FONTS)
