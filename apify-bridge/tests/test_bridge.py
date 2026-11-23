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


if __name__ == "__main__":
    unittest.main()
