"""Công cụ miễn phí ($0) biến website không có RSS thành RSS 2.0:
1. Sitemap.xml (tự dò robots.txt / sitemap_index / sitemap.xml và lấy metadata bài viết).
2. Scraper tổng quát (HTML theo selector/heuristic hoặc JSON API tự động).
"""

from __future__ import annotations

import asyncio
import gzip
import html
import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import format_datetime, parsedate_to_datetime
from html.parser import HTMLParser
from typing import Any

import httpx

from bridge_core import TTLCache, parse_iso_datetime

WEB_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
}

_web_feed_cache = TTLCache(ttl_seconds=1800)  # 30 phút

VOID_TAGS = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}

SKIP_CONTAINER_TAGS = {"nav", "header", "footer", "aside", "form", "dialog"}
NOISE_TEXT_PATTERNS = re.compile(
    r"^(xem thêm|đọc tiếp|chi tiết|read more|learn more|see more|sign in|login|đăng nhập|đăng ký|menu|trang chủ|home|liên hệ|contact|tìm kiếm|search)$",
    re.IGNORECASE,
)


def normalize_web_url(raw: str) -> str:
    val = (raw or "").strip()
    if not val:
        raise ValueError("Thiếu URL website cần theo dõi.")
    if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", val):
        val = f"https://{val}"
    parsed = urllib.parse.urlparse(val)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL phải hợp lệ và bắt đầu bằng http:// hoặc https://.")
    return val


def parse_flexible_datetime(raw: Any) -> datetime | None:
    if not raw:
        return None
    dt = parse_iso_datetime(raw)
    if dt is not None:
        return dt
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        dt2 = parsedate_to_datetime(text)
        if dt2.tzinfo is None:
            dt2 = dt2.replace(tzinfo=timezone.utc)
        return dt2.astimezone(timezone.utc)
    except (TypeError, ValueError):
        pass

    # Thử các định dạng ngày phổ biến trên web Việt Nam / quốc tế
    m = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](20\d{2})", text)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            try:
                return datetime(year, month, day, tzinfo=timezone.utc)
            except ValueError:
                pass
    m2 = re.search(r"(20\d{2})[/-](\d{1,2})[/-](\d{1,2})", text)
    if m2:
        year, month, day = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            try:
                return datetime(year, month, day, tzinfo=timezone.utc)
            except ValueError:
                pass
    return None


def _clean_space(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _slug_to_title(url: str) -> str:
    path = urllib.parse.urlparse(url).path.strip("/")
    if not path:
        return urllib.parse.urlparse(url).netloc or url
    last = path.split("/")[-1]
    last = re.sub(r"\.(html?|php|aspx?)$", "", last, flags=re.IGNORECASE)
    last = re.sub(r"[-_]+", " ", last).strip()
    return last.capitalize() if last else url


# ---------------------------------------------------------------------------
# Lightweight DOM tree parser (zero external dependency)
# ---------------------------------------------------------------------------


@dataclass
class _Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list[_Node | str] = field(default_factory=list)
    parent: _Node | None = field(default=None, repr=False)

    def attr(self, key: str, default: str = "") -> str:
        return self.attrs.get(key, default)

    def classes(self) -> list[str]:
        raw = self.attrs.get("class", "")
        return [c for c in raw.split() if c]

    def text(self, separator: str = " ") -> str:
        parts: list[str] = []
        for child in self.children:
            if isinstance(child, str):
                parts.append(child)
            elif child.tag not in ("script", "style", "svg", "noscript"):
                t = child.text(separator=separator)
                if t:
                    parts.append(t)
        return _clean_space(separator.join(parts))

    def raw_text(self) -> str:
        parts: list[str] = []
        for child in self.children:
            if isinstance(child, str):
                parts.append(child)
            else:
                parts.append(child.raw_text())
        return "".join(parts)

    def iter_elements(self) -> list[_Node]:
        out: list[_Node] = []
        for child in self.children:
            if isinstance(child, _Node):
                out.append(child)
                out.extend(child.iter_elements())
        return out

    def has_ancestor(self, tags: set[str]) -> bool:
        cur = self.parent
        while cur is not None:
            if cur.tag in tags:
                return True
            cur = cur.parent
        return False


class _MiniDOMParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = _Node(tag="document")
        self._stack: list[_Node] = [self.root]
        self._ignore_depth = 0
        self._preserve_script = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        attr_dict = {k.lower(): (v or "") for k, v in attrs}
        if tag_l in ("style", "svg", "noscript"):
            self._ignore_depth += 1
            return
        if tag_l == "script":
            stype = attr_dict.get("type", "").lower()
            sid = attr_dict.get("id", "")
            if "ld+json" in stype or sid == "__NEXT_DATA__":
                self._preserve_script = True
            else:
                self._ignore_depth += 1
                return
        if self._ignore_depth > 0:
            return

        node = _Node(tag=tag_l, attrs=attr_dict, parent=self._stack[-1])
        self._stack[-1].children.append(node)
        if tag_l not in VOID_TAGS:
            self._stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        if self._ignore_depth > 0 or tag_l in ("style", "svg", "script", "noscript"):
            return
        attr_dict = {k.lower(): (v or "") for k, v in attrs}
        node = _Node(tag=tag_l, attrs=attr_dict, parent=self._stack[-1])
        self._stack[-1].children.append(node)

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        if tag_l in ("style", "svg", "noscript"):
            if self._ignore_depth > 0:
                self._ignore_depth -= 1
            return
        if tag_l == "script":
            if self._preserve_script:
                self._preserve_script = False
                if len(self._stack) > 1 and self._stack[-1].tag == "script":
                    self._stack.pop()
            elif self._ignore_depth > 0:
                self._ignore_depth -= 1
            return
        if self._ignore_depth > 0 or tag_l in VOID_TAGS:
            return
        for idx in range(len(self._stack) - 1, 0, -1):
            if self._stack[idx].tag == tag_l:
                del self._stack[idx:]
                break

    def handle_data(self, data: str) -> None:
        if self._ignore_depth > 0:
            return
        if data:
            self._stack[-1].children.append(data)


def parse_html_dom(html_text: str) -> _Node:
    parser = _MiniDOMParser()
    parser.feed(html_text or "")
    parser.close()
    return parser.root


def _match_simple_selector(node: _Node, token: str) -> bool:
    token = token.strip()
    if not token:
        return False
    # Hỗ trợ [attr=val] hoặc [attr]
    attr_checks: list[tuple[str, str | None]] = []

    def _collect_attr(m: re.Match[str]) -> str:
        k = m.group(1).lower()
        v = m.group(2)
        if v is not None:
            v = v.strip("\"'")
        attr_checks.append((k, v))
        return ""

    core = re.sub(r"\[([a-zA-Z0-9_-]+)(?:=([^\]]+))?\]", _collect_attr, token)

    # Tách tag, #id, .class1.class2
    tag_req: str | None = None
    id_req: str | None = None
    classes_req: list[str] = []

    parts = re.split(r"(?=[.#])", core)
    for p in parts:
        if not p:
            continue
        if p.startswith("#"):
            id_req = p[1:]
        elif p.startswith("."):
            classes_req.append(p[1:])
        elif p != "*":
            tag_req = p.lower()

    if tag_req and node.tag != tag_req:
        return False
    if id_req and node.attr("id") != id_req:
        return False
    if classes_req:
        node_classes = set(node.classes())
        if not all(c in node_classes for c in classes_req):
            return False
    for k, v in attr_checks:
        if k not in node.attrs:
            return False
        if v is not None and node.attrs.get(k) != v:
            return False
    return True


def select_nodes(root: _Node, selector: str) -> list[_Node]:
    """Hỗ trợ CSS selector cơ bản: 'article', '.post', 'div.list article', 'a.title, h2 a'."""
    results: list[_Node] = []
    seen: set[int] = set()
    all_nodes = root.iter_elements()

    for group in selector.split(","):
        tokens = [t for t in group.strip().split() if t and t != ">"]
        if not tokens:
            continue
        for node in all_nodes:
            if not _match_simple_selector(node, tokens[-1]):
                continue
            # Kiểm tra tổ tiên theo thứ tự ngược lại
            ok = True
            cur = node.parent
            for tok in reversed(tokens[:-1]):
                while cur is not None and not _match_simple_selector(cur, tok):
                    cur = cur.parent
                if cur is None:
                    ok = False
                    break
                cur = cur.parent
            if ok and id(node) not in seen:
                seen.add(id(node))
                results.append(node)
    return results


# ---------------------------------------------------------------------------
# 1. SITEMAP.XML
# ---------------------------------------------------------------------------


def _local_tag(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1].lower()
    return tag.lower()


def _decode_xml_bytes(raw: bytes) -> str:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", errors="replace")


def parse_sitemap_xml(xml_text: str) -> tuple[str, list[dict[str, Any]]]:
    cleaned = (xml_text or "").lstrip("\ufeff \t\r\n")
    if not cleaned or "<html" in cleaned[:300].lower():
        raise ValueError("Nội dung trả về không phải XML sitemap hợp lệ.")
    root = ET.fromstring(cleaned)
    root_name = _local_tag(root.tag)

    if root_name == "sitemapindex":
        sitemaps: list[dict[str, Any]] = []
        for child in root:
            if _local_tag(child.tag) != "sitemap":
                continue
            loc = ""
            lastmod = ""
            for sub in child:
                t = _local_tag(sub.tag)
                if t == "loc" and sub.text:
                    loc = sub.text.strip()
                elif t == "lastmod" and sub.text:
                    lastmod = sub.text.strip()
            if loc:
                sitemaps.append({"loc": loc, "lastmod": lastmod})
        return "index", sitemaps

    if root_name == "urlset":
        urls: list[dict[str, Any]] = []
        for child in root:
            if _local_tag(child.tag) != "url":
                continue
            loc = ""
            lastmod = ""
            title = ""
            image = ""
            published = ""
            for sub in child:
                t = _local_tag(sub.tag)
                if t == "loc" and sub.text:
                    loc = sub.text.strip()
                elif t == "lastmod" and sub.text:
                    lastmod = sub.text.strip()
                elif t == "news":
                    for nsub in sub:
                        nt = _local_tag(nsub.tag)
                        if nt == "title" and nsub.text:
                            title = nsub.text.strip()
                        elif nt == "publication_date" and nsub.text:
                            published = nsub.text.strip()
                elif t == "image" and not image:
                    for isub in sub:
                        if _local_tag(isub.tag) == "loc" and isub.text:
                            image = isub.text.strip()
                            break
            if loc:
                urls.append(
                    {
                        "url": loc,
                        "lastmod": published or lastmod,
                        "title": title,
                        "image": image,
                    }
                )
        return "urlset", urls

    raise ValueError(f"Thẻ gốc XML không phải sitemapindex/urlset ({root_name}).")


def _score_child_sitemap(entry: dict[str, Any], match: str | None = None) -> tuple[int, str]:
    loc = entry.get("loc", "").lower()
    score = 0
    if match and match.strip().lower() in loc:
        score += 50
    for kw in ("news", "post", "article", "blog", "tin", "story", "bai-viet", "journal"):
        if kw in loc:
            score += 20
    for kw in ("company", "companies", "product", "page"):
        if kw in loc:
            score += 5
    for bad in ("tag", "category", "author", "image", "video", "static", "archive"):
        if bad in loc:
            score -= 10
    return score, entry.get("lastmod") or ""


def _is_content_url(url: str, match: str | None = None) -> bool:
    if match and match.strip():
        return match.strip().lower() in url.lower()
    parsed = urllib.parse.urlparse(url)
    path = parsed.path.lower()
    if path in ("", "/"):
        return False
    if path.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".pdf", ".xml")):
        return False
    return True


async def _discover_sitemap_urls(client: httpx.AsyncClient, input_url: str) -> list[str]:
    parsed = urllib.parse.urlparse(input_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    candidates: list[str] = []
    if parsed.path.lower().endswith((".xml", ".xml.gz")):
        candidates.append(input_url)

    # Kiểm tra robots.txt trước
    try:
        r = await client.get(f"{origin}/robots.txt")
        if r.status_code == 200:
            for line in r.text.splitlines():
                if line.lower().startswith("sitemap:"):
                    sm_url = line.split(":", 1)[1].strip()
                    if sm_url and sm_url not in candidates:
                        candidates.append(sm_url)
    except httpx.HTTPError:
        pass

    for suffix in ("/sitemap.xml", "/sitemap_index.xml", "/news-sitemap.xml", "/post-sitemap.xml"):
        u = f"{origin}{suffix}"
        if u not in candidates:
            candidates.append(u)
    return candidates


async def _fetch_page_metadata(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    item: dict[str, Any],
) -> dict[str, Any]:
    url = item["url"]
    if item.get("title"):
        return item
    async with sem:
        try:
            resp = await client.get(url, timeout=6.0)
            if resp.status_code != 200 or "html" not in resp.headers.get("content-type", "").lower():
                item["title"] = _slug_to_title(url)
                return item
            dom = parse_html_dom(resp.text[:150_000])
            meta_map: dict[str, str] = {}
            for m in select_nodes(dom, "meta"):
                key = (m.attr("property") or m.attr("name")).lower()
                val = m.attr("content").strip()
                if key and val and key not in meta_map:
                    meta_map[key] = val
            title = meta_map.get("og:title") or meta_map.get("twitter:title") or ""
            if not title:
                t_nodes = select_nodes(dom, "title")
                if t_nodes:
                    title = t_nodes[0].text()
            item["title"] = _clean_space(title) or _slug_to_title(url)
            if not item.get("summary"):
                item["summary"] = _clean_space(
                    meta_map.get("og:description") or meta_map.get("description") or ""
                )
            if not item.get("image"):
                img = meta_map.get("og:image") or meta_map.get("twitter:image") or ""
                if img:
                    item["image"] = urllib.parse.urljoin(url, img)
            if not item.get("lastmod"):
                pub = (
                    meta_map.get("article:published_time")
                    or meta_map.get("og:updated_time")
                    or meta_map.get("pubdate")
                    or ""
                )
                if pub:
                    item["lastmod"] = pub
        except (httpx.HTTPError, Exception):
            item["title"] = _slug_to_title(url)
    return item


async def fetch_sitemap_items(
    url: str,
    limit: int = 20,
    match: str | None = None,
    sitemap_url: str | None = None,
    enrich: bool = True,
) -> dict[str, Any]:
    target = normalize_web_url(url)
    parsed_target = urllib.parse.urlparse(target)
    domain = parsed_target.netloc
    child_sitemaps: list[dict[str, Any]] = []
    chosen_sitemap = ""
    raw_items: list[dict[str, Any]] = []

    async with httpx.AsyncClient(
        timeout=15.0, headers=WEB_HEADERS, follow_redirects=True
    ) as client:
        candidates = [normalize_web_url(sitemap_url)] if sitemap_url else await _discover_sitemap_urls(client, target)
        for cand in candidates:
            try:
                resp = await client.get(cand)
                if resp.status_code != 200:
                    continue
                xml_text = _decode_xml_bytes(resp.content)
                kind, entries = parse_sitemap_xml(xml_text)
                chosen_sitemap = cand
                if kind == "urlset":
                    raw_items = entries
                    break
                if kind == "index" and entries:
                    child_sitemaps = entries
                    ranked = sorted(
                        entries,
                        key=lambda e: _score_child_sitemap(e, match=match),
                        reverse=True,
                    )
                    for child in ranked[:2]:
                        try:
                            c_resp = await client.get(child["loc"])
                            if c_resp.status_code != 200:
                                continue
                            c_kind, c_entries = parse_sitemap_xml(_decode_xml_bytes(c_resp.content))
                            if c_kind == "urlset" and c_entries:
                                raw_items.extend(c_entries)
                                if len(raw_items) >= limit * 2:
                                    break
                        except (httpx.HTTPError, ValueError, ET.ParseError):
                            continue
                    if raw_items:
                        break
            except (httpx.HTTPError, ValueError, ET.ParseError):
                continue

        if not raw_items:
            raise ValueError(
                "Không tìm thấy sitemap.xml hợp lệ hoặc sitemap không có URL bài viết phù hợp."
            )

        filtered = [it for it in raw_items if _is_content_url(it["url"], match=match)]
        if not filtered:
            filtered = raw_items

        # Sắp xếp mới nhất trước nếu có lastmod
        has_dates = any(parse_flexible_datetime(it.get("lastmod")) for it in filtered)
        if has_dates:
            filtered.sort(
                key=lambda it: parse_flexible_datetime(it.get("lastmod"))
                or datetime.fromtimestamp(0, tz=timezone.utc),
                reverse=True,
            )

        selected = filtered[:limit]
        if enrich:
            sem = asyncio.Semaphore(5)
            enriched = await asyncio.gather(
                *[_fetch_page_metadata(client, sem, dict(it)) for it in selected]
            )
        else:
            enriched = []
            for it in selected:
                copy_it = dict(it)
                if not copy_it.get("title"):
                    copy_it["title"] = _slug_to_title(copy_it["url"])
                enriched.append(copy_it)

    formatted_items = [
        {
            "title": it.get("title") or _slug_to_title(it["url"]),
            "url": it["url"],
            "published_at": it.get("lastmod") or "",
            "image": it.get("image") or "",
            "summary": it.get("summary") or "",
        }
        for it in enriched
    ]
    return {
        "feed_title": f"{domain} (Sitemap)",
        "feed_url": target,
        "sitemap_url": chosen_sitemap,
        "sitemaps": child_sitemaps[:30],
        "items": formatted_items,
    }


# ---------------------------------------------------------------------------
# 2. SCRAPER TỔNG QUÁT (HTML / JSON API)
# ---------------------------------------------------------------------------


def _traverse_json_path(data: Any, path: str) -> Any:
    cur = data
    for part in [p for p in (path or "").split(".") if p]:
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            idx = int(part)
            cur = cur[idx] if 0 <= idx < len(cur) else None
        else:
            return None
    return cur


def _find_best_json_list(data: Any, depth: int = 0) -> list[dict[str, Any]]:
    if depth > 6:
        return []
    if isinstance(data, list):
        dicts = [x for x in data if isinstance(x, dict)]
        if dicts and any(
            k in d
            for d in dicts[:3]
            for k in ("title", "name", "headline", "url", "link", "slug", "permalink")
        ):
            return dicts
    if isinstance(data, dict):
        # Ưu tiên các key quen thuộc
        for key in ("items", "posts", "articles", "data", "results", "records", "entries", "news", "list"):
            if key in data:
                found = _find_best_json_list(data[key], depth + 1)
                if found:
                    return found
        for val in data.values():
            found = _find_best_json_list(val, depth + 1)
            if found:
                return found
    return []


def _pick_dict_str(item: dict[str, Any], keys: tuple[str, ...]) -> str:
    for k in keys:
        if not k:
            continue
        val = item.get(k)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, dict):
            nested = _pick_dict_str(val, ("rendered", "url", "src", "href", "text", "title"))
            if nested:
                return nested
    return ""


def extract_items_from_json(
    data: Any,
    base_url: str,
    json_path: str = "",
    title_key: str = "",
    url_key: str = "",
    date_key: str = "",
    image_key: str = "",
    summary_key: str = "",
    limit: int = 20,
) -> list[dict[str, Any]]:
    raw_list: Any = _traverse_json_path(data, json_path) if json_path else _find_best_json_list(data)
    if not isinstance(raw_list, list):
        return []

    title_keys = (title_key, "title", "name", "headline", "subject", "post_title")
    url_keys = (url_key, "url", "link", "href", "permalink", "webUrl", "canonical_url", "slug", "path")
    date_keys = (date_key, "publishedAt", "published_at", "createdAt", "created_at", "pubDate", "date", "updatedAt", "time")
    image_keys = (image_key, "image", "imageUrl", "image_url", "thumbnail", "cover", "coverImage", "featured_image", "thumb")
    summary_keys = (summary_key, "summary", "description", "excerpt", "snippet", "lead", "subtitle", "content")

    items: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for entry in raw_list:
        if not isinstance(entry, dict):
            continue
        title = _clean_space(_pick_dict_str(entry, title_keys))
        raw_url = _pick_dict_str(entry, url_keys)
        if not title or not raw_url:
            continue
        abs_url = urllib.parse.urljoin(base_url, raw_url)
        if abs_url in seen_urls:
            continue
        seen_urls.add(abs_url)
        raw_img = _pick_dict_str(entry, image_keys)
        abs_img = urllib.parse.urljoin(base_url, raw_img) if raw_img else ""
        summary = _clean_space(re.sub(r"<[^>]+>", " ", _pick_dict_str(entry, summary_keys)))[:320]
        pub = _pick_dict_str(entry, date_keys)
        items.append(
            {
                "title": title,
                "url": abs_url,
                "published_at": pub,
                "image": abs_img,
                "summary": summary,
            }
        )
        if len(items) >= limit:
            break
    return items


def _extract_jsonld_items(dom: _Node, page_url: str, limit: int) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for script in select_nodes(dom, "script"):
        if "ld+json" not in script.attr("type").lower():
            continue
        raw = script.raw_text().strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        candidates = data if isinstance(data, list) else [data]
        for obj in candidates:
            if not isinstance(obj, dict):
                continue
            nodes = obj.get("itemListElement") if isinstance(obj.get("itemListElement"), list) else [obj]
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                target = node.get("item") if isinstance(node.get("item"), dict) else node
                t_type = str(target.get("@type") or "").lower()
                if t_type and not any(
                    k in t_type for k in ("article", "blog", "news", "post", "listitem", "webpage")
                ):
                    continue
                title = _clean_space(str(target.get("headline") or target.get("name") or ""))
                link = str(target.get("url") or target.get("@id") or "").strip()
                if not title or not link or link == page_url:
                    continue
                abs_url = urllib.parse.urljoin(page_url, link)
                if abs_url in seen:
                    continue
                seen.add(abs_url)
                img_raw = target.get("image")
                img_url = ""
                if isinstance(img_raw, str):
                    img_url = urllib.parse.urljoin(page_url, img_raw)
                elif isinstance(img_raw, dict) and isinstance(img_raw.get("url"), str):
                    img_url = urllib.parse.urljoin(page_url, img_raw["url"])
                elif isinstance(img_raw, list) and img_raw and isinstance(img_raw[0], str):
                    img_url = urllib.parse.urljoin(page_url, img_raw[0])
                items.append(
                    {
                        "title": title,
                        "url": abs_url,
                        "published_at": str(target.get("datePublished") or target.get("dateModified") or ""),
                        "image": img_url,
                        "summary": _clean_space(str(target.get("description") or ""))[:300],
                    }
                )
                if len(items) >= limit:
                    return items
    return items


def _extract_next_data_items(dom: _Node, page_url: str, limit: int) -> list[dict[str, Any]]:
    for script in select_nodes(dom, "script#__NEXT_DATA__"):
        try:
            payload = json.loads(script.raw_text().strip())
        except json.JSONDecodeError:
            continue
        items = extract_items_from_json(payload, base_url=page_url, limit=limit)
        if len(items) >= 3:
            return items
    return []


def _extract_item_from_container(node: _Node, page_url: str) -> dict[str, Any] | None:
    links = [node] if node.tag == "a" else select_nodes(node, "a")
    best_url = ""
    best_title = ""

    # Ưu tiên heading chứa link hoặc link nằm trong heading
    for h_tag in ("h1", "h2", "h3", "h4"):
        for h in select_nodes(node, h_tag):
            h_links = select_nodes(h, "a")
            t = h.text()
            if h_links and h_links[0].attr("href") and len(t) >= 8:
                best_url = h_links[0].attr("href")
                best_title = t
                break
            if len(t) >= 8 and not best_title:
                best_title = t
        if best_url:
            break

    if not best_url:
        for a in links:
            href = a.attr("href").strip()
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            txt = a.text() or a.attr("title") or a.attr("aria-label")
            txt = _clean_space(txt)
            if not txt and best_title:
                best_url = href
                break
            if txt and not NOISE_TEXT_PATTERNS.match(txt) and len(txt) >= 10:
                best_url = href
                if not best_title or len(txt) > len(best_title):
                    best_title = txt
                break

    if not best_url or not best_title or len(best_title) < 8:
        return None
    if NOISE_TEXT_PATTERNS.match(best_title):
        return None

    abs_url = urllib.parse.urljoin(page_url, best_url)
    if abs_url.rstrip("/") == page_url.rstrip("/"):
        return None

    img_url = ""
    for img in select_nodes(node, "img"):
        src = (
            img.attr("data-src")
            or img.attr("data-lazy-src")
            or img.attr("data-original")
            or img.attr("src")
        ).strip()
        if src and not src.startswith("data:"):
            img_url = urllib.parse.urljoin(page_url, src)
            break

    pub_date = ""
    for t_node in select_nodes(node, "time"):
        pub_date = t_node.attr("datetime") or t_node.text()
        if pub_date:
            break

    summary = ""
    for p_node in select_nodes(node, "p"):
        p_txt = p_node.text()
        if p_txt and p_txt != best_title and len(p_txt) >= 20:
            summary = p_txt[:300]
            break

    return {
        "title": best_title[:200],
        "url": abs_url,
        "published_at": pub_date,
        "image": img_url,
        "summary": summary,
    }


def extract_items_from_html(
    html_text: str,
    page_url: str,
    item_selector: str = "",
    limit: int = 20,
) -> tuple[str, list[dict[str, Any]]]:
    dom = parse_html_dom(html_text)
    t_nodes = select_nodes(dom, "title")
    page_title = t_nodes[0].text() if t_nodes else urllib.parse.urlparse(page_url).netloc

    def _dedupe(cands: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for c in cands:
            u = c["url"]
            if u in seen:
                continue
            seen.add(u)
            out.append(c)
            if len(out) >= limit:
                break
        return out

    # 1. Nếu người dùng chỉ định CSS selector cụ thể
    if item_selector.strip():
        matched_nodes = select_nodes(dom, item_selector.strip())
        extracted = [
            it
            for it in (_extract_item_from_container(n, page_url) for n in matched_nodes)
            if it is not None
        ]
        return page_title, _dedupe(extracted)

    # 2. Thử JSON-LD hoặc __NEXT_DATA__
    ld_items = _extract_jsonld_items(dom, page_url, limit)
    if len(ld_items) >= 3:
        return page_title, ld_items

    next_items = _extract_next_data_items(dom, page_url, limit)
    if len(next_items) >= 3:
        return page_title, next_items

    # 3. Thử thẻ ngữ nghĩa <article>
    article_nodes = [
        n for n in select_nodes(dom, "article") if not n.has_ancestor(SKIP_CONTAINER_TAGS)
    ]
    article_items = _dedupe(
        [
            it
            for it in (_extract_item_from_container(n, page_url) for n in article_nodes)
            if it is not None
        ]
    )
    if len(article_items) >= 3:
        return page_title, article_items

    # 4. Heuristic nhóm anh em lặp lại (card/item danh sách bài viết)
    groups: dict[tuple[int, str, tuple[str, ...]], list[_Node]] = {}
    for node in dom.iter_elements():
        if node.parent is None or node.tag not in ("div", "li", "section", "tr", "article"):
            continue
        if node.has_ancestor(SKIP_CONTAINER_TAGS):
            continue
        sig = (id(node.parent), node.tag, tuple(sorted(node.classes())[:4]))
        groups.setdefault(sig, []).append(node)

    best_group_items: list[dict[str, Any]] = []
    best_score = 0
    for group_nodes in groups.values():
        if len(group_nodes) < 3:
            continue
        parsed_group = _dedupe(
            [
                it
                for it in (_extract_item_from_container(n, page_url) for n in group_nodes[: limit * 2])
                if it is not None
            ]
        )
        if len(parsed_group) < 3:
            continue
        richness = sum(
            (2 if it["image"] else 0) + (2 if it["summary"] else 0) + (1 if it["published_at"] else 0)
            for it in parsed_group
        )
        score = len(parsed_group) * 10 + richness
        if score > best_score:
            best_score = score
            best_group_items = parsed_group

    if len(best_group_items) >= 3:
        return page_title, best_group_items

    # 5. Fallback: link nội dung nổi bật trong <main> hoặc <body>
    scope_nodes = select_nodes(dom, "main") or select_nodes(dom, "body") or [dom]
    fallback_items: list[dict[str, Any]] = []
    origin = urllib.parse.urlparse(page_url).netloc
    for scope in scope_nodes[:1]:
        for a in select_nodes(scope, "a"):
            if a.has_ancestor(SKIP_CONTAINER_TAGS):
                continue
            href = a.attr("href").strip()
            if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
                continue
            abs_url = urllib.parse.urljoin(page_url, href)
            parsed_u = urllib.parse.urlparse(abs_url)
            if parsed_u.netloc and parsed_u.netloc != origin:
                continue
            if len(parsed_u.path.strip("/")) < 3:
                continue
            txt = _clean_space(a.text())
            if len(txt) < 18 or NOISE_TEXT_PATTERNS.match(txt):
                continue
            fallback_items.append(
                {
                    "title": txt[:200],
                    "url": abs_url,
                    "published_at": "",
                    "image": "",
                    "summary": "",
                }
            )
    deduped_fb = _dedupe(fallback_items)
    if deduped_fb:
        return page_title, deduped_fb
    return page_title, ld_items or article_items


async def scrape_web_free(
    url: str,
    mode: str = "auto",
    item_selector: str = "",
    json_path: str = "",
    title_key: str = "",
    url_key: str = "",
    date_key: str = "",
    image_key: str = "",
    summary_key: str = "",
    limit: int = 20,
) -> dict[str, Any]:
    target = normalize_web_url(url)
    domain = urllib.parse.urlparse(target).netloc
    req_headers = dict(WEB_HEADERS)
    if mode == "json":
        req_headers["Accept"] = "application/json,text/plain,*/*"

    async with httpx.AsyncClient(
        timeout=20.0, headers=req_headers, follow_redirects=True
    ) as client:
        resp = await client.get(target)
        if resp.status_code >= 400:
            raise ValueError(f"Trang web trả về HTTP {resp.status_code}.")
        ctype = resp.headers.get("content-type", "").lower()
        body_text = resp.text

    is_json = mode == "json" or (
        mode == "auto"
        and ("application/json" in ctype or body_text.lstrip().startswith(("{", "[")))
    )

    if is_json:
        try:
            payload = json.loads(body_text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Dữ liệu không phải JSON hợp lệ: {exc}") from exc
        items = extract_items_from_json(
            payload,
            base_url=target,
            json_path=json_path,
            title_key=title_key,
            url_key=url_key,
            date_key=date_key,
            image_key=image_key,
            summary_key=summary_key,
            limit=limit,
        )
        if not items:
            raise ValueError(
                "Đã đọc JSON nhưng không tự nhận diện được danh sách bài (thử điền Json Path như `data.items`)."
            )
        return {
            "feed_title": f"{domain} (JSON API)",
            "feed_url": target,
            "mode_used": "json",
            "items": items,
        }

    page_title, items = extract_items_from_html(
        body_text,
        page_url=target,
        item_selector=item_selector,
        limit=limit,
    )
    if not items:
        raise ValueError(
            "Không trích xuất được danh sách bài từ HTML (trang có thể render bằng JS hoặc cần nhập CSS selector như `article`, `.post-item`)."
        )
    return {
        "feed_title": page_title or f"{domain} (Web)",
        "feed_url": target,
        "mode_used": "html",
        "items": items,
    }


def build_web_rss_xml(
    items: list[dict[str, Any]],
    feed_url: str,
    feed_title: str,
    description: str = "",
) -> str:
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = feed_title or feed_url
    ET.SubElement(channel, "link").text = feed_url
    ET.SubElement(channel, "description").text = description or f"Nguồn web miễn phí từ {feed_url}"
    ET.SubElement(channel, "lastBuildDate").text = format_datetime(datetime.now(timezone.utc))

    for it in items:
        entry = ET.SubElement(channel, "item")
        ET.SubElement(entry, "title").text = it.get("title") or it["url"]
        ET.SubElement(entry, "link").text = it["url"]
        guid = ET.SubElement(entry, "guid", {"isPermaLink": "true"})
        guid.text = it["url"]

        dt = parse_flexible_datetime(it.get("published_at"))
        if dt is not None:
            ET.SubElement(entry, "pubDate").text = format_datetime(dt)

        parts: list[str] = []
        if it.get("image"):
            safe_img = html.escape(it["image"], quote=True)
            parts.append(f'<p><img src="{safe_img}" alt="" /></p>')
        if it.get("summary"):
            parts.append(f"<p>{html.escape(it['summary'])}</p>")
        safe_link = html.escape(it["url"], quote=True)
        parts.append(f'<p><a href="{safe_link}">Đọc bài gốc</a></p>')
        ET.SubElement(entry, "description").text = "\n".join(parts)

    xml_bytes = ET.tostring(rss, encoding="utf-8", xml_declaration=True)
    return xml_bytes.decode("utf-8")
