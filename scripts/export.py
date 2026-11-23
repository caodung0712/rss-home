#!/usr/bin/env python3
"""Xuất hàng loạt bài viết từ Miniflux ra file ZIP (Markdown + ảnh + index.csv)."""

from __future__ import annotations

import argparse
import csv
import html as html_lib
import io
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT_DIR, MinifluxClient, load_env


class _MarkdownExtractor(HTMLParser):
    """Chuyển HTML bài viết sang Markdown gọn nhẹ, đồng thời thu thập URL ảnh."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.images: list[str] = []
        self._link_href: str | None = None
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = dict(attrs)
        t = tag.lower()
        if t in ("script", "style", "noscript"):
            self._skip_depth += 1
            return
        if self._skip_depth > 0:
            return
        if t == "br":
            self.parts.append("\n")
        elif t in ("p", "div", "blockquote"):
            self.parts.append("\n\n" if t != "blockquote" else "\n\n> ")
        elif t in ("h1", "h2", "h3", "h4"):
            self.parts.append(f"\n\n{'#' * int(t[1])} ")
        elif t == "li":
            self.parts.append("\n- ")
        elif t == "a":
            self._link_href = attr_map.get("href") or ""
            self.parts.append("[")
        elif t == "img":
            src = (
                attr_map.get("src")
                or attr_map.get("data-src")
                or attr_map.get("data-original")
                or ""
            ).strip()
            if src.startswith("http"):
                if src not in self.images:
                    self.images.append(src)
                alt = (attr_map.get("alt") or "ảnh").replace("]", "")
                self.parts.append(f"\n![{alt}]({src})\n")

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t in ("script", "style", "noscript"):
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if self._skip_depth > 0:
            return
        if t == "a":
            href = self._link_href or ""
            self._link_href = None
            self.parts.append(f"]({href})" if href else "]")
        elif t in ("p", "h1", "h2", "h3", "h4", "ul", "ol"):
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        self.parts.append(data)


def html_to_markdown_and_images(raw_html: str) -> tuple[str, list[str]]:
    parser = _MarkdownExtractor()
    parser.feed(raw_html or "")
    parser.close()
    md = "".join(parser.parts)
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md, parser.images


def slugify(text: str, fallback: str = "bai-viet") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", html_lib.unescape(text or "")).strip("-").lower()
    return cleaned[:60] or fallback


def download_image(url: str) -> tuple[bytes, str] | None:
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            data = resp.read(20 * 1024 * 1024)
            if not data:
                return None
            ext = "jpg"
            if "png" in ctype:
                ext = "png"
            elif "webp" in ctype:
                ext = "webp"
            elif "gif" in ctype:
                ext = "gif"
            else:
                m = re.search(r"\.(png|jpg|jpeg|webp|gif)(\?|$)", url, re.I)
                if m:
                    ext = "jpg" if m.group(1).lower() == "jpeg" else m.group(1).lower()
            return data, ext
    except Exception:
        return None


def main() -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Xuất bài viết Miniflux thành file ZIP (Markdown + ảnh + index.csv).")
    parser.add_argument("--folder", help="Lọc theo tên folder (category)")
    parser.add_argument("--feed-id", type=int, help="Lọc theo feed ID")
    parser.add_argument("--starred", action="store_true", help="Chỉ xuất bài đã lưu (bookmark)")
    parser.add_argument("--status", choices=["unread", "read", "all"], default="all")
    parser.add_argument("--days", type=int, help="Chỉ lấy bài trong N ngày gần nhất")
    parser.add_argument("--search", help="Từ khoá tìm kiếm")
    parser.add_argument("--limit", type=int, default=200, help="Số bài tối đa (mặc định 200)")
    parser.add_argument("--output", type=Path, help="Đường dẫn file ZIP đầu ra")
    args = parser.parse_args()

    client = MinifluxClient()
    params: dict[str, str] = {
        "order": "published_at",
        "direction": "desc",
        "limit": str(min(args.limit, 500)),
        "offset": "0",
    }
    if args.status in ("unread", "read"):
        params["status"] = args.status
    if args.starred:
        params["starred"] = "true"
    if args.search:
        params["search"] = args.search
    if args.feed_id:
        params["feed_id"] = str(args.feed_id)
    if args.folder:
        cats = client.get_categories()
        matched = [c for c in cats if c.get("title", "").strip().lower() == args.folder.strip().lower()]
        if not matched:
            print(f"Không tìm thấy folder '{args.folder}'.")
            return 1
        params["category_id"] = str(matched[0]["id"])
    if args.days and args.days > 0:
        after_ts = int((datetime.now(timezone.utc) - timedelta(days=args.days)).timestamp())
        params["published_after"] = str(after_ts)

    query = urllib.parse.urlencode(params)
    resp = client.request("GET", f"/v1/entries?{query}")
    entries: list[dict[str, Any]] = (resp or {}).get("entries") or []
    if not entries:
        print("Không có bài viết nào khớp điều kiện.")
        return 0

    exports_dir = ROOT_DIR / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.output or (exports_dir / f"rss-export-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    csv_buf = io.StringIO()
    writer = csv.writer(csv_buf)
    writer.writerow(["id", "title", "source", "folder", "url", "published_at", "starred", "markdown_file", "images_count"])

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for entry in entries:
            eid = entry["id"]
            title = entry.get("title") or f"Bài viết {eid}"
            feed = entry.get("feed") or {}
            source = feed.get("title") or ""
            folder = (feed.get("category") or {}).get("title") or ""
            url = entry.get("url") or ""
            published_at = entry.get("published_at") or ""
            starred = bool(entry.get("starred"))

            md_body, img_urls = html_to_markdown_and_images(entry.get("content") or "")
            for enc in entry.get("enclosures") or []:
                eurl = enc.get("url") or ""
                if eurl.startswith("http") and eurl not in img_urls and (enc.get("mime_type") or "").startswith("image/"):
                    img_urls.append(eurl)

            saved_images = 0
            for idx, img_url in enumerate(img_urls[:30], start=1):
                dl = download_image(img_url)
                if not dl:
                    continue
                img_bytes, ext = dl
                rel_img = f"images/{eid}_{idx}.{ext}"
                zf.writestr(rel_img, img_bytes)
                md_body = md_body.replace(img_url, rel_img)
                saved_images += 1

            md_filename = f"{slugify(title)}-{eid}.md"
            safe_title = title.replace('"', '\\"')
            safe_source = source.replace('"', '\\"')
            safe_folder = folder.replace('"', '\\"')
            md_doc = (
                f"---\n"
                f"id: {eid}\n"
                f'title: "{safe_title}"\n'
                f'source: "{safe_source}"\n'
                f'folder: "{safe_folder}"\n'
                f'url: "{url}"\n'
                f'published_at: "{published_at}"\n'
                f"starred: {'true' if starred else 'false'}\n"
                f"images_count: {saved_images}\n"
                f"---\n\n"
                f"# {title}\n\n"
                f"> Nguồn: {source} · [Bài gốc]({url})\n\n"
                f"{md_body}\n"
            )
            zf.writestr(md_filename, md_doc)
            writer.writerow([eid, title, source, folder, url, published_at, str(starred).lower(), md_filename, saved_images])

        zf.writestr("index.csv", ("\ufeff" + csv_buf.getvalue()).encode("utf-8"))

    print(f"✓ Đã xuất {len(entries)} bài viết ra: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
