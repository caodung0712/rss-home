"""Thu thập số tương tác & lượt xem miễn phí ($0) cho social media:
- TikTok (yt-dlp: view_count, like_count, comment_count, repost_count)
- YouTube (RSS media:statistics + HTML viewCount / likes)
- X / Twitter (fxtwitter JSON API: views, likes, replies, retweets)
- LinkedIn (JSON-LD interactionStatistic công khai: likes, comments, shares)
Lưu ý: Không xử lý Facebook theo yêu cầu.
"""

from __future__ import annotations

import asyncio
import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any

import httpx

from bridge_core import TTLCache
from linkedin_rss import LD_JSON_RE, LINKEDIN_HEADERS
from social_free import _sync_fetch_tiktok_archive, normalize_tiktok_handle

_tiktok_channel_metrics_cache = TTLCache(ttl_seconds=7200)
_single_metrics_cache = TTLCache(ttl_seconds=7200)
_youtube_channel_cache = TTLCache(ttl_seconds=7200)

WEB_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def detect_social_platform(url: str, feed_url: str = "") -> str | None:
    """Nhận diện nền tảng social hỗ trợ (loại trừ hoàn toàn Facebook)."""
    combined = f"{url} {feed_url}".lower()
    if "facebook.com" in combined or "fb.watch" in combined or "/facebook" in combined:
        return None

    u = (url or "").strip().lower()
    f = (feed_url or "").strip().lower()
    if "tiktok.com" in u or "/tiktok/" in f:
        return "tiktok"
    if "youtube.com" in u or "youtu.be/" in u or "youtube.com/feeds/" in f:
        return "youtube"
    if re.search(r"https?://(www\.|mobile\.)?(x|twitter|fxtwitter)\.com/[^/]+/status/\d+", u):
        return "x"
    if "linkedin.com/" in u and any(p in u for p in ("/posts/", "/pulse/", "/feed/update/")):
        return "linkedin"
    return None


def _to_int(val: Any) -> int | None:
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        n = int(val)
        return n if n >= 0 else None
    if isinstance(val, str):
        cleaned = re.sub(r"[^\d]", "", val)
        if cleaned:
            return int(cleaned)
    return None


def _parse_abbreviated_count(raw: str) -> int | None:
    text = (raw or "").strip().upper().replace(",", "")
    m = re.match(r"^(\d+(?:\.\d+)?)\s*([KMB])?$", text)
    if not m:
        return _to_int(raw)
    num = float(m.group(1))
    suffix = m.group(2)
    mult = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get(suffix or "", 1)
    return int(round(num * mult))


# ---------------------------------------------------------------------------
# 1. TikTok (yt-dlp)
# ---------------------------------------------------------------------------


def _extract_tiktok_video_id(url: str) -> str:
    m = re.search(r"/video/(\d+)", url or "")
    return m.group(1) if m else ""


def _extract_tiktok_handle(url: str, feed_url: str = "") -> str:
    for src in (feed_url, url):
        m = re.search(r"/tiktok/user/@?([^/?#]+)", src or "", flags=re.I)
        if m:
            return normalize_tiktok_handle(urllib.parse.unquote(m.group(1)))
        m2 = re.search(r"tiktok\.com/@([^/?#]+)", src or "", flags=re.I)
        if m2:
            return normalize_tiktok_handle(urllib.parse.unquote(m2.group(1)))
    return ""


def _sync_single_tiktok_metrics(video_url: str) -> dict[str, Any] | None:
    import yt_dlp

    opts = {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": 15,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(video_url, download=False) or {}
    if not isinstance(info, dict):
        return None
    metrics = {
        "platform": "tiktok",
        "views": _to_int(info.get("view_count")),
        "likes": _to_int(info.get("like_count")),
        "comments": _to_int(info.get("comment_count")),
        "shares": _to_int(info.get("repost_count")),
    }
    if all(metrics[k] is None for k in ("views", "likes", "comments", "shares")):
        return None
    return metrics


async def _resolve_tiktok_batch(
    items: list[dict[str, Any]], force: bool = False
) -> dict[int, dict[str, Any]]:
    results: dict[int, dict[str, Any]] = {}
    by_handle: dict[str, list[dict[str, Any]]] = {}
    fallback_items: list[dict[str, Any]] = []

    for it in items:
        eid = int(it["entry_id"])
        url = str(it["url"])
        if not force:
            cached = _single_metrics_cache.get(f"tt:{url}")
            if cached is not None:
                results[eid] = cached
                continue
        handle = _extract_tiktok_handle(url, str(it.get("feed_url") or ""))
        if handle:
            by_handle.setdefault(handle, []).append(it)
        else:
            fallback_items.append(it)

    for handle, group in by_handle.items():
        channel_map: dict[str, dict[str, Any]] | None = (
            None if force else _tiktok_channel_metrics_cache.get(handle)
        )
        if channel_map is None:
            try:
                arch = await asyncio.to_thread(_sync_fetch_tiktok_archive, handle, 1, 40)
                channel_map = {}
                for row in arch.get("items") or []:
                    vid = str(row.get("id") or "")
                    metric = {
                        "platform": "tiktok",
                        "views": _to_int(row.get("view_count")),
                        "likes": _to_int(row.get("like_count")),
                        "comments": _to_int(row.get("comment_count")),
                        "shares": _to_int(row.get("repost_count")),
                    }
                    if vid:
                        channel_map[vid] = metric
                    if row.get("url"):
                        channel_map[str(row["url"]).split("?")[0]] = metric
                _tiktok_channel_metrics_cache.set(handle, channel_map)
            except Exception:
                channel_map = {}

        for it in group:
            eid = int(it["entry_id"])
            url = str(it["url"])
            vid = _extract_tiktok_video_id(url)
            hit = channel_map.get(vid) or channel_map.get(url.split("?")[0])
            if hit:
                _single_metrics_cache.set(f"tt:{url}", hit)
                results[eid] = hit
            else:
                fallback_items.append(it)

    # Video cũ hơn 40 bài gần nhất -> fallback đơn lẻ tối đa 5 video để tránh chậm
    for it in fallback_items[:5]:
        eid = int(it["entry_id"])
        url = str(it["url"])
        try:
            hit = await asyncio.to_thread(_sync_single_tiktok_metrics, url)
            if hit:
                _single_metrics_cache.set(f"tt:{url}", hit)
                results[eid] = hit
        except Exception:
            continue

    return results


# ---------------------------------------------------------------------------
# 2. YouTube (RSS media:statistics + HTML viewCount / likes)
# ---------------------------------------------------------------------------


def extract_youtube_video_id(url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return ""
    host = parsed.hostname.lower() if parsed.hostname else ""
    if "youtu.be" in host:
        return parsed.path.strip("/").split("/")[0]
    if "youtube.com" in host:
        if parsed.path == "/watch":
            return urllib.parse.parse_qs(parsed.query).get("v", [""])[0]
        if parsed.path.startswith(("/shorts/", "/embed/", "/live/")):
            parts = [p for p in parsed.path.split("/") if p]
            return parts[1] if len(parts) >= 2 else ""
    return ""


def _extract_youtube_channel_id(feed_url: str) -> str:
    try:
        parsed = urllib.parse.urlparse(feed_url)
    except ValueError:
        return ""
    if "youtube.com" not in (parsed.hostname or "").lower():
        return ""
    qs = urllib.parse.parse_qs(parsed.query)
    cid = (qs.get("channel_id") or [""])[0]
    if cid.startswith("UC"):
        return cid
    pid = (qs.get("playlist_id") or [""])[0]
    if pid.startswith("UULF"):
        return f"UC{pid[4:]}"
    return ""


def parse_youtube_rss_stats(xml_text: str) -> dict[str, dict[str, Any]]:
    stats: dict[str, dict[str, Any]] = {}
    try:
        root = ET.fromstring(xml_text.lstrip("\ufeff \t\r\n"))
    except ET.ParseError:
        return stats

    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }
    for entry in root.findall("atom:entry", ns):
        vid = (entry.findtext("yt:videoId", default="", namespaces=ns) or "").strip()
        if not vid:
            continue
        stat_el = entry.find(".//media:statistics", ns)
        rating_el = entry.find(".//media:starRating", ns)
        views = _to_int(stat_el.attrib.get("views")) if stat_el is not None else None
        likes = _to_int(rating_el.attrib.get("count")) if rating_el is not None else None
        if views is not None or likes is not None:
            stats[vid] = {
                "platform": "youtube",
                "views": views,
                "likes": likes,
                "comments": None,
                "shares": None,
            }
    return stats


def parse_youtube_watch_html_stats(html_text: str) -> dict[str, Any] | None:
    views: int | None = None
    likes: int | None = None

    m_view = re.search(r'"viewCount"\s*:\s*"(\d+)"', html_text or "")
    if m_view:
        views = _to_int(m_view.group(1))
    if views is None:
        m_meta = re.search(r'itemprop="interactionCount"\s+content="(\d+)"', html_text or "")
        if m_meta:
            views = _to_int(m_meta.group(1))

    m_like = re.search(r'"label"\s*:\s*"([\d.,]+)\s+likes"', html_text or "", flags=re.I)
    if m_like:
        likes = _to_int(m_like.group(1))
    if likes is None:
        m_like2 = re.search(
            r'"factoidRenderer"\s*:\s*\{"value"\s*:\s*\{"simpleText"\s*:\s*"([^"]+)"\}\s*,\s*"label"\s*:\s*\{"simpleText"\s*:\s*"Likes"',
            html_text or "",
            flags=re.I,
        )
        if m_like2:
            likes = _parse_abbreviated_count(m_like2.group(1))

    if views is None and likes is None:
        return None
    return {
        "platform": "youtube",
        "views": views,
        "likes": likes,
        "comments": None,
        "shares": None,
    }


async def _resolve_youtube_batch(
    items: list[dict[str, Any]], force: bool = False
) -> dict[int, dict[str, Any]]:
    results: dict[int, dict[str, Any]] = {}
    need_fetch: list[dict[str, Any]] = []
    channel_ids: set[str] = set()

    for it in items:
        eid = int(it["entry_id"])
        vid = extract_youtube_video_id(str(it["url"]))
        if not vid:
            continue
        if not force:
            cached = _single_metrics_cache.get(f"yt:{vid}")
            if cached is not None:
                results[eid] = cached
                continue
        cid = _extract_youtube_channel_id(str(it.get("feed_url") or ""))
        if cid:
            channel_ids.add(cid)
        need_fetch.append({**it, "_vid": vid, "_cid": cid})

    if not need_fetch:
        return results

    async with httpx.AsyncClient(
        timeout=10.0, headers=WEB_HEADERS, follow_redirects=True
    ) as client:
        # 1. Kéo YouTube RSS của các kênh liên quan (1 request cho 15 video mới nhất)
        channel_stats: dict[str, dict[str, Any]] = {}
        for cid in channel_ids:
            cmap = None if force else _youtube_channel_cache.get(cid)
            if cmap is None:
                try:
                    r = await client.get(f"https://www.youtube.com/feeds/videos.xml?channel_id={cid}")
                    cmap = parse_youtube_rss_stats(r.text) if r.status_code == 200 else {}
                    if cmap:
                        _youtube_channel_cache.set(cid, cmap)
                except httpx.HTTPError:
                    cmap = {}
            channel_stats.update(cmap)

        remaining: list[dict[str, Any]] = []
        for it in need_fetch:
            vid = it["_vid"]
            eid = int(it["entry_id"])
            if vid in channel_stats:
                _single_metrics_cache.set(f"yt:{vid}", channel_stats[vid])
                results[eid] = channel_stats[vid]
            else:
                remaining.append(it)

        # 2. Fallback trang /watch cho video cũ hoặc không rõ channel_id (giới hạn 8 video/lượt)
        sem = asyncio.Semaphore(4)

        async def _fetch_watch(it: dict[str, Any]) -> None:
            vid = it["_vid"]
            eid = int(it["entry_id"])
            async with sem:
                try:
                    r = await client.get(f"https://www.youtube.com/watch?v={vid}&hl=en")
                    if r.status_code == 200:
                        parsed = parse_youtube_watch_html_stats(r.text)
                        if parsed:
                            _single_metrics_cache.set(f"yt:{vid}", parsed)
                            results[eid] = parsed
                except httpx.HTTPError:
                    pass

        await asyncio.gather(*[_fetch_watch(it) for it in remaining[:8]])

    return results


# ---------------------------------------------------------------------------
# 3. X / Twitter (fxtwitter public JSON API)
# ---------------------------------------------------------------------------


def parse_x_status_url(url: str) -> tuple[str, str] | None:
    m = re.search(
        r"https?://(?:www\.|mobile\.)?(?:x|twitter|fxtwitter)\.com/([^/]+)/status/(\d+)",
        url or "",
        flags=re.I,
    )
    if not m:
        return None
    return m.group(1), m.group(2)


async def _resolve_x_batch(
    items: list[dict[str, Any]], force: bool = False
) -> dict[int, dict[str, Any]]:
    results: dict[int, dict[str, Any]] = {}
    pending: list[tuple[int, str, str]] = []

    for it in items:
        eid = int(it["entry_id"])
        parsed = parse_x_status_url(str(it["url"]))
        if not parsed:
            continue
        user, status_id = parsed
        if not force:
            cached = _single_metrics_cache.get(f"x:{status_id}")
            if cached is not None:
                results[eid] = cached
                continue
        pending.append((eid, user, status_id))

    if not pending:
        return results

    sem = asyncio.Semaphore(5)
    async with httpx.AsyncClient(
        timeout=8.0, headers={"User-Agent": "rss-home/1.0"}, follow_redirects=True
    ) as client:
        async def _fetch_one(eid: int, user: str, status_id: str) -> None:
            async with sem:
                try:
                    r = await client.get(f"https://api.fxtwitter.com/{user}/status/{status_id}")
                    if r.status_code != 200:
                        return
                    data = r.json()
                    tweet = data.get("tweet") if isinstance(data, dict) else None
                    if not isinstance(tweet, dict):
                        return
                    metric = {
                        "platform": "x",
                        "views": _to_int(tweet.get("views")),
                        "likes": _to_int(tweet.get("likes")),
                        "comments": _to_int(tweet.get("replies")),
                        "shares": _to_int(tweet.get("retweets")),
                    }
                    if any(metric[k] is not None for k in ("views", "likes", "comments", "shares")):
                        _single_metrics_cache.set(f"x:{status_id}", metric)
                        results[eid] = metric
                except (httpx.HTTPError, ValueError):
                    pass

        await asyncio.gather(*[_fetch_one(e, u, s) for e, u, s in pending[:15]])

    return results


# ---------------------------------------------------------------------------
# 4. LinkedIn (JSON-LD interactionStatistic công khai)
# ---------------------------------------------------------------------------


def parse_linkedin_interaction_stats(post_html: str) -> dict[str, Any] | None:
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None

    for block in LD_JSON_RE.findall(post_html or ""):
        try:
            parsed = json.loads(block)
        except json.JSONDecodeError:
            continue
        candidates: list[dict[str, Any]] = []
        if isinstance(parsed, dict):
            candidates.append(parsed)
            if isinstance(parsed.get("@graph"), list):
                candidates.extend([n for n in parsed["@graph"] if isinstance(n, dict)])

        for node in candidates:
            stats = node.get("interactionStatistic")
            if isinstance(stats, dict):
                stats = [stats]
            if not isinstance(stats, list):
                continue
            for st in stats:
                if not isinstance(st, dict):
                    continue
                itype = str(st.get("interactionType") or "").lower()
                count = _to_int(st.get("userInteractionCount"))
                if count is None:
                    continue
                if "like" in itype or "react" in itype:
                    likes = count
                elif "comment" in itype:
                    comments = count
                elif "share" in itype:
                    shares = count

    if likes is None:
        m = re.search(r'"numLikes"\s*:\s*(\d+)', post_html or "")
        if m:
            likes = _to_int(m.group(1))
    if comments is None:
        m = re.search(r'"numComments"\s*:\s*(\d+)', post_html or "")
        if m:
            comments = _to_int(m.group(1))

    if likes is None and comments is None and shares is None:
        return None
    return {
        "platform": "linkedin",
        "views": None,
        "likes": likes,
        "comments": comments,
        "shares": shares,
    }


async def _resolve_linkedin_batch(
    items: list[dict[str, Any]], force: bool = False
) -> dict[int, dict[str, Any]]:
    results: dict[int, dict[str, Any]] = {}
    pending: list[tuple[int, str]] = []

    for it in items:
        eid = int(it["entry_id"])
        url = str(it["url"]).split("?")[0]
        if not force:
            cached = _single_metrics_cache.get(f"li:{url}")
            if cached is not None:
                results[eid] = cached
                continue
        pending.append((eid, url))

    if not pending:
        return results

    sem = asyncio.Semaphore(3)
    async with httpx.AsyncClient(
        timeout=8.0, headers=LINKEDIN_HEADERS, follow_redirects=True
    ) as client:
        async def _fetch_one(eid: int, url: str) -> None:
            async with sem:
                try:
                    r = await client.get(url)
                    if r.status_code != 200:
                        return
                    parsed = parse_linkedin_interaction_stats(r.text)
                    if parsed:
                        _single_metrics_cache.set(f"li:{url}", parsed)
                        results[eid] = parsed
                except httpx.HTTPError:
                    pass

        await asyncio.gather(*[_fetch_one(e, u) for e, u in pending[:8]])

    return results


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def collect_social_metrics_batch(
    items: list[dict[str, Any]], force: bool = False
) -> dict[int, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {
        "tiktok": [],
        "youtube": [],
        "x": [],
        "linkedin": [],
    }
    for it in items[:40]:
        url = str(it.get("url") or "").strip()
        feed_url = str(it.get("feed_url") or "").strip()
        if not url or "entry_id" not in it:
            continue
        platform = detect_social_platform(url, feed_url)
        if platform and platform in grouped:
            grouped[platform].append(it)

    tt_res, yt_res, x_res, li_res = await asyncio.gather(
        _resolve_tiktok_batch(grouped["tiktok"], force=force),
        _resolve_youtube_batch(grouped["youtube"], force=force),
        _resolve_x_batch(grouped["x"], force=force),
        _resolve_linkedin_batch(grouped["linkedin"], force=force),
    )

    merged: dict[int, dict[str, Any]] = {}
    merged.update(tt_res)
    merged.update(yt_res)
    merged.update(x_res)
    merged.update(li_res)
    return merged
