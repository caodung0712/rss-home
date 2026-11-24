# RSS Home — Trình đọc RSS & Theo dõi Social tự host

> **Cập nhật lần cuối:** `2026-11-24`

Hệ thống đọc RSS và theo dõi tin tức/mạng xã hội tự host trên Docker Compose, giao diện kiểu Inoreader, gồm 6 dịch vụ:

- **`reader-ui`** (Next.js 15.1.6, React 19, TypeScript, Tailwind CSS, port `3000`): giao diện đọc tin, quản lý nguồn/thư mục/tag, proxy video TikTok, thu thập chỉ số tương tác vào Postgres, xuất dữ liệu & cấu hình.
- **`apify-bridge`** (Python 3.12, FastAPI, Uvicorn, `httpx`, `yt-dlp`, port nội bộ `8000`): cầu nối tạo RSS 2.0 cho Website không có RSS (Sitemap / HTML & JSON Scraper miễn phí), LinkedIn miễn phí, Facebook (Free & Apify Direct có fallback actor), stream/archive TikTok, thu thập số view/tương tác (`/social/metrics`) và theo dõi chi phí Apify (`/usage`).
- **`miniflux`** (port `8080`): lõi quét RSS/Atom định kỳ, lưu trữ bài viết và cung cấp REST API.
- **`db`** (PostgreSQL 17 Alpine): cơ sở dữ liệu của Miniflux cùng bảng phụ `rss_tags` và `entry_social_metrics`.
- **`rsshub`** + **`redis`** (Redis 7 Alpine): tạo RSS cho TikTok, X, Telegram, Facebook Free và cung cấp danh mục radar/namespace route.

---

## 1. Tính năng hiện có (tính đến 2026-11-24)

### 1.1. Trình đọc chính (`/`)
- **Bố cục 3 cột kiểu Inoreader:** lọc theo thư mục, nguồn tin, trạng thái chưa đọc/đã đọc, bài đã lưu (Bookmark), tìm kiếm toàn văn và lọc theo **Tag màu**.
- **Gắn Tag & Tuỳ biến giao diện:** gắn/gỡ tag thủ công trên từng thẻ bài hoặc màn hình đọc chi tiết, tuỳ chỉnh màu tag, hỗ trợ **Dark/Light mode** và song ngữ **Tiếng Việt / English**.
- **Đọc toàn văn & Media:** hỗ trợ lấy toàn văn bài viết (*Fetch original content*), nhúng YouTube, phát video TikTok trực tiếp qua `/api/tiktok-video` (`yt-dlp`), xem thư viện ảnh bài viết.
- **Số lượt xem & tương tác mạng xã hội (`$0` miễn phí, không áp dụng Facebook):**
  - Tự động thu thập & lưu vào bảng phụ `entry_social_metrics` (cache TTL 2 giờ) cho **TikTok** (`views`, `likes`, `comments`, `shares`), **YouTube** (`views`, `likes`), **X / Twitter** qua `fxtwitter` (`views`, `likes`, `comments`, `shares`), và **LinkedIn công khai** (`likes`, `comments`, `shares`).
  - Hiển thị badge thẳng hàng trên danh sách bài (cả bài có ảnh và không ảnh) kèm nút **Cập nhật tương tác** trong màn hình đọc chi tiết.
- **Tải thêm bài cũ (Archive Pagination):** kéo thêm các bài cũ hơn ngoài giới hạn RSS mặc định cho YouTube, Telegram, TikTok (kèm lưu metrics) và Facebook.
- **Thao tác hàng loạt & Xuất dữ liệu:** chọn nhiều bài để đánh dấu đã đọc, copy Markdown, tải toàn bộ ảnh hoặc xuất file **ZIP** (Markdown + ảnh offline + `index.csv`).

### 1.2. Thêm nguồn & Dò feed thông minh (`/add`)
- **Theo dõi Website / RSS (tự động chọn hoặc thử từng phương thức miễn phí `$0`):**
  - Chế độ **Tự động (Khuyên dùng):** kiểm tra RSS/Atom mặc định trước; nếu trang web không có RSS sẵn, tự động dò song song 4 phương thức dự phòng và chấm điểm chọn phương thức phù hợp nhất:
    1. **Sitemap.xml** (`/web/sitemap/inspect`, `/web/sitemap.xml`): tự đọc `robots.txt` / `sitemap_index`, cho phép chọn sitemap con và lọc theo đường dẫn.
    2. **Scraper tổng quát miễn phí** (`/web/scrape/preview`, `/web/scrape.xml`): tự nhận diện HTML (JSON-LD, `__NEXT_DATA__`, `<article>`, nhóm thẻ lặp lại hoặc CSS selector tuỳ chỉnh) và JSON API (`json_path`).
    3. **Google News RSS:** theo dõi qua `site:<domain>` (hỗ trợ tiếng Việt / English).
    4. **RSSHub Route:** tự tra cứu `/api/radar/rules` & `/api/namespace` trên RSSHub nội bộ để gợi ý route khớp tên miền.
  - Người dùng có thể chuyển qua lại bất kỳ phương thức nào, tinh chỉnh tuỳ chọn, xem trước danh sách bài lấy thử rồi mới bấm theo dõi.
- **Các nguồn mạng xã hội & tin tức tích hợp sẵn:**
  - **YouTube:** nhập `@handle` hoặc link kênh, tuỳ chọn bỏ video Shorts (playlist `UULF`).
  - **TikTok:** miễn phí `$0` qua RSSHub nội bộ + phát video qua `yt-dlp`.
  - **LinkedIn:** miễn phí `$0` qua `/linkedin.xml` (đọc JSON-LD công khai, tự fallback Google News khi gặp HTTP 999) + tìm việc LinkedIn Jobs.
  - **X (Twitter):** qua RSSHub (`TWITTER_AUTH_TOKEN`) hoặc `fxtwitter.com`.
  - **Facebook:** chế độ miễn phí (`/facebook.xml` qua RSSHub + Google News fallback) hoặc **Apify Direct** (`/apify/facebook.xml` dùng `APIFY_FB_ACTOR_ID` mặc định `alfalfa~facebook-posts-scraper`, tự fallback sang `APIFY_FB_FALLBACK_ACTOR_ID` mặc định `scraper_one~facebook-posts-scraper`, hỗ trợ video trong `attachments` và cache TTL).
  - **Khác:** Google News theo từ khoá, Google Alerts, Telegram, Bluesky, RSSHub route tuỳ chỉnh.
- **Export & Import chuyển máy:**
  - **Export JSON** (`/api/sources/export?format=json`) & **Export OPML** (`?format=opml`): xuất toàn bộ kênh đang theo dõi (giữ thư mục, tên hiển thị, chế độ toàn văn, rule lọc `blocklist`/`keeplist`; không chứa mật khẩu hay API token).
  - **Import JSON** (`/api/sources/import-channels`): tự tạo thư mục còn thiếu, thêm kênh mới và khôi phục cài đặt (hỗ trợ tuỳ chọn cập nhật lại kênh đã tồn tại).
  - Vẫn hỗ trợ import hàng loạt từ **OPML (Inoreader)** và **`social.csv`**.

### 1.3. Quản lý nội dung (`/manage`) & Trạng thái (`/status`)
- **`/manage`:** thống kê dung lượng Postgres & Redis theo từng nguồn, tỉ lệ đọc, lọc theo thư mục/loại nguồn/lỗi, bật/tắt feed, chỉnh sửa rule lọc, dọn dẹp bài cũ, quản lý thư mục & tag màu, kèm nút nhanh **Export JSON** và **Import kênh**.
- **`/status`:** kiểm tra trạng thái kết nối các dịch vụ và theo dõi mức sử dụng ngân sách Apify hàng tháng (`/usage`).

---

## 2. Truy cập nhanh trên máy cục bộ

- **Reader UI:** `http://localhost:3000` (mật khẩu nằm trong biến `READER_UI_PASSWORD` của `.env`; nếu để trống sẽ vào thẳng khi chạy cục bộ)
- **Miniflux gốc:** `http://localhost:8080` (`MINIFLUX_ADMIN_USERNAME` / `MINIFLUX_ADMIN_PASSWORD` trong `.env`)
- **Quản lý nội dung:** `http://localhost:3000/manage`
- **Thêm / Import / Export nguồn:** `http://localhost:3000/add`
- **Trang trạng thái hệ thống:** `http://localhost:3000/status`

> **Lưu ý bảo mật:** Không mở cổng ra ngoài cho `rsshub`, `redis`, `apify-bridge`, `db` và không commit file `.env` / token. Khi truy cập từ xa, chỉ đi qua mạng riêng **Tailscale** (`http://<ten-may-tailscale>:3000`).

---

## 3. Cấu hình `.env` & Nạp nguồn ban đầu

1. Sao chép `.env.example` thành `.env` và điền thông tin Postgres, Miniflux và tuỳ chọn bảo mật `READER_UI_PASSWORD`.
2. **Các token tuỳ chọn (chỉ điền nếu dùng các nguồn tương ứng):**
   - `TWITTER_AUTH_TOKEN`: cookie `auth_token` cho X qua RSSHub.
   - `FACEBOOK_COOKIE`: cookie cho Facebook chế độ miễn phí qua RSSHub.
   - `APIFY_TOKEN`: nếu dùng chế độ Apify Direct cào Facebook Page (`/apify/facebook.xml`). Có thể cấu hình thêm `APIFY_FB_ACTOR_ID`, `APIFY_FB_FALLBACK_ACTOR_ID`, `APIFY_FB_CACHE_MINUTES`, `APIFY_MONTHLY_BUDGET_USD`.
3. **Khởi động và nạp nguồn (nếu import bằng script):**
   ```bash
   make up
   python3 scripts/import_sources.py
   python3 scripts/check_feeds.py
   ```
   - Hoặc upload trực tiếp file `.json` / `.opml` / `social.csv` ngay trên giao diện `http://localhost:3000/add?section=import`.

---

## 4. Lệnh vận hành & Kiểm thử

- Khởi động toàn bộ hệ thống: `make up`
- Dừng hệ thống: `make down`
- Xem trạng thái container: `make ps`
- Xem log: `make logs`
- Sao lưu Postgres (giữ 14 bản gần nhất): `make backup`
- Khôi phục Postgres từ bản sao lưu:
  ```bash
  make restore FILE=./backups/miniflux-YYYYMMDD-HHMMSS.sql.gz
  ```
- Chạy unit test cho `apify-bridge`:
  ```bash
  make test
  # hoặc trực tiếp trong container:
  docker compose exec -T apify-bridge python3 -m unittest discover -s tests -v
  ```
- Build kiểm tra giao diện Next.js:
  ```bash
  docker compose up -d --build reader-ui apify-bridge
  ```
- Cập nhật image nền tảng (Miniflux / RSSHub / Postgres / Redis):
  ```bash
  docker compose pull && docker compose up -d
  ```

---

## 5. Phím tắt trong Reader UI

- `j` / `k`: chuyển sang bài tiếp theo / bài trước
- `Enter` hoặc `o`: mở / đóng bài viết
- `m`: đánh dấu đã đọc / chưa đọc
- `s`: lưu / bỏ lưu bài viết (Bookmark)
- `v`: mở bài gốc trong tab mới
- `Shift + A`: đánh dấu tất cả là đã đọc
- `/`: nhảy vào ô tìm kiếm
- `Esc`: đóng trình đọc hoặc thoát chế độ chọn nhiều
