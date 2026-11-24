"""Helper miễn phí ($0) cho TikTok archive pagination (yt-dlp) và Facebook Page RSS (RSSHub + Google News fallback)."""

from __future__ import annotations

import asyncio
import re
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from bridge_core import TTLCache
from linkedin_rss import build_linkedin_rss_xml, parse_google_news_rss_items

RSSHUB_INTERNAL_URL = "http://rsshub:1200"
_facebook_feed_cache = TTLCache(ttl_seconds=300)
_tiktok_stream_cache = TTLCache(ttl_seconds=1800)


def normalize_tiktok_handle(raw: str) -> str:
    cleaned = (raw or "").strip()
    cleaned = re.sub(r"^https?://(www\.)?tiktok\.com/@?", "", cleaned, flags=re.I)
    cleaned = cleaned.split("/")[0].split("?")[0].lstrip("@")
    return cleaned


def extract_best_thumbnail(entry: dict[str, Any]) -> str:
    direct = entry.get("thumbnail")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    thumbs = entry.get("thumbnails")
    if isinstance(thumbs, list) and thumbs:
        for pref_id in ("cover", "originCover", "dynamicCover"):
            for item in thumbs:
                if isinstance(item, dict) and item.get("id") == pref_id and item.get("url"):
                    return str(item["url"])
        for item in thumbs:
            if isinstance(item, dict) and item.get("url"):
                return str(item["url"])
    return ""


def _sync_fetch_tiktok_archive(handle: str, start: int, count: int) -> dict[str, Any]:
    import yt_dlp

    clean = normalize_tiktok_handle(handle)
    if not clean:
        raise ValueError("Thiếu @handle TikTok.")

    start = max(1, int(start))
    count = max(1, min(60, int(count)))
    end = start + count - 1
    url = f"https://www.tiktok.com/@{clean}"

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "playliststart": start,
        "playlistend": end,
        "socket_timeout": 20,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False) or {}

    raw_entries = list(info.get("entries") or [])
    items: list[dict[str, Any]] = []
    for entry in raw_entries:
        if not isinstance(entry, dict):
            continue
        vid = str(entry.get("id") or "").strip()
        video_url = str(entry.get("url") or entry.get("webpage_url") or "").strip()
        if not video_url and vid:
            video_url = f"https://www.tiktok.com/@{clean}/video/{vid}"
        if not video_url:
            continue
        desc = str(entry.get("description") or entry.get("title") or "").strip()
        title = str(entry.get("title") or desc or f"TikTok {vid}").strip()
        ts = entry.get("timestamp")
        duration = entry.get("duration")
        author = str(entry.get("channel") or entry.get("uploader") or f"@{clean}").strip()
        view_count = entry.get("view_count")
        like_count = entry.get("like_count")
        comment_count = entry.get("comment_count")
        repost_count = entry.get("repost_count")
        items.append(
            {
                "id": vid,
                "url": video_url,
                "title": title,
                "description": desc,
                "timestamp": int(ts) if isinstance(ts, (int, float)) else None,
                "duration": int(duration) if isinstance(duration, (int, float)) else None,
                "thumbnail": extract_best_thumbnail(entry),
                "author": author,
                "view_count": int(view_count) if isinstance(view_count, (int, float)) else None,
                "like_count": int(like_count) if isinstance(like_count, (int, float)) else None,
                "comment_count": int(comment_count) if isinstance(comment_count, (int, float)) else None,
                "repost_count": int(repost_count) if isinstance(repost_count, (int, float)) else None,
            }
        )

    return {
        "handle": clean,
        "start": start,
        "count": len(items),
        "has_more": len(items) >= count,
        "items": items,
    }


async def fetch_tiktok_archive(handle: str, start: int = 1, count: int = 25) -> dict[str, Any]:
    return await asyncio.to_thread(_sync_fetch_tiktok_archive, handle, start, count)


def _sync_resolve_tiktok_video(video_url: str) -> dict[str, Any]:
    import yt_dlp

    clean_url = (video_url or "").strip()
    if not re.match(r"^https?://(www\.|m\.|vt\.)?tiktok\.com/", clean_url, flags=re.I):
        raise ValueError("URL TikTok không hợp lệ.")

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 20,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(clean_url, download=False) or {}
        cookie_parts = [f"{c.name}={c.value}" for c in ydl.cookiejar if c.name]

    formats = [
        f
        for f in (info.get("formats") or [])
        if isinstance(f, dict)
        and f.get("url")
        and f.get("vcodec") != "none"
        and f.get("acodec") != "none"
        and f.get("ext") == "mp4"
    ]
    best = formats[-1] if formats else None
    stream_url = str((best or {}).get("url") or info.get("url") or "").strip()
    if not stream_url:
        raise ValueError("Không lấy được luồng video MP4 từ TikTok.")

    headers = {
        str(k): str(v)
        for k, v in ((best or {}).get("http_headers") or info.get("http_headers") or {}).items()
    }
    if cookie_parts:
        headers["Cookie"] = "; ".join(cookie_parts)
    if "Referer" not in headers:
        headers["Referer"] = "https://www.tiktok.com/"

    return {
        "stream_url": stream_url,
        "headers": headers,
    }


async def resolve_tiktok_video_stream(
    video_url: str, force_refresh: bool = False
) -> dict[str, Any]:
    clean_url = (video_url or "").strip()
    if not force_refresh:
        cached = _tiktok_stream_cache.get(clean_url)
        if cached is not None:
            return cached
    resolved = await asyncio.to_thread(_sync_resolve_tiktok_video, clean_url)
    _tiktok_stream_cache.set(clean_url, resolved)
    return resolved


def normalize_facebook_target(raw: str) -> str:
    val = (raw or "").strip()
    if not val:
        raise ValueError("Thiếu tên Page hoặc URL Facebook.")
    if re.match(r"^https?://", val, flags=re.I):
        parsed = urllib.parse.urlparse(val)
        qs = urllib.parse.parse_qs(parsed.query)
        if "id" in qs and qs["id"][0].strip():
            return qs["id"][0].strip()
        parts = [p for p in parsed.path.strip("/").split("/") if p]
        if not parts:
            raise ValueError("URL Facebook không chứa tên Page.")
        if parts[0].lower() == "people" and len(parts) >= 3:
            return parts[2]
        if parts[0].lower() in ("pg", "pages") and len(parts) >= 2:
            return parts[-1]
        return parts[0]
    return val.strip("/").lstrip("@")


def _rss_xml_has_items(xml_text: str) -> bool:
    if not xml_text or "<rss" not in xml_text.lower():
        return False
    try:
        root = ET.fromstring(xml_text.strip())
    except ET.ParseError:
        return False
    return len(root.findall(".//item")) > 0


async def fetch_facebook_free_rss(
    page: str,
    mode: str = "page",
    name: str | None = None,
    limit: int = 20,
    rsshub_base: str = RSSHUB_INTERNAL_URL,
) -> tuple[str, str]:
    """Lấy RSS Facebook miễn phí qua RSSHub nội bộ, tự fallback Google News nếu bị login wall."""
    slug = normalize_facebook_target(page)
    safe_mode = mode if mode in ("page", "reels", "photos") else "page"
    limit = max(5, min(60, int(limit)))
    cache_key = f"{safe_mode}::{slug}::{name or ''}::{limit}"
    cached = _facebook_feed_cache.get(cache_key)
    if cached is not None:
        return cached, "cache"

    rsshub_url = f"{rsshub_base.rstrip('/')}/facebook/{safe_mode}/{urllib.parse.quote(slug)}?limit={limit}"
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
        try:
            resp = await client.get(rsshub_url)
            if resp.status_code == 200 and _rss_xml_has_items(resp.text):
                _facebook_feed_cache.set(cache_key, resp.text)
                return resp.text, "rsshub"
        except httpx.HTTPError:
            pass

        # Dự phòng miễn phí qua Google News RSS nếu Facebook chặn guest / cần cookie
        display_name = (name or "").strip() or slug
        fb_url = f"https://www.facebook.com/{slug}"
        queries = [
            f'site:facebook.com/{slug}',
            f'site:facebook.com "{display_name}"',
        ]
        posts: list[dict[str, Any]] = []
        for q_str in queries:
            q_enc = urllib.parse.urlencode(
                {"q": q_str, "hl": "vi", "gl": "VN", "ceid": "VN:vi"}
            )
            try:
                g_resp = await client.get(f"https://news.google.com/rss/search?{q_enc}")
                if g_resp.status_code == 200:
                    parsed = parse_google_news_rss_items(g_resp.text, display_name)
                    if parsed:
                        posts = parsed[:30]
                        break
            except httpx.HTTPError:
                continue

        xml_text = build_linkedin_rss_xml(
            posts,
            profile_url=fb_url,
            feed_title=f"{display_name} (Facebook)",
        )
        _facebook_feed_cache.set(cache_key, xml_text)
        return xml_text, "google_news_fallback"


async def fetch_facebook_archive(
    page: str,
    mode: str = "page",
    limit: int = 30,
    rsshub_base: str = RSSHUB_INTERNAL_URL,
) -> dict[str, Any]:
    slug = normalize_facebook_target(page)
    safe_mode = mode if mode in ("page", "reels", "photos") else "page"
    limit = max(10, min(100, int(limit)))
    url = f"{rsshub_base.rstrip('/')}/facebook/{safe_mode}/{urllib.parse.quote(slug)}?format=json&limit={limit}"
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            return {"slug": slug, "count": 0, "items": [], "has_more": False}
        data = resp.json()
        raw_items = data.get("items") or []
        items: list[dict[str, Any]] = []
        for it in raw_items:
            if not isinstance(it, dict) or not it.get("url"):
                continue
            authors = it.get("authors") or []
            author_name = (
                str(authors[0].get("name"))
                if authors and isinstance(authors[0], dict) and authors[0].get("name")
                else slug
            )
            items.append(
                {
                    "url": str(it.get("url")),
                    "title": str(it.get("title") or author_name),
                    "content_html": str(it.get("content_html") or it.get("summary") or ""),
                    "date_published": str(it.get("date_published") or ""),
                    "author": author_name,
                }
            )
        return {
            "slug": slug,
            "count": len(items),
            "has_more": len(items) >= limit,
            "items": items,
        }
