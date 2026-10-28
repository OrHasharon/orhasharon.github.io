"""Fetch the Kehilat Or Hasharon YouTube catalog into data/videos.json.

Runs daily from GitHub Actions. Uses yt-dlp for the full catalog + playlists;
if YouTube blocks it, falls back to the channel RSS feed (latest 15) merged
into the existing JSON so the site still picks up new uploads.
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

CHANNEL_ID = "UCl2yaj9wY67pWaFXKpHyVtw"
CHANNEL_URL = f"https://www.youtube.com/channel/{CHANNEL_ID}"
OUT = Path(__file__).resolve().parent.parent / "data" / "videos.json"
DATE_RE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def classify(title):
    t = title.strip()
    # "24/10/2026 הלל" - worship videos are just the date + the word הלל
    if re.fullmatch(r"[\d/.\s]*הלל[\s\-|]*", t) or t.endswith(" הלל") or "הלל |" in t:
        return "hallel"
    return "sermon"


def clean_title(title):
    t = DATE_RE.sub("", title, count=1).strip(" -|")
    return t or title


def parse_date(title, fallback=None):
    m = DATE_RE.search(title)
    if m:
        d, mo, y = map(int, m.groups())
        try:
            iso = datetime(y, mo, d).strftime("%Y-%m-%d")
            if not (fallback and iso > fallback):
                return iso
        except ValueError:
            pass
    return fallback


def make_video(vid, title, duration=None, published=None):
    return {
        "id": vid,
        "title": clean_title(title),
        "rawTitle": title,
        "date": parse_date(title, published),
        "type": classify(title),
        "duration": duration,
        "series": [],
    }


def playlist_ids(ydl):
    # yt-dlp's playlists tab skips "course" style playlists, so also scrape the page itself
    ids = []
    info = ydl.extract_info(f"{CHANNEL_URL}/playlists", download=False) or {}
    ids += [p["id"] for p in info.get("entries") or [] if p and p.get("id")]
    req = urllib.request.Request(
        f"{CHANNEL_URL}/playlists",
        headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "he"},
    )
    try:
        html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
        ids += re.findall(r'"contentId":"(PL[\w-]+)"', html)
    except Exception as exc:  # noqa: BLE001
        print(f"playlist page scrape failed: {exc}", file=sys.stderr)
    return list(dict.fromkeys(ids))


def fetch_with_ytdlp():
    import yt_dlp

    opts = {"extract_flat": True, "quiet": True, "skip_download": True, "ignoreerrors": True}
    videos = {}
    with yt_dlp.YoutubeDL(opts) as ydl:
        for tab in ("videos", "streams"):
            info = ydl.extract_info(f"{CHANNEL_URL}/{tab}", download=False) or {}
            for e in info.get("entries") or []:
                if e and e.get("id") and e["id"] not in videos:
                    videos[e["id"]] = make_video(e["id"], e.get("title") or "", e.get("duration"))
        if len(videos) < 50:
            raise RuntimeError(f"only {len(videos)} videos returned - probably blocked")

        # titles with no date or a typo'd one (e.g. 2925): use the real upload date
        today = datetime.now().strftime("%Y-%m-%d")
        for v in videos.values():
            if not v["date"] or v["date"] > today:
                full = ydl.extract_info(f"https://www.youtube.com/watch?v={v['id']}", download=False) or {}
                up = full.get("upload_date")
                if up:
                    v["date"] = f"{up[:4]}-{up[4:6]}-{up[6:]}"

        playlists = []
        for pid in playlist_ids(ydl):
            pl = ydl.extract_info(f"https://www.youtube.com/playlist?list={pid}", download=False) or {}
            ids = [e["id"] for e in (pl.get("entries") or []) if e and e.get("id")]
            title = pl.get("title") or ""
            if not ids:
                continue
            if title.strip() == "הלל":
                continue  # worship has its own tab already
            playlists.append({"id": pid, "title": title, "videoIds": ids})
            for vid in ids:
                if vid in videos:
                    videos[vid]["series"].append(title)
    return list(videos.values()), playlists


def fetch_rss_merge():
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"videos": [], "playlists": []}
    known = {v["id"]: v for v in old["videos"]}
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL_ID}"
    root = ET.fromstring(urllib.request.urlopen(url, timeout=30).read())
    ns = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}
    for entry in root.findall("a:entry", ns):
        vid = entry.find("yt:videoId", ns).text
        if vid not in known:
            title = entry.find("a:title", ns).text or ""
            published = entry.find("a:published", ns).text[:10]
            known[vid] = make_video(vid, title, None, published)
    return list(known.values()), old["playlists"]


def main():
    try:
        videos, playlists = fetch_with_ytdlp()
        source = "yt-dlp"
    except Exception as exc:  # noqa: BLE001
        print(f"yt-dlp failed ({exc}); falling back to RSS", file=sys.stderr)
        videos, playlists = fetch_rss_merge()
        source = "rss"

    videos.sort(key=lambda v: (v["date"] or "", v["type"] == "sermon"), reverse=True)
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "source": source,
                "videos": videos,
                "playlists": playlists,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    print(f"{source}: {len(videos)} videos, {len(playlists)} playlists")


if __name__ == "__main__":
    main()
