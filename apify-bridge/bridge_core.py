"""Logic xử lý dữ liệu Apify -> RSS 2.0 và kiểm tra chi phí tháng."""

from __future__ import annotations

import html
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from typing import Any

MAX_IMAGES_PER_POST = 20
DEFAULT_LOOKBACK_DAYS = 7
CACHE_TTL_SECONDS = 600  # 10 phút


def parse_iso_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(raw)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def _first_str(item: dict[str, Any], keys: tuple[str, ...]) -> str:
    for k in keys:
        val = item.get(k)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def extract_post_datetime(item: dict[str, Any]) -> datetime | None:
    posted_at = item.get("postedAt") if isinstance(item.get("postedAt"), dict) else {}
    raw = (
        item.get("time")
        or item.get("timestamp")
        or item.get("publishedAt")
        or item.get("createTimeISO")
        or item.get("createTime")
        or item.get("postedDate")
        or item.get("createdAt")
        or item.get("date")
        or posted_at.get("date")
        or posted_at.get("timestamp")
    )
    return parse_iso_datetime(raw)


def extract_page_name(item: dict[str, Any]) -> str:
    user = item.get("user") if isinstance(item.get("user"), dict) else {}
    author = item.get("author") if isinstance(item.get("author"), dict) else {}
    author_meta = item.get("authorMeta") if isinstance(item.get("authorMeta"), dict) else {}
    actor = item.get("actor") if isinstance(item.get("actor"), dict) else {}
    name = (
        _first_str(item, ("pageName", "authorName", "userName", "name", "pageTitle"))
        or _first_str(author_meta, ("nickName", "name"))
        or _first_str(user, ("name", "username", "title"))
        or _first_str(author, ("name", "title", "uniqueId", "nickname"))
        or _first_str(actor, ("name",))
    )
    if name:
        return name
    src_url = _first_str(
        item,
        ("facebookUrl", "pageUrl", "profileUrl", "authorProfileUrl", "inputUrl"),
    )
    if src_url:
        parts = [p for p in urllib.parse.urlparse(src_url).path.strip("/").split("/") if p]
        if parts:
            return parts[-1]
    return "Social"


def extract_page_url(item: dict[str, Any]) -> str:
    user = item.get("user") if isinstance(item.get("user"), dict) else {}
    author = item.get("author") if isinstance(item.get("author"), dict) else {}
    author_meta = item.get("authorMeta") if isinstance(item.get("authorMeta"), dict) else {}
    return (
        _first_str(
            item,
            ("facebookUrl", "pageUrl", "profileUrl", "authorUrl", "authorProfileUrl", "inputUrl"),
        )
        or _first_str(user, ("url", "profileUrl"))
        or _first_str(author, ("profileUrl", "url", "linkedinUrl"))
        or _first_str(author_meta, ("profileUrl",))
    )


def extract_post_url(item: dict[str, Any]) -> str:
    return _first_str(
        item,
        ("url", "postUrl", "webVideoUrl", "linkedinUrl", "shareUrl", "link", "topLevelUrl", "permalink"),
    )


def extract_post_id(item: dict[str, Any]) -> str:
    pid = _first_str(item, ("postId", "urn", "id", "post_id", "feedbackId"))
    if pid:
        return pid
    return extract_post_url(item)


def extract_post_text(item: dict[str, Any]) -> str:
    return _first_str(
        item,
        ("text", "commentary", "message", "caption", "postText", "content", "desc", "description"),
    )


def _collect_avatar_urls(item: dict[str, Any]) -> set[str]:
    avatars: set[str] = set()
    for key in ("pageAvatar", "authorAvatar", "profilePic", "profilePicture", "avatarUrl"):
        val = item.get(key)
        if isinstance(val, str) and val.strip():
            avatars.add(val.strip())
    for nested_key in ("user", "author", "page", "authorMeta", "actor"):
        nested = item.get(nested_key)
        if isinstance(nested, dict):
            for k in ("profilePic", "profilePicture", "avatar", "avatarUrl", "image"):
                val = nested.get(k)
                if isinstance(val, str) and val.strip():
                    avatars.add(val.strip())
    return avatars


def _is_avatar_url(url: str, avatars: set[str]) -> bool:
    if url in avatars:
        return True
    lowered = url.lower()
    if "profile_pic" in lowered or "avatar" in lowered:
        return True
    return False


def _is_video_url(url: str) -> bool:
    path = urllib.parse.urlparse(url).path.lower()
    return path.endswith((".mp4", ".mov", ".m4v", ".webm", ".m3u8"))


def _extract_url_from_media_obj(obj: Any) -> list[str]:
    found: list[str] = []
    if isinstance(obj, str) and obj.startswith("http"):
        if not _is_video_url(obj):
            found.append(obj.strip())
    elif isinstance(obj, dict):
        # Bỏ qua object đánh dấu là avatar hoặc profile
        obj_type = str(obj.get("__typename") or obj.get("type") or "").lower()
        if "avatar" in obj_type or "profile" in obj_type:
            return found
        is_video_obj = "video" in obj_type
        for k in ("image", "photo_image", "large_image", "full_image"):
            sub = obj.get(k)
            if isinstance(sub, dict) and isinstance(sub.get("uri"), str):
                found.append(sub["uri"].strip())
            elif isinstance(sub, str) and sub.startswith("http") and not _is_video_url(sub):
                found.append(sub.strip())
        img_keys = (
            ("thumbnail", "thumbnailUrl", "coverUrl", "coverImage")
            if is_video_obj
            else ("thumbnail", "thumbnailUrl", "imageUrl", "photoUrl", "url", "uri", "src")
        )
        for k in img_keys:
            val = obj.get(k)
            if isinstance(val, str) and val.startswith("http"):
                # Không lấy link trang facebook.com/photo hoặc link file .mp4 làm thẻ <img>
                if (
                    not re.match(r"^https?://(www\.|m\.)?facebook\.com/", val, re.IGNORECASE)
                    and not _is_video_url(val)
                ):
                    found.append(val.strip())
    return found


def extract_images(item: dict[str, Any], limit: int = MAX_IMAGES_PER_POST) -> list[str]:
    avatars = _collect_avatar_urls(item)
    candidates: list[str] = []

    for key in ("images", "imageUrls", "postImages", "photos", "media", "mediaUrls", "covers", "attachments"):
        val = item.get(key)
        if isinstance(val, list):
            for entry in val:
                candidates.extend(_extract_url_from_media_obj(entry))
        elif isinstance(val, dict):
            candidates.extend(_extract_url_from_media_obj(val))

    for key in ("image", "imageUrl", "photoUrl", "thumbnail", "thumbnailUrl", "videoMeta", "article", "document"):
        val = item.get(key)
        if isinstance(val, str) and val.startswith("http"):
            candidates.append(val.strip())
        elif isinstance(val, dict):
            for subk in ("coverUrl", "originalCoverUrl", "coverImage", "thumbnail"):
                subv = val.get(subk)
                if isinstance(subv, str) and subv.startswith("http"):
                    candidates.append(subv.strip())
            candidates.extend(_extract_url_from_media_obj(val))

    # Gỡ trùng lặp, bỏ avatar, giữ đúng thứ tự và giới hạn tối đa 20 ảnh
    seen: set[str] = set()
    result: list[str] = []
    for url in candidates:
        if not url or url in seen or _is_avatar_url(url, avatars):
            continue
        seen.add(url)
        result.append(url)
        if len(result) >= limit:
            break
    return result


def extract_video_url(item: dict[str, Any]) -> str:
    val = _first_str(item, ("videoUrl", "playUrl", "video", "playableUrl"))
    if val:
        return val
    video_meta = item.get("videoMeta")
    if isinstance(video_meta, dict):
        v = _first_str(video_meta, ("downloadAddr", "playAddr", "url"))
        if v:
            return v
    for key in ("media", "attachments"):
        entries = item.get(key)
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                entry_type = str(entry.get("__typename") or entry.get("type") or "").lower()
                if "video" in entry_type:
                    for k in ("playable_url", "videoUrl", "url"):
                        v = entry.get(k)
                        if isinstance(v, str) and v.startswith("http"):
                            return v.strip()
    return ""


def matches_page(item: dict[str, Any], match: str | None) -> bool:
    if not match or not match.strip():
        return True
    needle = match.strip().lower()
    haystacks = [
        extract_page_name(item).lower(),
        extract_page_url(item).lower(),
        extract_post_url(item).lower(),
    ]
    return any(needle in h for h in haystacks if h)


def deduplicate_and_filter_items(
    items: list[dict[str, Any]],
    match: str | None = None,
) -> list[dict[str, Any]]:
    """Loại bài trùng theo postId/url, lọc theo ?match= và sắp xếp mới nhất trước."""
    deduped: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for item in items:
        if not isinstance(item, dict):
            continue
        if not matches_page(item, match):
            continue
        key = extract_post_id(item)
        if key:
            if key in seen_keys:
                continue
            seen_keys.add(key)
        deduped.append(item)

    deduped.sort(
        key=lambda x: extract_post_datetime(x)
        or datetime.fromtimestamp(0, tz=timezone.utc),
        reverse=True,
    )
    return deduped


def filter_recent_runs(
    runs: list[dict[str, Any]],
    lookback_days: int = DEFAULT_LOOKBACK_DAYS,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    ref_now = now or datetime.now(timezone.utc)
    cutoff = ref_now - timedelta(days=lookback_days)
    recent: list[dict[str, Any]] = []
    for run in runs:
        if str(run.get("status", "")).upper() != "SUCCEEDED":
            continue
        dt = parse_iso_datetime(run.get("finishedAt") or run.get("startedAt"))
        if dt is not None and dt < cutoff:
            continue
        if run.get("defaultDatasetId"):
            recent.append(run)
    return recent


def build_post_title(page_name: str, text: str, has_video: bool, images_count: int) -> str:
    collapsed = re.sub(r"\s+", " ", text or "").strip()
    if collapsed:
        snippet = collapsed[:90] + ("…" if len(collapsed) > 90 else "")
    elif has_video:
        snippet = "(Bài viết video)"
    elif images_count > 0:
        snippet = f"(Bài viết {images_count} hình ảnh)"
    else:
        snippet = "(Bài viết Facebook)"
    return f"{page_name}: {snippet}"


def build_post_html(item: dict[str, Any]) -> str:
    text = extract_post_text(item)
    images = extract_images(item)
    video_url = extract_video_url(item)
    post_url = extract_post_url(item)

    parts: list[str] = []
    if text:
        escaped = html.escape(text).replace("\r\n", "\n").replace("\n", "<br/>\n")
        parts.append(f"<p>{escaped}</p>")

    if video_url:
        safe_video = html.escape(video_url, quote=True)
        parts.append(f'<p>🎥 <a href="{safe_video}">Xem video</a></p>')

    for img_url in images:
        safe_img = html.escape(img_url, quote=True)
        parts.append(f'<p><img src="{safe_img}" alt="Ảnh bài viết" /></p>')

    if post_url:
        safe_url = html.escape(post_url, quote=True)
        parts.append(f'<p><a href="{safe_url}">Xem bài gốc</a></p>')

    return "\n".join(parts)


def build_rss_xml(
    items: list[dict[str, Any]],
    task_id: str,
    match: str | None = None,
) -> str:
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")

    feed_title = f"Social - {match.strip()}" if match and match.strip() else f"Apify Task {task_id}"
    ET.SubElement(channel, "title").text = feed_title
    ET.SubElement(channel, "link").text = "https://apify.com/"
    ET.SubElement(channel, "description").text = f"Nguồn mạng xã hội qua Apify bridge (task {task_id})"
    ET.SubElement(channel, "lastBuildDate").text = format_datetime(datetime.now(timezone.utc))

    for item in items:
        page_name = extract_page_name(item)
        text = extract_post_text(item)
        images = extract_images(item)
        video_url = extract_video_url(item)
        post_url = extract_post_url(item)
        post_id = extract_post_id(item) or post_url or str(hash(text))
        pub_dt = extract_post_datetime(item)

        entry = ET.SubElement(channel, "item")
        ET.SubElement(entry, "title").text = build_post_title(
            page_name=page_name,
            text=text,
            has_video=bool(video_url),
            images_count=len(images),
        )
        if post_url:
            ET.SubElement(entry, "link").text = post_url
        guid = ET.SubElement(entry, "guid", {"isPermaLink": "false"})
        guid.text = post_id
        if pub_dt is not None:
            ET.SubElement(entry, "pubDate").text = format_datetime(pub_dt)
        ET.SubElement(entry, "author").text = page_name
        ET.SubElement(entry, "description").text = build_post_html(item)

    xml_bytes = ET.tostring(rss, encoding="utf-8", xml_declaration=True)
    return xml_bytes.decode("utf-8")


def parse_usage_payload(monthly_data: dict[str, Any] | None, limits_data: dict[str, Any] | None, budget_usd: float) -> dict[str, Any]:
    spend = 0.0
    period_start = None
    period_end = None

    if isinstance(monthly_data, dict):
        data = monthly_data.get("data") if isinstance(monthly_data.get("data"), dict) else monthly_data
        if isinstance(data, dict):
            period_start = data.get("usageCycle", {}).get("startAt") if isinstance(data.get("usageCycle"), dict) else data.get("startAt")
            period_end = data.get("usageCycle", {}).get("endAt") if isinstance(data.get("usageCycle"), dict) else data.get("endAt")
            for key in ("totalUsageCreditsUsdAfterVolumeDiscount", "totalUsageCreditsUsdBeforeVolumeDiscount", "totalUsageCreditsUsd"):
                if isinstance(data.get(key), (int, float)):
                    spend = float(data[key])
                    break

    if spend == 0.0 and isinstance(limits_data, dict):
        ldata = limits_data.get("data") if isinstance(limits_data.get("data"), dict) else limits_data
        if isinstance(ldata, dict):
            current = ldata.get("current") if isinstance(ldata.get("current"), dict) else {}
            if isinstance(current.get("monthlyUsageUsd"), (int, float)):
                spend = float(current["monthlyUsageUsd"])

    budget = max(float(budget_usd), 0.01)
    percent = round((spend / budget) * 100.0, 2)
    return {
        "configured": True,
        "spend_usd": round(spend, 4),
        "budget_usd": round(budget, 2),
        "percent": percent,
        "warning_over_80": percent >= 80.0,
        "period_start": period_start,
        "period_end": period_end,
    }


class TTLCache:
    """Bộ nhớ đệm đơn giản theo thời gian sống (mặc định 10 phút)."""

    def __init__(self, ttl_seconds: int = CACHE_TTL_SECONDS) -> None:
        self.ttl_seconds = ttl_seconds
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        hit = self._store.get(key)
        if not hit:
            return None
        expires_at, value = hit
        if time.monotonic() > expires_at:
            self._store.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (time.monotonic() + self.ttl_seconds, value)

    def clear(self) -> int:
        count = len(self._store)
        self._store.clear()
        return count
