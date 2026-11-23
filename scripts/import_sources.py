#!/usr/bin/env python3
"""Import OPML từ Inoreader và nguồn mạng xã hội từ sources/social.csv vào Miniflux."""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT_DIR, MinifluxClient, load_env

YOUTUBE_ID_PATTERNS = (
    re.compile(r'<link\s+rel="canonical"\s+href="https://www\.youtube\.com/channel/(UC[a-zA-Z0-9_-]{20,})"', re.I),
    re.compile(r'<meta\s+property="og:url"\s+content="https://www\.youtube\.com/channel/(UC[a-zA-Z0-9_-]{20,})"', re.I),
    re.compile(r'"rssUrl"\s*:\s*"https://www\.youtube\.com/feeds/videos\.xml\?channel_id=(UC[a-zA-Z0-9_-]{20,})"'),
    re.compile(r'itemprop="(?:channelId|identifier)"\s+content="(UC[a-zA-Z0-9_-]{20,})"', re.I),
    re.compile(r'"channelMetadataRenderer"\s*:\s*\{[^}]*"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"'),
    re.compile(r'"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{20,})"'),
)


def _extract_youtube_channel_id(html: str) -> str | None:
    for pat in YOUTUBE_ID_PATTERNS:
        m = pat.search(html)
        if m:
            return m.group(1)
    return None


def resolve_youtube_feed(url_or_handle: str, no_shorts: bool = False) -> str:
    """Đổi URL/@handle YouTube sang RSS feed chính chủ dạng channel_id hoặc playlist_id=UULF..."""
    raw = url_or_handle.strip()
    if "feeds/videos.xml" in raw:
        if no_shorts and "channel_id=UC" in raw:
            cid = raw.split("channel_id=")[-1].split("&")[0]
            return f"https://www.youtube.com/feeds/videos.xml?playlist_id=UULF{cid[2:]}"
        return raw

    channel_id: str | None = None
    m_direct = re.search(r"/channel/(UC[a-zA-Z0-9_-]{20,})", raw)
    if m_direct:
        channel_id = m_direct.group(1)
    else:
        target_url = raw
        if not target_url.startswith("http"):
            handle = target_url.lstrip("@")
            target_url = f"https://www.youtube.com/@{handle}"
        req = urllib.request.Request(
            target_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode("utf-8", errors="replace")
        channel_id = _extract_youtube_channel_id(html)
        if not channel_id:
            raise ValueError(f"Không tìm thấy channel_id từ: {raw}")

    if no_shorts and channel_id.startswith("UC"):
        return f"https://www.youtube.com/feeds/videos.xml?playlist_id=UULF{channel_id[2:]}"
    return f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"


def normalize_x_handle(url_or_handle: str) -> str:
    val = url_or_handle.strip()
    val = re.sub(r"^https?://(www\.)?(x|twitter)\.com/", "", val, flags=re.IGNORECASE)
    val = val.split("/")[0].split("?")[0].lstrip("@")
    return val


def build_facebook_feed_url(task_id: str, url_or_handle: str, name: str) -> str:
    match_key = name.strip() or url_or_handle.strip().rstrip("/").split("/")[-1]
    query = urllib.parse.urlencode({"match": match_key})
    return f"http://apify-bridge:8000/task/{task_id}.xml?{query}"


def import_opml(client: MinifluxClient, opml_path: Path) -> None:
    if not opml_path.exists():
        print(f"[Bỏ qua] Không thấy file OPML: {opml_path}")
        return
    print(f"Đang import OPML từ {opml_path}...")
    client.import_opml(opml_path.read_bytes())
    print("✓ Đã gửi OPML lên Miniflux thành công.")


def import_social_csv(
    client: MinifluxClient,
    csv_path: Path,
    platforms: set[str] | None = None,
    no_shorts: bool = False,
    use_fxtwitter: bool = False,
) -> None:
    if not csv_path.exists():
        print(f"[Bỏ qua] Không thấy file social CSV: {csv_path}")
        return

    existing_feeds = {f["feed_url"]: f for f in client.get_feeds()}
    fb_task_id = os.environ.get("APIFY_FB_TASK_ID", "").strip()

    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, start=2):
            platform = (row.get("platform") or "").strip().lower()
            target = (row.get("url_or_handle") or "").strip()
            folder = (row.get("folder") or "Social").strip()
            name = (row.get("name") or "").strip()
            if not platform or not target or target.startswith("<"):
                continue
            if platforms and platform not in platforms:
                continue

            try:
                if platform == "x":
                    handle = normalize_x_handle(target)
                    if use_fxtwitter:
                        feed_url = f"https://fxtwitter.com/{handle}/feed.xml"
                    else:
                        feed_url = f"http://rsshub:1200/twitter/user/{handle}"
                elif platform == "youtube":
                    feed_url = resolve_youtube_feed(target, no_shorts=no_shorts)
                elif platform == "facebook":
                    if not fb_task_id:
                        print(f"[Dòng {idx}] Bỏ qua Facebook '{name or target}' vì chưa có APIFY_FB_TASK_ID trong .env.")
                        continue
                    feed_url = build_facebook_feed_url(fb_task_id, target, name)
                else:
                    print(f"[Dòng {idx}] Nền tảng không hỗ trợ: {platform}")
                    continue

                if feed_url in existing_feeds:
                    print(f"[Đã có] {platform} | {name or target} -> {feed_url}")
                    continue

                cat_id = client.ensure_category(folder)
                created = client.create_feed(feed_url, cat_id)
                feed_id = created.get("feed_id")
                if name and feed_id:
                    client.update_feed(int(feed_id), title=name)
                existing_feeds[feed_url] = {"id": feed_id, "feed_url": feed_url}
                print(f"✓ Đã thêm [{folder}] {name or target}: {feed_url}")
            except Exception as exc:
                print(f"✗ Lỗi dòng {idx} ({platform} - {target}): {exc}")


def convert_existing_youtube_feeds(client: MinifluxClient, no_shorts: bool = False) -> None:
    """Chuyển các feed YouTube dạng @handle trong Miniflux sang feeds/videos.xml?channel_id=..."""
    feeds = client.get_feeds()
    for feed in feeds:
        url = feed.get("feed_url", "")
        if "youtube.com" not in url:
            continue
        if "feeds/videos.xml" in url and not (no_shorts and "channel_id=UC" in url):
            continue
        try:
            new_url = resolve_youtube_feed(url, no_shorts=no_shorts)
            if new_url != url:
                client.update_feed(int(feed["id"]), feed_url=new_url)
                print(f"✓ Đã chuẩn hoá YouTube feed #{feed['id']} ({feed.get('title')}): {new_url}")
        except Exception as exc:
            print(f"✗ Không đổi được YouTube feed #{feed['id']} ({url}): {exc}")


def main() -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Import OPML và nguồn social.csv vào Miniflux.")
    parser.add_argument("--opml", type=Path, default=ROOT_DIR / "sources" / "inoreader.opml")
    parser.add_argument("--csv", type=Path, default=ROOT_DIR / "sources" / "social.csv")
    parser.add_argument("--skip-opml", action="store_true", help="Bỏ qua bước import OPML")
    parser.add_argument("--skip-csv", action="store_true", help="Bỏ qua bước import social.csv")
    parser.add_argument(
        "--platform",
        action="append",
        choices=["x", "youtube", "facebook"],
        help="Chỉ import nền tảng được chọn (có thể truyền nhiều lần)",
    )
    parser.add_argument("--no-shorts", action="store_true", help="YouTube dùng playlist UULF để bỏ Shorts")
    parser.add_argument("--use-fxtwitter", action="store_true", help="Dùng fxtwitter thay RSSHub cho X")
    parser.add_argument("--convert-youtube", action="store_true", help="Chuẩn hoá feed YouTube đang có trong Miniflux")
    args = parser.parse_args()

    client = MinifluxClient()
    if not args.skip_opml:
        import_opml(client, args.opml)
    if not args.skip_csv:
        import_social_csv(
            client,
            args.csv,
            platforms=set(args.platform) if args.platform else None,
            no_shorts=args.no_shorts,
            use_fxtwitter=args.use_fxtwitter,
        )
    if args.convert_youtube:
        convert_existing_youtube_feeds(client, no_shorts=args.no_shorts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
