"""Unit test cho apify-bridge với dữ liệu mẫu (có ảnh, không ảnh, video, chỉ ảnh)."""

from __future__ import annotations

import sys
import unittest
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bridge_core import (
    MAX_IMAGES_PER_POST,
    TTLCache,
    build_rss_xml,
    deduplicate_and_filter_items,
    extract_images,
    filter_recent_runs,
    parse_usage_payload,
)
from linkedin_rss import (
    build_linkedin_rss_xml,
    extract_linkedin_post_urls,
    extract_name_from_google_rss,
    normalize_linkedin_url,
    parse_google_news_rss_items,
    parse_linkedin_post_html,
)
from social_free import (
    extract_best_thumbnail,
    normalize_facebook_target,
    normalize_tiktok_handle,
)


class ApifyBridgeCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sample_items = [
            {
                "postId": "p1",
                "pageName": "Nguyễn Hữu Trí",
                "facebookUrl": "https://www.facebook.com/nguyenhuutri",
                "url": "https://www.facebook.com/nguyenhuutri/posts/111",
                "time": "2026-11-22T10:00:00Z",
                "text": "Dòng 1: Chia sẻ tư duy dài hơn chín mươi ký tự để kiểm tra cắt tiêu đề tự động cho thật chuẩn xác và rõ ràng.\nDòng 2: Giữ nguyên xuống dòng.",
                "pageAvatar": "https://cdn.example.com/avatar.jpg",
                "user": {
                    "name": "Nguyễn Hữu Trí",
                    "profilePic": "https://cdn.example.com/user-pic.jpg",
                },
                "images": [
                    "https://cdn.example.com/avatar.jpg",  # trùng avatar -> phải bỏ
                    "https://cdn.example.com/photo1.jpg",
                    "https://cdn.example.com/photo2.jpg",
                ],
            },
            {
                "postId": "p2",
                "pageName": "5 Phút Crypto",
                "facebookUrl": "https://www.facebook.com/5phutcrypto",
                "url": "https://www.facebook.com/5phutcrypto/posts/222",
                "time": "2026-11-22T09:00:00Z",
                "text": "Chỉ có text, không ảnh.\nPhân tích thị trường hôm nay.",
            },
            {
                "postId": "p3",
                "pageName": "Nguyễn Hữu Trí",
                "facebookUrl": "https://www.facebook.com/nguyenhuutri",
                "url": "https://www.facebook.com/nguyenhuutri/videos/333",
                "time": "2026-11-22T08:00:00Z",
                "text": "",
                "videoUrl": "https://video.example.com/clip.mp4",
                "thumbnail": "https://cdn.example.com/video-thumb.jpg",
            },
            {
                "postId": "p4",
                "pageName": "Nguyễn Hữu Trí",
                "facebookUrl": "https://www.facebook.com/nguyenhuutri",
                "url": "https://www.facebook.com/nguyenhuutri/posts/444",
                "time": "2026-11-22T07:00:00Z",
                "text": "",
                "photos": [f"https://cdn.example.com/img_{i}.jpg" for i in range(25)],
            },
            # Trùng postId p1 từ một run khác
            {
                "postId": "p1",
                "pageName": "Nguyễn Hữu Trí",
                "url": "https://www.facebook.com/nguyenhuutri/posts/111",
                "time": "2026-11-22T10:00:00Z",
                "text": "Bản trùng",
            },
        ]

    def test_deduplicate_and_match_filter(self) -> None:
        filtered = deduplicate_and_filter_items(self.sample_items, match="Nguyễn Hữu Trí")
        self.assertEqual([x["postId"] for x in filtered], ["p1", "p3", "p4"])

        crypto_only = deduplicate_and_filter_items(self.sample_items, match="5phutcrypto")
        self.assertEqual([x["postId"] for x in crypto_only], ["p2"])

    def test_avatar_excluded_and_max_20_images(self) -> None:
        p1_imgs = extract_images(self.sample_items[0])
        self.assertEqual(
            p1_imgs,
            ["https://cdn.example.com/photo1.jpg", "https://cdn.example.com/photo2.jpg"],
        )

        p4_imgs = extract_images(self.sample_items[3])
        self.assertEqual(len(p4_imgs), MAX_IMAGES_PER_POST)

    def test_rss_xml_format_all_post_types(self) -> None:
        filtered = deduplicate_and_filter_items(self.sample_items)
        xml_str = build_rss_xml(filtered, task_id="task123")
        root = ET.fromstring(xml_str)
        items = root.findall("./channel/item")
        self.assertEqual(len(items), 4)

        # Bài 1: có ảnh + giữ xuống dòng + cắt tiêu đề <= 90 ký tự phần nội dung
        t1 = items[0].findtext("title") or ""
        d1 = items[0].findtext("description") or ""
        self.assertTrue(t1.startswith("Nguyễn Hữu Trí: "))
        self.assertIn("<br/>", d1)
        self.assertIn("https://cdn.example.com/photo1.jpg", d1)
        self.assertNotIn("avatar.jpg", d1)
        self.assertIn("Xem bài gốc", d1)

        # Bài 2: không ảnh
        d2 = items[1].findtext("description") or ""
        self.assertNotIn("<img", d2)
        self.assertIn("Chỉ có text", d2)

        # Bài 3: video không text
        t3 = items[2].findtext("title") or ""
        d3 = items[2].findtext("description") or ""
        self.assertIn("(Bài viết video)", t3)
        self.assertIn("Xem video", d3)

        # Bài 4: chỉ có ảnh (25 ảnh -> giới hạn 20)
        t4 = items[3].findtext("title") or ""
        d4 = items[3].findtext("description") or ""
        self.assertIn("20 hình ảnh", t4)
        self.assertEqual(d4.count("<img "), 20)

    def test_filter_recent_runs_7_days(self) -> None:
        now = datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc)
        runs = [
            {
                "id": "r1",
                "status": "SUCCEEDED",
                "finishedAt": (now - timedelta(days=1)).isoformat(),
                "defaultDatasetId": "ds1",
            },
            {
                "id": "r2",
                "status": "FAILED",
                "finishedAt": (now - timedelta(days=1)).isoformat(),
                "defaultDatasetId": "ds2",
            },
            {
                "id": "r3",
                "status": "SUCCEEDED",
                "finishedAt": (now - timedelta(days=8)).isoformat(),
                "defaultDatasetId": "ds3",
            },
        ]
        recent = filter_recent_runs(runs, lookback_days=7, now=now)
        self.assertEqual([r["id"] for r in recent], ["r1"])

    def test_usage_warning_threshold(self) -> None:
        ok_usage = parse_usage_payload({"data": {"totalUsageCreditsUsdAfterVolumeDiscount": 2.5}}, None, 5.0)
        self.assertFalse(ok_usage["warning_over_80"])
        self.assertEqual(ok_usage["percent"], 50.0)

        warn_usage = parse_usage_payload({"data": {"totalUsageCreditsUsdAfterVolumeDiscount": 4.2}}, None, 5.0)
        self.assertTrue(warn_usage["warning_over_80"])
        self.assertEqual(warn_usage["percent"], 84.0)

    def test_ttl_cache(self) -> None:
        cache = TTLCache(ttl_seconds=60)
        cache.set("k", [1, 2, 3])
        self.assertEqual(cache.get("k"), [1, 2, 3])
        self.assertEqual(cache.clear(), 1)
        self.assertIsNone(cache.get("k"))

    def test_linkedin_and_tiktok_items(self) -> None:
        items = [
            {
                "urn": "urn:li:activity:7100001",
                "author": {
                    "name": "Justin Welsh",
                    "profileUrl": "https://www.linkedin.com/in/justinwelsh",
                    "avatar": "https://media.licdn.com/avatar.jpg",
                },
                "commentary": "Build a one-person business with distribution.",
                "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:7100001",
                "postedAt": {"date": "2026-11-22T12:00:00Z"},
                "postImages": [{"url": "https://media.licdn.com/slide1.jpg"}],
            },
            {
                "id": "7710348513128828191",
                "authorMeta": {
                    "name": "tiktok",
                    "nickName": "TikTok Official",
                    "avatar": "https://p16.tiktokcdn.com/avatar.jpg",
                },
                "text": "Short video caption #creator",
                "webVideoUrl": "https://www.tiktok.com/@tiktok/video/7710348513128828191",
                "createTimeISO": "2026-11-22T14:00:00Z",
                "videoMeta": {
                    "coverUrl": "https://p16.tiktokcdn.com/cover.jpg",
                    "downloadAddr": "https://v16.tiktokcdn.com/video.mp4",
                },
            },
        ]

        li = deduplicate_and_filter_items(items, match="justinwelsh")
        self.assertEqual(len(li), 1)
        li_xml = build_rss_xml(li, task_id="li_task", match="Justin Welsh")
        li_root = ET.fromstring(li_xml)
        li_item = li_root.find("./channel/item")
        self.assertIsNotNone(li_item)
        self.assertIn("Justin Welsh:", li_item.findtext("title") or "")
        self.assertIn("slide1.jpg", li_item.findtext("description") or "")
        self.assertNotIn("avatar.jpg", li_item.findtext("description") or "")

        tt = deduplicate_and_filter_items(items, match="TikTok Official")
        self.assertEqual(len(tt), 1)
        tt_xml = build_rss_xml(tt, task_id="tt_task", match="tiktok")
        tt_root = ET.fromstring(tt_xml)
        tt_item = tt_root.find("./channel/item")
        self.assertIsNotNone(tt_item)
        self.assertIn("TikTok Official:", tt_item.findtext("title") or "")
        self.assertIn("cover.jpg", tt_item.findtext("description") or "")
        self.assertIn("Xem video", tt_item.findtext("description") or "")

    def test_free_linkedin_rss_parser(self) -> None:
        self.assertEqual(
            normalize_linkedin_url("justinwelsh"),
            "https://www.linkedin.com/in/justinwelsh",
        )
        self.assertEqual(
            normalize_linkedin_url("https://www.linkedin.com/company/openai/"),
            "https://www.linkedin.com/company/openai",
        )
        sample_profile = """
        <html><head><title>Justin Welsh | LinkedIn</title></head>
        <body>
          <a href="https://www.linkedin.com/posts/justinwelsh_test-activity-123">Post</a>
        </body></html>
        """
        urls = extract_linkedin_post_urls(sample_profile)
        self.assertEqual(urls, ["https://www.linkedin.com/posts/justinwelsh_test-activity-123"])

        sample_post_html = """
        <html><head>
        <script type="application/ld+json">
        {"@context":"http://schema.org","@type":"SocialMediaPosting",
         "@id":"https://www.linkedin.com/posts/justinwelsh_test-activity-123",
         "datePublished":"2026-11-22T12:48:23.087Z",
         "headline":"Build distribution first.",
         "articleBody":"Line 1\\nLine 2",
         "author":{"@type":"Person","name":"Justin Welsh"},
         "image":{"@type":"ImageObject","url":"https://media.licdn.com/dms/image/test.jpg"}}
        </script>
        </head><body></body></html>
        """
        parsed = parse_linkedin_post_html(sample_post_html, urls[0], "Justin Welsh")
        self.assertIsNotNone(parsed)
        xml_str = build_linkedin_rss_xml([parsed], "https://www.linkedin.com/in/justinwelsh", "Justin Welsh")
        root = ET.fromstring(xml_str)
        item = root.find("./channel/item")
        self.assertIsNotNone(item)
        self.assertIn("Justin Welsh: Line 1 Line 2", item.findtext("title") or "")
        self.assertIn("test.jpg", item.findtext("description") or "")
        self.assertIn("Xem bài gốc trên LinkedIn", item.findtext("description") or "")

    def test_google_news_linkedin_fallback(self) -> None:
        g1 = "<rss><channel><item><title>Monika Grycz 💌 - LinkedIn</title></item></channel></rss>"
        self.assertEqual(extract_name_from_google_rss(g1), "Monika Grycz")

        g2 = """<rss><channel><item>
        <title>To anyone still running GTM like it's 2019 - LinkedIn</title>
        <link>https://news.google.com/rss/articles/abc</link>
        <pubDate>Wed, 11 Nov 2026 14:54:52 GMT</pubDate>
        </item></channel></rss>"""
        items = parse_google_news_rss_items(g2, "Monika Grycz")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["headline"], "To anyone still running GTM like it's 2019")

    def test_social_free_helpers(self) -> None:
        self.assertEqual(normalize_tiktok_handle("https://www.tiktok.com/@craftzone47?lang=en"), "craftzone47")
        self.assertEqual(normalize_tiktok_handle("@linustech"), "linustech")
        self.assertEqual(normalize_facebook_target("https://www.facebook.com/openai/"), "openai")
        self.assertEqual(normalize_facebook_target("https://www.facebook.com/profile.php?id=1000123456"), "1000123456")
        self.assertEqual(normalize_facebook_target("https://www.facebook.com/people/John-Doe/1000999/"), "1000999")
        from app import normalize_apify_facebook_url
        self.assertEqual(normalize_apify_facebook_url("openai"), "https://www.facebook.com/openai")
        self.assertEqual(
            normalize_apify_facebook_url("https://www.facebook.com/nguyenhuutri"),
            "https://www.facebook.com/nguyenhuutri",
        )
        self.assertEqual(
            extract_best_thumbnail({"thumbnails": [{"id": "dynamicCover", "url": "https://a"}, {"id": "cover", "url": "https://b"}]}),
            "https://b",
        )

    def test_apify_facebook_direct_error_and_retry(self) -> None:
        from unittest.mock import patch
        import httpx
        from fastapi.testclient import TestClient
        import app as bridge_app

        bridge_app._apify_fb_page_cache.clear()
        calls = {"count": 0}

        class FakeResp:
            def __init__(self, payload: object, status_code: int = 200) -> None:
                self._payload = payload
                self.status_code = status_code
                self.text = str(payload)

            def json(self) -> object:
                return self._payload

        class RetryThenErrorClient:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            async def __aenter__(self) -> "RetryThenErrorClient":
                return self

            async def __aexit__(self, *args: object) -> None:
                pass

            async def post(self, *args: object, **kwargs: object) -> FakeResp:
                calls["count"] += 1
                if calls["count"] == 1:
                    raise httpx.ConnectError("transient dns")
                return FakeResp([{"url": "https://www.facebook.com/private", "error": "not_available", "errorDescription": "Private profile"}])

        with patch.object(bridge_app, "_get_apify_token", return_value="tok"), \
             patch.object(bridge_app.httpx, "AsyncClient", RetryThenErrorClient):
            client = TestClient(bridge_app.app)
            r = client.get("/apify/facebook.xml?url=https://www.facebook.com/private&limit=10")
            self.assertEqual(r.status_code, 422)
            self.assertEqual(calls["count"], 3)

    def test_apify_facebook_fallback_to_scraper_one_and_video_attachments(self) -> None:
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        import app as bridge_app

        bridge_app._apify_fb_page_cache.clear()
        seen_urls: list[str] = []
        seen_payloads: list[dict] = []

        class FakeResp:
            def __init__(self, payload: object, status_code: int = 200) -> None:
                self._payload = payload
                self.status_code = status_code
                self.text = str(payload)

            def json(self) -> object:
                return self._payload

        class FallbackClient:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            async def __aenter__(self) -> "FallbackClient":
                return self

            async def __aexit__(self, *args: object) -> None:
                pass

            async def post(self, url: str, *args: object, **kwargs: object) -> FakeResp:
                seen_urls.append(url)
                seen_payloads.append(kwargs.get("json") or {})
                if "alfalfa~facebook-posts-scraper" in url:
                    return FakeResp([])
                return FakeResp([
                    {
                        "url": "https://www.facebook.com/reel/123/",
                        "pageUrl": "https://www.facebook.com/duyluannice",
                        "timestamp": 1795334656000,
                        "postText": "AI Agent là gì?",
                        "postId": "1130974703196302",
                        "author": {"name": "Duy Luân Dễ Thương"},
                        "attachments": [
                            {"type": "video", "url": "https://cdn.example.com/clip.mp4"}
                        ],
                    }
                ])

        with patch.object(bridge_app, "_get_apify_token", return_value="tok"), \
             patch.object(bridge_app.httpx, "AsyncClient", FallbackClient):
            client = TestClient(bridge_app.app)
            r = client.get("/apify/facebook.xml?url=https://www.facebook.com/duyluannice&limit=10&days=14")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.headers.get("x-apify-actor"), "scraper_one~facebook-posts-scraper")
            self.assertEqual(len(seen_urls), 2)
            self.assertIn("pageUrls", seen_payloads[1])
            self.assertRegex(seen_payloads[1]["onlyPostsNewerThan"], r"^\d{4}-\d{2}-\d{2}$")
            self.assertIn("AI Agent là gì?", r.text)
            self.assertIn("Xem video", r.text)
            self.assertNotIn('<img src="https://cdn.example.com/clip.mp4"', r.text)


class WebFreeTests(unittest.TestCase):
    def test_parse_sitemap_index_and_urlset(self) -> None:
        from web_free import parse_sitemap_xml

        idx_xml = """<?xml version="1.0" encoding="UTF-8"?>
        <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <sitemap><loc>https://example.com/sitemap-posts.xml</loc><lastmod>2026-11-24</lastmod></sitemap>
          <sitemap><loc>https://example.com/sitemap-tags.xml</loc></sitemap>
        </sitemapindex>"""
        kind, entries = parse_sitemap_xml(idx_xml)
        self.assertEqual(kind, "index")
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]["loc"], "https://example.com/sitemap-posts.xml")

        urlset_xml = """<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
                xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
          <url>
            <loc>https://example.com/tin-tuc/bai-1</loc>
            <lastmod>2026-11-24T01:00:00Z</lastmod>
            <news:news><news:title>Tiêu đề bài 1</news:title></news:news>
          </url>
        </urlset>"""
        kind2, urls = parse_sitemap_xml(urlset_xml)
        self.assertEqual(kind2, "urlset")
        self.assertEqual(urls[0]["title"], "Tiêu đề bài 1")
        self.assertEqual(urls[0]["url"], "https://example.com/tin-tuc/bai-1")

    def test_html_auto_and_selector_scrape(self) -> None:
        from web_free import build_web_rss_xml, extract_items_from_html

        sample_html = """<!doctype html><html><head><title>Blog Demo</title></head><body>
        <nav><a href="/about">Giới thiệu</a><a href="/contact">Liên hệ</a></nav>
        <main>
          <div class="post-card">
            <img data-src="/img/a.jpg" />
            <h2><a href="/bai-viet/huong-dan-rss">Hướng dẫn đọc RSS hiệu quả</a></h2>
            <p>Đoạn mô tả ngắn cho bài viết đầu tiên rất hay.</p>
            <time datetime="2026-11-23T08:00:00Z">23/11/2026</time>
          </div>
          <div class="post-card">
            <img src="/img/b.jpg" />
            <h2><a href="/bai-viet/tu-dong-hoa">Tự động hoá tin tức hằng ngày</a></h2>
            <p>Đoạn mô tả ngắn cho bài viết thứ hai rất chi tiết.</p>
            <time datetime="2026-11-22T08:00:00Z">22/11/2026</time>
          </div>
          <div class="post-card">
            <img src="/img/c.jpg" />
            <h2><a href="/bai-viet/cong-cu-moi">Tổng hợp công cụ miễn phí năm nay</a></h2>
            <p>Đoạn mô tả ngắn cho bài viết thứ ba khá đầy đủ.</p>
            <time datetime="2026-11-21T08:00:00Z">21/11/2026</time>
          </div>
        </main></body></html>"""

        page_title, auto_items = extract_items_from_html(sample_html, "https://demo.vn/blog")
        self.assertEqual(page_title, "Blog Demo")
        self.assertEqual(len(auto_items), 3)
        self.assertEqual(auto_items[0]["url"], "https://demo.vn/bai-viet/huong-dan-rss")
        self.assertEqual(auto_items[0]["image"], "https://demo.vn/img/a.jpg")

        _, sel_items = extract_items_from_html(
            sample_html, "https://demo.vn/blog", item_selector="div.post-card"
        )
        self.assertEqual(len(sel_items), 3)

        xml_str = build_web_rss_xml(sel_items, "https://demo.vn/blog", page_title)
        root = ET.fromstring(xml_str)
        self.assertEqual(len(root.findall("./channel/item")), 3)

    def test_json_api_extract(self) -> None:
        from web_free import extract_items_from_json

        payload = {
            "status": "ok",
            "data": {
                "posts": [
                    {
                        "title": "Bài JSON số 1",
                        "slug": "/news/json-1",
                        "publishedAt": "2026-11-24T00:00:00Z",
                        "thumbnail": "/thumb1.jpg",
                        "summary": "Tóm tắt bài 1",
                    },
                    {
                        "title": "Bài JSON số 2",
                        "slug": "/news/json-2",
                        "publishedAt": "2026-11-23T00:00:00Z",
                        "thumbnail": "/thumb2.jpg",
                        "summary": "Tóm tắt bài 2",
                    },
                ]
            },
        }
        items = extract_items_from_json(payload, base_url="https://api.example.com", json_path="data.posts")
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["url"], "https://api.example.com/news/json-1")
        self.assertEqual(items[0]["image"], "https://api.example.com/thumb1.jpg")

        auto_items = extract_items_from_json(payload, base_url="https://api.example.com")
        self.assertEqual(len(auto_items), 2)


class SocialMetricsTests(unittest.TestCase):
    def test_detect_platform_excludes_facebook(self) -> None:
        from social_metrics import detect_social_platform

        self.assertIsNone(detect_social_platform("https://www.facebook.com/openai/posts/123"))
        self.assertIsNone(
            detect_social_platform("https://fb.watch/abc", "http://apify-bridge:8000/facebook.xml?page=openai")
        )
        self.assertEqual(detect_social_platform("https://www.tiktok.com/@tiktok/video/12345"), "tiktok")
        self.assertEqual(detect_social_platform("https://www.youtube.com/watch?v=abc123"), "youtube")
        self.assertEqual(detect_social_platform("https://x.com/elonmusk/status/123456"), "x")
        self.assertEqual(
            detect_social_platform("https://www.linkedin.com/posts/justinwelsh_test-123"),
            "linkedin",
        )

    def test_youtube_and_linkedin_parsers(self) -> None:
        from social_metrics import (
            parse_linkedin_interaction_stats,
            parse_youtube_rss_stats,
            parse_youtube_watch_html_stats,
        )

        yt_xml = """<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
              xmlns:media="http://search.yahoo.com/mrss/"
              xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <yt:videoId>vid123</yt:videoId>
            <media:group>
              <media:community>
                <media:starRating count="452" average="5.00" min="1" max="5"/>
                <media:statistics views="33468"/>
              </media:community>
            </media:group>
          </entry>
        </feed>"""
        yt_stats = parse_youtube_rss_stats(yt_xml)
        self.assertEqual(yt_stats["vid123"]["views"], 33468)
        self.assertEqual(yt_stats["vid123"]["likes"], 452)

        html_stats = parse_youtube_watch_html_stats('"viewCount":"987654" ... "label":"12,345 likes"')
        self.assertEqual(html_stats["views"], 987654)
        self.assertEqual(html_stats["likes"], 12345)

        li_html = """<script type="application/ld+json">
        {"@type":"SocialMediaPosting","interactionStatistic":[
          {"@type":"InteractionCounter","interactionType":"http://schema.org/LikeAction","userInteractionCount":310},
          {"@type":"InteractionCounter","interactionType":"http://schema.org/CommentAction","userInteractionCount":24}
        ]}
        </script>"""
        li_stats = parse_linkedin_interaction_stats(li_html)
        self.assertEqual(li_stats["likes"], 310)
        self.assertEqual(li_stats["comments"], 24)
        self.assertIsNone(li_stats["views"])

    def test_social_metrics_endpoint_skips_facebook_and_collects_tiktok(self) -> None:
        from unittest.mock import patch
        from fastapi.testclient import TestClient
        import app as bridge_app
        import social_metrics

        social_metrics._tiktok_channel_metrics_cache.clear()
        social_metrics._single_metrics_cache.clear()

        fake_arch = {
            "handle": "tiktok",
            "items": [
                {
                    "id": "777",
                    "url": "https://www.tiktok.com/@tiktok/video/777",
                    "view_count": 403600,
                    "like_count": 6162,
                    "comment_count": 2599,
                    "repost_count": 595,
                }
            ],
        }
        with patch.object(social_metrics, "_sync_fetch_tiktok_archive", return_value=fake_arch):
            client = TestClient(bridge_app.app)
            r = client.post(
                "/social/metrics",
                json={
                    "items": [
                        {
                            "entry_id": 10,
                            "url": "https://www.tiktok.com/@tiktok/video/777",
                            "feed_url": "http://rsshub:1200/tiktok/user/@tiktok",
                        },
                        {
                            "entry_id": 11,
                            "url": "https://www.facebook.com/openai/posts/999",
                            "feed_url": "http://apify-bridge:8000/facebook.xml?page=openai",
                        },
                    ]
                },
            )
            self.assertEqual(r.status_code, 200)
            metrics = r.json()["metrics"]
            self.assertIn("10", metrics)
            self.assertNotIn("11", metrics)
            self.assertEqual(metrics["10"]["views"], 403600)
            self.assertEqual(metrics["10"]["likes"], 6162)
            self.assertEqual(metrics["10"]["comments"], 2599)
            self.assertEqual(metrics["10"]["shares"], 595)


if __name__ == "__main__":
    unittest.main()
