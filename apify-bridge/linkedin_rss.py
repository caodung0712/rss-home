"""Chuyển đổi trang công khai LinkedIn (cá nhân /in/... hoặc công ty /company/...) thành RSS 2.0 miễn phí."""

from __future__ import annotations

import html
import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Any

from bridge_core import TTLCache, build_post_title, parse_iso_datetime

LINKEDIN_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

POST_URL_RE = re.compile(r"https://www\.linkedin\.com/posts/[^\s\"<>\\]+")
LD_JSON_RE = re.compile(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', re.S | re.I)
TITLE_TAG_RE = re.compile(r"<title>(.*?)</title>", re.S | re.I)


def normalize_linkedin_url(raw: str) -> str:
    val = (raw or "").strip()
    if not val:
        raise ValueError("Thiếu đường dẫn hoặc tên hồ sơ LinkedIn.")
    if val.startswith("http://") or val.startswith("https://"):
        parsed = urllib.parse.urlparse(val)
        clean_path = parsed.path.rstrip("/")
        return f"https://www.linkedin.com{clean_path}"
    val = val.strip("/")
    if val.startswith("in/") or val.startswith("company/") or val.startswith("school/"):
        return f"https://www.linkedin.com/{val}"
    return f"https://www.linkedin.com/in/{val}"


def extract_linkedin_post_urls(profile_html: str, limit: int = 12) -> list[str]:
    seen: set[str] = set()
    urls: list[str] = []
    for match in POST_URL_RE.findall(profile_html or ""):
        clean = match.split("?")[0].rstrip("\\")
        if clean not in seen:
            seen.add(clean)
            urls.append(clean)
            if len(urls) >= limit:
                break
    return urls


def extract_linkedin_profile_title(profile_html: str, fallback_url: str) -> str:
    m = TITLE_TAG_RE.search(profile_html or "")
    if m:
        raw_title = html.unescape(m.group(1)).strip()
        cleaned = re.sub(r"\s*\|\s*LinkedIn.*$", "", raw_title, flags=re.I).strip()
        if cleaned:
            return cleaned
    slug = urllib.parse.urlparse(fallback_url).path.strip("/").split("/")[-1]
    return slug or "LinkedIn"


def parse_linkedin_post_html(post_html: str, post_url: str, fallback_author: str) -> dict[str, Any] | None:
    """Trích xuất bài đăng LinkedIn từ JSON-LD SocialMediaPosting hoặc thẻ meta."""
    ld_data: dict[str, Any] | None = None
    for block in LD_JSON_RE.findall(post_html or ""):
        try:
            parsed = json.loads(block)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            if parsed.get("@type") in ("SocialMediaPosting", "Article"):
                ld_data = parsed
                break
            graph = parsed.get("@graph")
            if isinstance(graph, list):
                for node in graph:
                    if isinstance(node, dict) and node.get("@type") in ("SocialMediaPosting", "Article"):
                        ld_data = node
                        break
        if ld_data:
            break

    if not ld_data:
        return None

    author_obj = ld_data.get("author") if isinstance(ld_data.get("author"), dict) else {}
    author_name = str(author_obj.get("name") or fallback_author).strip()
    body = str(ld_data.get("articleBody") or ld_data.get("description") or "").strip()
    headline = str(ld_data.get("headline") or "").strip()
    text = body or headline
    pub_dt = parse_iso_datetime(ld_data.get("datePublished"))

    images: list[str] = []
    img_field = ld_data.get("image")
    if isinstance(img_field, dict) and isinstance(img_field.get("url"), str):
        images.append(img_field["url"].strip())
    elif isinstance(img_field, list):
        for entry in img_field:
            if isinstance(entry, dict) and isinstance(entry.get("url"), str):
                images.append(entry["url"].strip())
            elif isinstance(entry, str) and entry.startswith("http"):
                images.append(entry.strip())

    # Lọc bỏ avatar nếu trùng
    images = [u for u in images if u and "profile-displayphoto" not in u.lower()]

    video_url = ""
    shared = ld_data.get("sharedContent")
    if isinstance(shared, dict):
        if isinstance(shared.get("contentUrl"), str):
            video_url = shared["contentUrl"].strip()

    return {
        "id": str(ld_data.get("@id") or post_url),
        "url": post_url,
        "author": author_name,
        "headline": headline,
        "text": text,
        "published_at": pub_dt,
        "images": images,
        "video_url": video_url,
    }


def extract_linkedin_articles_from_profile(profile_html: str, fallback_author: str) -> list[dict[str, Any]]:
    """Lấy thêm các bài viết LinkedIn Pulse / Article nhúng sẵn trong JSON-LD trang hồ sơ."""
    items: list[dict[str, Any]] = []
    for block in LD_JSON_RE.findall(profile_html or ""):
        try:
            parsed = json.loads(block)
        except json.JSONDecodeError:
            continue
        graph = parsed.get("@graph") if isinstance(parsed, dict) else None
        if not isinstance(graph, list):
            continue
        for node in graph:
            if not isinstance(node, dict):
                continue
            if node.get("@type") not in ("Article", "SocialMediaPosting"):
                continue
            url = str(node.get("mainEntityOfPage") or node.get("url") or "").strip()
            if not url or "/posts/" in url:
                continue
            author_obj = node.get("author") if isinstance(node.get("author"), dict) else {}
            author_name = str(author_obj.get("name") or fallback_author).strip()
            headline = str(node.get("headline") or "").strip()
            pub_dt = parse_iso_datetime(node.get("datePublished"))
            img = ""
            if isinstance(node.get("image"), dict):
                img = str(node["image"].get("url") or "").strip()
            items.append(
                {
                    "id": url,
                    "url": url,
                    "author": author_name,
                    "headline": headline,
                    "text": headline,
                    "published_at": pub_dt,
                    "images": [img] if img else [],
                    "video_url": "",
                }
            )
    return items


def build_linkedin_rss_xml(posts: list[dict[str, Any]], profile_url: str, feed_title: str) -> str:
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = f"{feed_title} (LinkedIn)"
    ET.SubElement(channel, "link").text = profile_url
    ET.SubElement(channel, "description").text = f"Bài đăng công khai trên LinkedIn từ {feed_title}"
    ET.SubElement(channel, "lastBuildDate").text = format_datetime(datetime.now(timezone.utc))

    # Sắp xếp mới nhất trước
    posts_sorted = sorted(
        posts,
        key=lambda x: x.get("published_at") or datetime.fromtimestamp(0, tz=timezone.utc),
        reverse=True,
    )

    for post in posts_sorted:
        author = post.get("author") or feed_title
        text = post.get("text") or post.get("headline") or ""
        images = post.get("images") or []
        video_url = post.get("video_url") or ""
        post_url = post.get("url") or profile_url
        pub_dt = post.get("published_at")

        entry = ET.SubElement(channel, "item")
        ET.SubElement(entry, "title").text = build_post_title(
            page_name=author,
            text=text,
            has_video=bool(video_url),
            images_count=len(images),
        )
        ET.SubElement(entry, "link").text = post_url
        guid = ET.SubElement(entry, "guid", {"isPermaLink": "false"})
        guid.text = str(post.get("id") or post_url)
        if isinstance(pub_dt, datetime):
            ET.SubElement(entry, "pubDate").text = format_datetime(pub_dt)
        ET.SubElement(entry, "author").text = author

        parts: list[str] = []
        if text:
            escaped = html.escape(text).replace("\r\n", "\n").replace("\n", "<br/>\n")
            parts.append(f"<p>{escaped}</p>")
        if video_url:
            safe_vid = html.escape(video_url, quote=True)
            parts.append(f'<p>🎥 <a href="{safe_vid}">Xem video</a></p>')
        for img_url in images[:20]:
            safe_img = html.escape(img_url, quote=True)
            parts.append(f'<p><img src="{safe_img}" alt="Ảnh LinkedIn" /></p>')
        parts.append(f'<p><a href="{html.escape(post_url, quote=True)}">Xem bài gốc trên LinkedIn</a></p>')

        ET.SubElement(entry, "description").text = "\n".join(parts)

    return ET.tostring(rss, encoding="utf-8", xml_declaration=True).decode("utf-8")


# Cache 24 giờ cho từng bài viết đơn lẻ đã fetch để không tải lặp lại nhiều lần
_linkedin_post_cache = TTLCache(ttl_seconds=86400)
# Cache 15 phút cho toàn bộ RSS feed của một trang hồ sơ
_linkedin_feed_cache = TTLCache(ttl_seconds=900)
