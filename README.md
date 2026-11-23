# RSS Home — Trình đọc RSS tự host thay Inoreader

Hệ thống đọc RSS tự host chạy trên Docker Compose gồm:
- **Miniflux + Postgres 17**: lưu trữ tập trung, quét feed định kỳ và cung cấp REST API.
- **RSSHub + Redis**: tạo RSS cho các trang không có feed và X.com.
- **apify-bridge (Python)**: chuyển đổi dữ liệu Apify Task có sẵn (`alfalfa/facebook-posts-scraper`) thành RSS 2.0 theo từng Facebook Page và theo dõi chi phí `/usage`.
- **Reader UI (Next.js + Tailwind)**: giao diện kiểu Inoreader, gọi Miniflux API từ phía server, hỗ trợ đọc toàn văn, copy nhanh, chọn nhiều bài, xuất ZIP (Markdown + ảnh offline + `index.csv`), và trang `/status`.

---

## 1. Truy cập nhanh trên máy cục bộ

- **Reader UI**: `http://localhost:3000` (mật khẩu nằm trong biến `READER_UI_PASSWORD` của file `.env`)
- **Miniflux gốc**: `http://localhost:8080` (tài khoản `MINIFLUX_ADMIN_USERNAME` / `MINIFLUX_ADMIN_PASSWORD` trong `.env`)
- **Trang trạng thái hệ thống**: `http://localhost:3000/status`

> ⚠️ **Lưu ý bảo mật:** Không mở cổng ra ngoài cho `rsshub`, `redis`, `apify-bridge`, `db`. Khi dùng từ xa, chỉ truy cập qua **Tailscale** (`http://<ten-may-tailscale>:3000`).

---

## 2. Những bước bạn cần tự điền để kích hoạt nguồn tin cá nhân

1. **Xuất OPML từ Inoreader**:
   - Inoreader → *Preferences → Import/Export → Export OPML*, lưu thành `sources/inoreader.opml`.
2. **Tạo danh sách nguồn mạng xã hội (`sources/social.csv`)**:
   - Sao chép `sources/social.csv.example` thành `sources/social.csv` và điền các trang Facebook, tài khoản X, kênh YouTube.
3. **Điền token / cookie vào `.env`**:
   - `TWITTER_AUTH_TOKEN`: cookie `auth_token` của tài khoản X phụ.
   - `APIFY_TOKEN` và `APIFY_FB_TASK_ID`: lấy từ Apify sau khi tạo Task + Schedule cho `alfalfa/facebook-posts-scraper`.
   - `MINIFLUX_BASE_URL`: đổi sang `http://<ten-may-tailscale>:8080` nếu cần.
4. **Cập nhật container & nạp nguồn**:
   ```bash
   make up
   python3 scripts/import_sources.py
   python3 scripts/check_feeds.py
   ```
   - Nếu cần bỏ YouTube Shorts: thêm `--no-shorts`.
   - Tự bật lấy toàn văn (*Fetch original content*) cho blog chỉ có tóm tắt:
     ```bash
     python3 scripts/check_feeds.py --enable-crawler
     ```

---

## 3. Lệnh vận hành thường dùng

- Khởi động toàn bộ hệ thống: `make up`
- Dừng hệ thống: `make down`
- Xem trạng thái container: `make ps`
- Xem log: `make logs`
- Sao lưu Postgres (giữ 14 bản gần nhất): `make backup`
- Khôi phục Postgres từ bản sao lưu:
  ```bash
  make restore FILE=./backups/miniflux-YYYYMMDD-HHMMSS.sql.gz
  ```
- Xuất hàng loạt từ dòng lệnh:
  ```bash
  python3 scripts/export.py --folder Crypto --days 7
  python3 scripts/export.py --starred
  ```
- Chạy unit test cho `apify-bridge`: `make test`

---

## 4. Cập nhật phiên bản & tự khởi động

- **Cập nhật Miniflux / RSSHub / Postgres / Redis**:
  ```bash
  docker compose pull && docker compose up -d
  ```
- **Tự khởi động cùng máy**:
  - Toàn bộ container đã cấu hình `restart: unless-stopped`.
  - Trên macOS: bật *Docker Desktop → Settings → General → Start Docker Desktop when you sign in to your computer*.
  - Trên Linux: `sudo systemctl enable docker`.
- **Sao lưu tự động mỗi đêm (ví dụ 02:00 sáng bằng `crontab -e`)**:
  ```cron
  0 2 * * * cd "/Users/caoken/0. CODING/RSS Reader" && bash scripts/backup.sh >> backups/backup.log 2>&1
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
