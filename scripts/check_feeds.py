#!/usr/bin/env python3
"""Kiểm tra trạng thái feed trong Miniflux: phát hiện lỗi, gợi ý thay thế, cảnh báo cookie X."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MinifluxClient, load_env


def suggest_alternative(feed_url: str, site_url: str) -> str:
    parsed = urllib.parse.urlparse(site_url or feed_url)
    host = parsed.netloc.lower()
    path = parsed.path.strip("/")

    if "inoreader.com" in feed_url or "web-feed" in feed_url:
        return "Feed tạo từ web của Inoreader không mang sang được; hãy viết route RSSHub hoặc dùng CSS selector của Miniflux."
    if "youtube.com" in host or "youtu.be" in host:
        return "Chạy `python3 scripts/import_sources.py --convert-youtube` để đổi sang feeds/videos.xml?channel_id=UC..."
    if "x.com" in host or "twitter.com" in host or "/twitter/" in feed_url:
        return "Kiểm tra TWITTER_AUTH_TOKEN trong .env hoặc đổi dự phòng sang https://fxtwitter.com/<handle>/feed.xml"
    if "facebook.com" in host or "apify-bridge" in feed_url:
        return "Kiểm tra Apify Task đã chạy trong 7 ngày gần nhất chưa, hoặc kiểm tra APIFY_TOKEN / ?match=."
    if "github.com" in host:
        return f"Thử RSS chính chủ `{site_url.rstrip('/')}/releases.atom` hoặc route RSSHub `http://rsshub:1200/github/repos/...`"
    if "substack.com" in host:
        return f"Thử `{parsed.scheme}://{parsed.netloc}/feed`"
    if "medium.com" in host:
        slug = path.split("/")[0] if path else ""
        return f"Thử `https://medium.com/feed/{slug}` hoặc route RSSHub `/medium/...`"
    if "reddit.com" in host:
        return f"Thử `{site_url.rstrip('/')}/.rss`"
    return f"Kiểm tra trang gốc `{site_url or feed_url}` để tìm link RSS khác hoặc route tương ứng trên RSSHub."


def analyze_feeds(client: MinifluxClient) -> dict[str, Any]:
    feeds = client.get_feeds()
    categories = {int(c["id"]): c.get("title", "") for c in client.get_categories()}

    broken: list[dict[str, Any]] = []
    x_feeds: list[dict[str, Any]] = []
    summary_candidates: list[dict[str, Any]] = []

    for feed in feeds:
        fid = int(feed["id"])
        cat_name = categories.get(int(feed.get("category", {}).get("id", 0)), "")
        err_count = int(feed.get("parsing_error_count") or 0)
        err_msg = (feed.get("parsing_error_message") or "").strip()
        feed_url = feed.get("feed_url", "")
        site_url = feed.get("site_url", "")
        disabled = bool(feed.get("disabled"))

        if "/twitter/" in feed_url or "fxtwitter.com" in feed_url:
            x_feeds.append(feed)

        if err_count > 0 or disabled:
            broken.append(
                {
                    "id": fid,
                    "title": feed.get("title", ""),
                    "folder": cat_name,
                    "feed_url": feed_url,
                    "site_url": site_url,
                    "error_count": err_count,
                    "disabled": disabled,
                    "error": err_msg,
                    "suggestion": suggest_alternative(feed_url, site_url),
                }
            )

        if not feed.get("crawler") and not feed_url.startswith("http://apify-bridge") and "/twitter/" not in feed_url:
            summary_candidates.append(feed)

    x_broken = [f for f in x_feeds if int(f.get("parsing_error_count") or 0) > 0]
    x_cookie_expired = len(x_feeds) >= 1 and len(x_broken) == len(x_feeds)

    return {
        "total_feeds": len(feeds),
        "healthy_feeds": len(feeds) - len(broken),
        "broken_count": len(broken),
        "broken": broken,
        "x_total": len(x_feeds),
        "x_broken": len(x_broken),
        "x_cookie_expired": x_cookie_expired,
        "crawler_disabled_count": len(summary_candidates),
    }


def enable_crawler_for_short_feeds(client: MinifluxClient, min_avg_len: int = 400) -> int:
    """Bật crawler ('Fetch original content') cho các blog/website chỉ đăng tóm tắt ngắn."""
    updated = 0
    for feed in client.get_feeds():
        feed_url = feed.get("feed_url", "")
        if feed.get("crawler"):
            continue
        if "youtube.com" in feed_url or "apify-bridge" in feed_url or "/twitter/" in feed_url:
            continue
        entries_resp = client.request("GET", f"/v1/feeds/{feed['id']}/entries?limit=5&order=published_at&direction=desc")
        entries = (entries_resp or {}).get("entries", [])
        if not entries:
            continue
        avg_len = sum(len((e.get("content") or "").strip()) for e in entries) / len(entries)
        if avg_len < min_avg_len:
            client.update_feed(int(feed["id"]), crawler=True)
            updated += 1
            print(f"✓ Đã bật Fetch original content (crawler) cho #{feed['id']} {feed.get('title')} (TB {int(avg_len)} ký tự)")
    return updated


def main() -> int:
    load_env()
    parser = argparse.ArgumentParser(description="Kiểm tra feed lỗi và phát hiện cookie X hết hạn.")
    parser.add_argument("--json", action="store_true", help="Xuất kết quả dạng JSON")
    parser.add_argument(
        "--enable-crawler",
        action="store_true",
        help="Tự bật 'Fetch original content' cho blog có nội dung RSS ngắn hơn ngưỡng",
    )
    parser.add_argument("--min-len", type=int, default=400, help="Ngưỡng ký tự trung bình để coi là bài tóm tắt")
    args = parser.parse_args()

    client = MinifluxClient()

    if args.enable_crawler:
        count = enable_crawler_for_short_feeds(client, min_avg_len=args.min_len)
        print(f"Tổng cộng đã bật crawler cho {count} feed.")

    report = analyze_feeds(client)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    print("=== BÁO CÁO TRẠNG THÁI FEED MINIFLUX ===")
    print(f"Tổng số feed: {report['total_feeds']} | Hoạt động tốt: {report['healthy_feeds']} | Lỗi/Tắt: {report['broken_count']}")

    if report["x_cookie_expired"]:
        print("\n⚠️  CẢNH BÁO COOKIE X (TWITTER):")
        print(
            f"   Tất cả {report['x_total']} feed X đều đang lỗi cùng lúc! "
            "Khả năng cao TWITTER_AUTH_TOKEN đã hết hạn hoặc tài khoản X phụ bị khoá."
        )
        print("   → Hãy lấy lại cookie auth_token mới, cập nhật vào .env và chạy `docker compose up -d rsshub`.")
        print("   → Dự phòng: chạy `python3 scripts/import_sources.py --skip-opml --platform x --use-fxtwitter`.\n")

    if report["broken"]:
        print("\n--- Danh sách feed lỗi ---")
        for item in report["broken"]:
            print(f"• [#{item['id']}] ({item['folder']}) {item['title']}")
            print(f"  URL: {item['feed_url']}")
            print(f"  Lỗi ({item['error_count']} lần): {item['error'] or 'Không rõ'}")
            print(f"  Gợi ý: {item['suggestion']}")
    else:
        print("\n✓ Không có feed nào bị lỗi.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
