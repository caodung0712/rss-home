# Kế hoạch triển khai: Trình đọc RSS tự host thay Inoreader

> Phiên bản: 23/11/2026 · Chạy trên máy ở nhà · Triển khai bằng Claude Code · Chi phí mục tiêu: ~$0/tháng (chỉ tiền điện)

---

## 0. Tóm tắt

| Hạng mục | Lựa chọn |
|---|---|
| Nơi chạy | Máy ở nhà (Docker đã có sẵn) |
| Backend đọc feed | **Miniflux** + Postgres (lưu bài, polling, API đầy đủ) |
| Tạo feed cho trang không có RSS + X | **RSSHub** + Redis (tự host) |
| Facebook | **Apify Free** ($5/tháng miễn phí, không nhập thẻ) → **Apify bridge** (dịch vụ tự viết) |
| Giao diện | **Reader UI** tự viết giống Inoreader, gọi API của Miniflux |
| Copy / xuất hàng loạt | Nút copy trong UI + chọn nhiều bài → xuất ZIP (Markdown + ảnh + CSV) |
| Truy cập từ xa | Tailscale (khuyên dùng) hoặc Cloudflare Tunnel |

**Quy ước trong tài liệu:**
- 🧑 **BẠN LÀM**: việc cần bạn làm tay (tài khoản, mật khẩu, cookie, quyết định).
- 🤖 **CLAUDE CODE**: việc giao cho Claude Code.
- ✅ **Nghiệm thu**: điều kiện để coi một giai đoạn là xong.

---

## 1. Kiến trúc

```
                         ┌──────────────── Máy ở nhà (Docker Compose) ────────────────┐
Blog/Website ─RSS──────► │                                                             │
Google Alerts ─RSS─────► │   ┌──────────┐      ┌────────────┐      ┌───────────────┐   │
YouTube ─RSS chính chủ─► │   │ RSSHub   │─────►│  Miniflux  │◄────►│  Reader UI    │◄──┼── Trình duyệt / điện thoại
X.com ─────────────────► │   │ + Redis  │      │ + Postgres │ API  │ (giống        │   │   (qua Tailscale)
                         │   └──────────┘      └────────────┘      │  Inoreader)   │   │
Facebook Page ─► Apify ──┼─► ┌──────────────┐        ▲             └───────────────┘   │
 (chạy theo lịch,        │   │ Apify bridge │────────┘                                 │
  trên cloud Apify)      │   └──────────────┘                                          │
                         └─────────────────────────────────────────────────────────────┘
```

**Nguyên tắc:**
- Miniflux là nơi lưu trữ duy nhất. Mọi nguồn đều được đưa về dạng RSS rồi để Miniflux đọc.
- Reader UI chỉ là giao diện, không lưu dữ liệu riêng.
- Chỉ mở ra ngoài **Reader UI** (và Miniflux nếu muốn), và chỉ qua Tailscale. RSSHub và bridge chỉ dùng nội bộ.

---

## 2. Chuẩn bị TRƯỚC khi giao cho Claude Code

### 2.1 Checklist 🧑 BẠN LÀM (khoảng 1–2 giờ)

| # | Việc | Ghi chú |
|---|---|---|
| P1 | **Chọn máy chạy 24/7**, tắt chế độ ngủ (sleep/hibernate), đặt IP LAN cố định | Mini PC, laptop cũ hoặc Raspberry Pi 4/5 từ 4GB RAM là đủ. Máy tắt thì feed không cập nhật |
| P2 | Kiểm tra `docker compose version` (cần Compose v2) và ổ đĩa còn ≥ 20GB | |
| P3 | **Xuất OPML từ Inoreader** (Preferences → Import/Export → Export OPML) | Lưu thành `sources/inoreader.opml`. Giữ nguyên cấu trúc folder (Mind, News, Finance, Crypto, Marketing…) |
| P4 | **Lập danh sách nguồn mạng xã hội** vào `sources/social.csv` (mẫu ở Phụ lục B) | Mỗi trang Facebook / tài khoản X một dòng, kèm folder và mức ưu tiên |
| P5 | **Tạo tài khoản Apify Free**, KHÔNG nhập thẻ | Không có thẻ thì không thể bị trừ quá $5 |
| P6 | Tạo **Apify API token** (Settings → API & Integrations). Nên tạo token giới hạn quyền | Chỉ dán vào file `.env`, không dán vào chat |
| P7 | **Tạo tài khoản X phụ** (không dùng tài khoản chính), đăng nhập trên trình duyệt → F12 → Application → Cookies → copy giá trị `auth_token` | Tài khoản này có thể bị khóa. Khi đó lấy lại cookie hoặc tạo tài khoản khác |
| P8 | Cài **Tailscale** trên máy nhà + điện thoại + laptop (cùng một tài khoản) | Miễn phí, không cần tên miền hay mở port modem |
| P9 | Chọn **chỗ sao lưu** (ổ cứng ngoài, NAS hoặc thư mục Google Drive đã đồng bộ) | |
| P10 | Tạo thư mục dự án và file `.env` (mẫu ở Phụ lục C), tự điền mật khẩu và token | Claude Code đọc `.env` trên máy, bạn không cần gửi bí mật qua chat |
| P11 | Đặt file `CLAUDE.md` (Phụ lục A) vào thư mục gốc dự án, chạy `git init` | Giúp Claude Code giữ đúng phạm vi và quy ước của dự án |

### 2.2 Cấu trúc thư mục ban đầu

```
rss-home/
├── CLAUDE.md                 ← Phụ lục A
├── PLAN.md                   ← chính file này
├── .env                      ← Phụ lục C (đã điền, KHÔNG commit)
├── .gitignore                ← có .env, data/, exports/
└── sources/
    ├── inoreader.opml        ← P3
    └── social.csv            ← P4
```

### 2.3 Ngân sách Facebook (Apify Free)

- Dùng actor **`alfalfa/facebook-posts-scraper`**: $2 cho 1.000 bài ở gói Free, không phí khởi chạy, lọc theo ngày miễn phí.
- $5/tháng ≈ 2.500 bài. **Mục tiêu ≤ 2.000 bài/tháng (~66 bài/ngày)** để chừa chỗ dư.
- Bật `onlyPostsNewerThan` để chỉ trả tiền cho bài mới, nên chạy 1 hay 2 lần/ngày tốn gần như nhau.

| Trung bình mỗi trang đăng | Số trang theo dõi được |
|---|---|
| 1 bài/ngày | ~60 |
| 2–3 bài/ngày | ~25–30 |
| 5 bài/ngày (trang tin tức) | ~13 |

> Trang tin tức lớn có website riêng (CafeF, VnExpress, Tinhte…) thì **lấy RSS từ website**, đừng lấy qua Facebook, để dành ngân sách Apify cho các trang cá nhân/KOL chỉ đăng trên Facebook.

---

## 3. Các giai đoạn triển khai

Mỗi giai đoạn là một phiên làm việc với Claude Code. Làm xong và nghiệm thu giai đoạn trước rồi mới sang giai đoạn sau.

### Giai đoạn 1: Hệ thống lõi (Miniflux + Postgres + RSSHub + Redis)

🤖 **CLAUDE CODE**
- Viết `docker-compose.yml` gồm: `db` (postgres:17-alpine, có healthcheck), `miniflux`, `redis`, `rsshub`. Dữ liệu lưu ở `./data/`.
- Cấu hình Miniflux:
  - `FETCHER_ALLOW_PRIVATE_NETWORKS=1`: **bắt buộc**. Từ bản 2.2.18 Miniflux chặn feed trong mạng nội bộ, nếu thiếu thì không đọc được RSSHub và bridge.
  - `POLLING_FREQUENCY=30`, `MEDIA_PROXY_MODE=all` (ảnh FB/X hay chặn hiển thị ở trang khác).
  - `CLEANUP_ARCHIVE_READ_DAYS=-1`: không tự xoá bài đã đọc (cần để xuất về sau).
  - `CREATE_ADMIN=1`, lấy tài khoản admin từ `.env`.
- Chỉ mở cổng Miniflux (mặc định 8080). RSSHub và Redis không mở cổng ra ngoài.
- Viết `Makefile` hoặc script gồm: `up`, `down`, `logs`, `backup`, `restore`.

🧑 **BẠN LÀM**
- Chạy `docker compose up -d`, mở `http://<ip-máy>:8080`, đăng nhập.
- Trong Miniflux: **Settings → API Keys → tạo key**, dán vào `.env` (`MINIFLUX_API_KEY`). Reader UI ở giai đoạn 5 sẽ cần key này.

✅ **Nghiệm thu:** Miniflux đăng nhập được. `docker compose ps` báo tất cả container đều healthy hoặc đang chạy. Thêm thử feed `http://rsshub:1200/github/repos/miniflux` và feed có bài.

---

### Giai đoạn 2: Blog, website, Google Alerts, YouTube

🤖 **CLAUDE CODE**
- Import `sources/inoreader.opml` vào Miniflux qua API (`POST /v1/import`), giữ nguyên folder (Miniflux gọi là category).
- Viết script `scripts/check_feeds.py`: liệt kê feed lỗi sau lần quét đầu tiên. Feed nào hỏng thì đề xuất cách thay:
  - Feed RSS khác của cùng trang.
  - Route RSSHub tương ứng.
  - Feed Inoreader dạng "web feed" (tự tạo từ trang web) không mang sang được, cần thay bằng route RSSHub.
- Đổi feed YouTube về dạng `https://www.youtube.com/feeds/videos.xml?channel_id=UC...`. Nếu cần bỏ Shorts thì dùng `playlist_id=UULF...`.
- Với blog chỉ đăng tóm tắt trong RSS, bật **"Fetch original content"** (crawler) cho từng feed qua API.

🧑 **BẠN LÀM**
- Duyệt danh sách feed lỗi và quyết định giữ, thay hay bỏ.
- Lưu ý: feed Google Alerts ("GTM Engineer" – Google…) là RSS thật nên mang sang được bình thường.

✅ **Nghiệm thu:** ≥ 95% feed trong OPML có bài. Folder giống bên Inoreader.

---

### Giai đoạn 3: X.com qua RSSHub

🧑 **BẠN LÀM**
- Điền `TWITTER_AUTH_TOKEN` (cookie lấy ở bước P7) vào `.env`.

🤖 **CLAUDE CODE**
- Truyền biến `TWITTER_AUTH_TOKEN` vào container RSSHub và khởi động lại.
- Đọc cột `platform=x` trong `sources/social.csv`, tạo feed `http://rsshub:1200/twitter/user/<handle>` trong Miniflux, đúng folder.
- Thêm vào `check_feeds.py` một bước phát hiện cookie hết hạn (mọi feed X cùng lỗi) để báo rõ cho bạn.
- **Phương án dự phòng (chưa làm ngay):** nếu RSSHub với X không ổn định, dùng `fxtwitter.com/<handle>/feed.xml` (miễn phí, mỗi feed một tài khoản).

✅ **Nghiệm thu:** Mỗi tài khoản X trong danh sách có bài mới trong vòng 1 giờ.

---

### Giai đoạn 4: Facebook qua Apify + bridge

🧑 **BẠN LÀM** (trên giao diện web của Apify)
1. Mở actor `alfalfa/facebook-posts-scraper` → **Create task**.
2. `startUrls`: danh sách URL các trang Facebook trong `social.csv` (`platform=facebook`).
3. `onlyPostsNewerThan`: `2 days` (hoặc giá trị tương đương mà actor hỗ trợ). `resultsLimit`: khoảng 10 mỗi trang để tránh tốn tiền ở lần chạy đầu.
4. Bấm **Run** thử một lần và kiểm tra số tiền đã dùng (Billing).
5. Tạo **Schedule** chạy 1–2 lần/ngày cho task này.
6. Copy **Task ID** vào `.env` (`APIFY_FB_TASK_ID`).

🤖 **CLAUDE CODE**: viết dịch vụ `apify-bridge` (Python, chạy trong Docker, không mở cổng ra ngoài)
- `GET /task/<TASK_ID>.xml`: trả về RSS 2.0.
  - Lấy **tất cả lần chạy thành công trong 7 ngày gần nhất** (`GET /v2/actor-tasks/{id}/runs?status=SUCCEEDED&desc=1`), đọc dataset của từng lần, loại bài trùng theo `postId`/`url`. Làm vậy để máy nhà có tắt một thời gian thì vẫn không mất bài.
  - Tiêu đề: `Tên page: 90 ký tự đầu của bài`. Nội dung: toàn văn (giữ xuống dòng) + **tất cả ảnh** dạng `<img>` + link "Xem bài gốc".
  - `?match=<tên page>`: lọc bài theo trang, để **một task Apify tạo được nhiều feed** (mỗi page một feed riêng) mà không tốn thêm tiền.
  - Bỏ ảnh đại diện/avatar; giới hạn 20 ảnh mỗi bài.
  - Cache 10 phút. Token Apify chỉ nằm trong biến môi trường, không bao giờ xuất hiện trong URL feed.
- `GET /usage`: số tiền Apify đã dùng trong tháng, để Reader UI hiển thị và cảnh báo khi vượt 80% của $5.
- Viết test đơn vị với dữ liệu mẫu (bài có ảnh, không ảnh, video, bài chỉ có ảnh).
- Tạo feed trong Miniflux cho từng trang: `http://apify-bridge:8000/task/<ID>.xml?match=<page>`, đúng folder trong `social.csv`.

✅ **Nghiệm thu:** Mỗi trang Facebook là một feed riêng trong Miniflux, bài có đủ text và ảnh. Chi phí sau 3 ngày chạy thử, nhân lên một tháng, vẫn ≤ $4.

---

### Giai đoạn 5: Reader UI giống Inoreader (phần chính)

Giao diện mặc định của Miniflux gọn nhưng rất đơn giản. Phần này xây một web app riêng, nhìn và thao tác như Inoreader, lấy dữ liệu từ Miniflux API.

**Stack đề xuất:** Next.js (App Router) + TypeScript + Tailwind, chạy trong Docker. Gọi Miniflux **từ phía server** (route handler) để API key không lộ ra trình duyệt. Đăng nhập bằng một mật khẩu đặt trong `.env`.

#### 5.1 Bố cục (theo ảnh chụp Inoreader của bạn)

```
┌────┬──────────────────────┬──────────────────────────────────────────────────────┐
│ ☰  │ Feeds         ⚙ 📁   │ Newsfeed ▾  ⏷     [✓✓][▾] [Unread|All]  🔍  ▦  ⟳  ⋯   │
│ 🏠 │ ▣ Newsfeed     1000+ │ ┌──────────┐  Tiêu đề bài (đậm)                        │
│ 📥 │ G GTM Engineer     6 │ │  ảnh     │  Tên nguồn                                │
│ 🔖 │ ▾ Mind            46 │ │  thumb   │  Đoạn trích 2 dòng…                       │
│ 🔍 │    Nguyễn Hữu Trí 42 │ └──────────┘  13m                       🔖  ◉  ⋯      │
│ ＋ │ ▾ News           725 │ ┌──────────┐  …                                        │
│    │    Tinhte.vn     605 │ │          │                                           │
│ ⚙ │ ▾ Finance        842 │                                                        │
│ «  │ ▾ Crypto       1000+ │                                          ⌃  ⌄          │
└────┴──────────────────────┴──────────────────────────────────────────────────────┘
```

#### 5.2 Danh sách tính năng

**Bắt buộc (MVP)**

| # | Tính năng | Miniflux API dùng |
|---|---|---|
| U1 | Sidebar: Newsfeed (tất cả), folder thu gọn/mở rộng được, feed có icon + số chưa đọc (`1000+` khi > 999) | `GET /v1/categories?counts=true`, `GET /v1/feeds`, `GET /v1/feeds/counters`, `GET /v1/feeds/{id}/icon` |
| U2 | Danh sách bài dạng **thẻ (magazine)**: ảnh thumbnail (ảnh đầu tiên trong bài hoặc enclosure), tiêu đề, tên nguồn, trích 2 dòng, thời gian tương đối | `GET /v1/entries?status=&category_id=&feed_id=&order=published_at&direction=desc&limit=&offset=` |
| U3 | Nút chuyển **Unread / All articles**, cuộn vô hạn | như trên |
| U4 | **Đánh dấu đã đọc**: khi mở bài, khi cuộn qua (bật/tắt được), "Đánh dấu tất cả đã đọc" theo feed/folder, kèm menu "cũ hơn 1 ngày / 1 tuần" | `PUT /v1/entries`, `PUT /v1/categories/{id}/mark-all-as-read`, `PUT /v1/feeds/{id}/mark-all-as-read` |
| U5 | **Bookmark** (🔖), mục "Đã lưu" ở sidebar | `PUT /v1/entries/{id}/bookmark`, `starred=true` |
| U6 | **Màn hình đọc bài**: toàn văn + ảnh lớn, nút "Lấy toàn văn" cho bài bị cắt | `GET /v1/entries/{id}`, `GET /v1/entries/{id}/fetch-content` |
| U7 | **Copy nhanh**: "Copy text", "Copy Markdown", "Copy text + link", "Tải tất cả ảnh (ZIP)", bấm vào ảnh để copy ảnh | xử lý ở UI + route server tải ảnh |
| U8 | **Tìm kiếm** toàn văn, lọc theo folder/feed/khoảng ngày | `search=`, `after=`, `before=` |
| U9 | Nút làm mới (⟳): yêu cầu Miniflux quét lại feed | `PUT /v1/feeds/refresh` |
| U10 | Phím tắt kiểu Inoreader: `j/k` bài tiếp/trước, `m` đọc/chưa đọc, `s` bookmark, `v` mở bài gốc, `Shift+A` đọc hết | |
| U11 | Giao diện ổn trên điện thoại (sidebar thành ngăn kéo), chế độ sáng/tối | |

**Xuất hàng loạt (mục tiêu chính của bạn)**

| # | Tính năng |
|---|---|
| B1 | Chế độ **chọn nhiều bài** (checkbox ở từng thẻ, "chọn tất cả theo bộ lọc hiện tại") |
| B2 | **Xuất ZIP**: mỗi bài một file `.md` (frontmatter: tiêu đề, nguồn, link, ngày) + thư mục `images/` chứa ảnh **đã tải về** (link ảnh Facebook sẽ hết hạn) + `index.csv` tổng hợp |
| B3 | Xuất nhanh: "Copy tất cả bài đã chọn thành một khối Markdown" |
| B4 | Script dòng lệnh `scripts/export.py` làm việc giống B2 (lọc theo folder/feed/ngày/bookmark), để chạy theo lịch hoặc xuất số lượng rất lớn |

**Làm sau (không thuộc MVP)**
- Các kiểu hiển thị: Card / List gọn / Toàn văn (nút ▦).
- Quản lý feed ngay trong UI: thêm feed, đổi folder, sửa route RSSHub.
- Thẻ "Chi phí Apify tháng này" lấy từ `apify-bridge /usage`.
- Quy tắc lọc theo từ khoá (Miniflux có sẵn block/keep rules theo feed).

🤖 **CLAUDE CODE:** làm lần lượt **U1→U6 → U7 → B1–B2 → U8–U11 → B3–B4**, xong mỗi nhóm thì commit một lần.

🧑 **BẠN LÀM:** dùng thử sau mỗi nhóm và phản hồi về giao diện (khoảng cách, cỡ chữ, màu). Nên gửi ảnh chụp màn hình cho Claude Code để so với Inoreader.

✅ **Nghiệm thu:**
- Đọc được cả ngày trên laptop và điện thoại mà không cần mở giao diện Miniflux gốc.
- Chọn 20 bài Facebook có ảnh → xuất ZIP → mở được file Markdown và ảnh hiển thị đúng khi xem offline.

---

### Giai đoạn 6: Truy cập từ xa, sao lưu, vận hành

🧑 **BẠN LÀM**
- Bật Tailscale trên máy nhà. Truy cập Reader UI qua `http://<tên-máy>:<port>` từ điện thoại.
- (Tuỳ chọn) Nếu muốn có tên miền đẹp và HTTPS: tạo Cloudflare Tunnel + Cloudflare Access (cần tên miền quản lý trên Cloudflare).

🤖 **CLAUDE CODE**
- `scripts/backup.sh`: `pg_dump` mỗi đêm vào thư mục sao lưu (P9), giữ 14 bản.
- Cấu hình container tự khởi động lại khi máy khởi động (`restart: unless-stopped`) và hướng dẫn bật Docker chạy cùng hệ điều hành.
- Trang `/status` trong Reader UI: feed lỗi, cookie X hết hạn, chi phí Apify, thời điểm sao lưu gần nhất.
- Hướng dẫn cập nhật phiên bản: `docker compose pull && docker compose up -d`.

✅ **Nghiệm thu:** Khởi động lại máy → toàn bộ hệ thống tự chạy lại. Thử khôi phục từ bản sao lưu thành công.

---

## 4. Tổng hợp việc 🧑 BẠN PHẢI LÀM TAY

| Khi nào | Việc |
|---|---|
| Trước khi bắt đầu | P1–P11 ở mục 2.1 |
| Sau giai đoạn 1 | Tạo Miniflux API key, dán vào `.env` |
| Giai đoạn 2 | Duyệt danh sách feed lỗi |
| Giai đoạn 3 | Dán cookie `auth_token` của X; **lấy lại cookie khi bị hết hạn** (thường vài tuần đến vài tháng một lần) |
| Giai đoạn 4 | Tạo Apify Task + Schedule; chạy thử; theo dõi Billing tuần đầu |
| Giai đoạn 5 | Dùng thử và phản hồi giao diện |
| Giai đoạn 6 | Bật Tailscale; (tuỳ chọn) cấu hình Cloudflare |
| Định kỳ | Mỗi tháng xem chi phí Apify; thêm/bớt trang Facebook trong Task khi gần hết $5 |

**Những việc không giao cho AI:** nhập mật khẩu, lấy cookie, tạo token, thao tác thanh toán, quyết định bỏ nguồn nào.

---

## 5. Chi phí ước tính mỗi tháng

| Hạng mục | Chi phí |
|---|---|
| Máy nhà (mini PC ~10–15W chạy 24/7) | ~30–50 nghìn đồng tiền điện |
| Miniflux, RSSHub, Reader UI, Tailscale | $0 |
| Blog, Google Alerts, YouTube | $0 |
| X (RSSHub + cookie) | $0 |
| Facebook (Apify Free, ≤ $5 có sẵn) | $0 |
| **Tổng** | **≈ $0 + tiền điện** |

---

## 6. Rủi ro và cách xử lý

| Rủi ro | Dấu hiệu | Cách xử lý |
|---|---|---|
| Hết $5 Apify trước cuối tháng | `/usage` > 80% | Giảm `resultsLimit`, bớt trang đăng quá nhiều, chuyển trang có website sang RSS website; trang ít quan trọng dùng FetchRSS Free (5 feed, cập nhật 24 giờ/lần) |
| Scraper Facebook hỏng | Mọi feed FB không có bài mới | Chờ tác giả actor sửa (thường vài ngày) hoặc đổi sang actor khác; bridge đọc dữ liệu chung nên chỉ cần ánh xạ thêm tên trường |
| Cookie X hết hạn / tài khoản phụ bị khoá | Tất cả feed X lỗi cùng lúc | Lấy lại cookie; dự phòng bằng `fxtwitter.com/<handle>/feed.xml` |
| Máy nhà tắt lâu | Bị hụt bài | Bridge gộp kết quả 7 ngày; YouTube chỉ giữ 15 video mới nhất mỗi kênh |
| Link ảnh FB hết hạn | Ảnh bài cũ không hiện | Xuất ZIP tải ảnh về máy; cân nhắc thêm tuỳ chọn tự lưu ảnh của bài đã bookmark |
| Feed quá nhiều bài (Crypto Briefing, CafeF 1000+) | Danh sách bị ngập | Dùng block rules của Miniflux, hoặc tự động đánh dấu đã đọc bài cũ hơn N ngày |

---

## Phụ lục A: Nội dung `CLAUDE.md` đặt ở thư mục gốc dự án

```markdown
# Dự án: rss-home — trình đọc RSS tự host thay Inoreader

## Bối cảnh
- Chạy trên máy nhà bằng Docker Compose. Kế hoạch chi tiết: PLAN.md (làm theo đúng thứ tự giai đoạn).
- Thành phần: Miniflux (+Postgres), RSSHub (+Redis), apify-bridge (Python), reader-ui (Next.js + TS + Tailwind).
- Miniflux là nơi lưu trữ duy nhất; reader-ui chỉ gọi Miniflux API từ phía server.

## Quy tắc
- KHÔNG đọc ra, in ra hay commit giá trị trong .env. Chỉ tham chiếu tên biến.
- Không mở cổng ra ngoài cho rsshub, redis, apify-bridge, db.
- Miniflux phải có FETCHER_ALLOW_PRIVATE_NETWORKS=1.
- Không gọi Apify actor/run từ code (tránh tốn tiền); bridge chỉ ĐỌC kết quả run có sẵn.
- Mỗi giai đoạn: viết code → chạy thử bằng docker compose → kiểm tra theo mục "Nghiệm thu" trong PLAN.md → commit.
- Giao diện, thông báo và README viết bằng tiếng Việt; code và tên biến bằng tiếng Anh.
- Khi cần thao tác tay (tạo token, cookie, tài khoản), dừng lại và hỏi tôi.

## Lệnh thường dùng
- make up / make down / make logs / make backup
```

## Phụ lục B: Mẫu `sources/social.csv`

```csv
platform,url_or_handle,folder,name,priority
facebook,https://www.facebook.com/<ten-page>,Mind,Nguyễn Hữu Trí,high
facebook,https://www.facebook.com/<ten-page-2>,Crypto,5 Phút Crypto,normal
x,<handle-khong-co-@>,Crypto,<Tên hiển thị>,normal
youtube,https://www.youtube.com/@<handle>,Finance,<Tên kênh>,normal
```

- `priority=low` sẽ là trang đầu tiên bị bỏ ra khỏi Apify nếu sắp hết ngân sách.
- YouTube chỉ cần ghi @handle, Claude Code sẽ đổi sang `channel_id`.

## Phụ lục C: Mẫu `.env`

```dotenv
# Postgres / Miniflux
DB_PASSWORD=
MINIFLUX_ADMIN_USERNAME=admin
MINIFLUX_ADMIN_PASSWORD=
MINIFLUX_BASE_URL=http://<ten-may-tailscale>:8080
MINIFLUX_API_KEY=            # tạo sau giai đoạn 1

# RSSHub / X
TWITTER_AUTH_TOKEN=          # cookie auth_token của tài khoản X phụ

# Apify
APIFY_TOKEN=
APIFY_FB_TASK_ID=
APIFY_MONTHLY_BUDGET_USD=5

# Reader UI
READER_UI_PASSWORD=
READER_UI_PORT=3000

# Sao lưu
BACKUP_DIR=/duong/dan/o-cung-ngoai/rss-backup
```

## Phụ lục D: Câu lệnh mở đầu cho Claude Code

> Đọc `CLAUDE.md` và `PLAN.md`. Bắt đầu **Giai đoạn 1**. Trước khi viết code, liệt kê các file sẽ tạo và các biến `.env` sẽ dùng. Làm xong thì chạy `docker compose up -d`, kiểm tra theo mục "Nghiệm thu" và báo cho tôi những việc 🧑 tôi cần làm tiếp.

Các giai đoạn sau dùng câu lệnh tương tự: *"Bắt đầu Giai đoạn N theo PLAN.md"*.

---

## Nguồn tham khảo
- Miniflux 2.2.18 (chặn mạng nội bộ mặc định): https://miniflux.app/releases/2.2.18.html
- Miniflux cấu hình: https://miniflux.app/docs/configuration.html
- Apify pricing: https://apify.com/pricing
- Facebook Posts Scraper (Alfalfa): https://apify.com/alfalfa/facebook-posts-scraper
- Apify dataset API: https://docs.apify.com/api/v2/actor-task-run-sync-get-dataset-items-get
- RSSHub: https://github.com/diygod/rsshub
- X RSS sau Nitter: https://reduck.ai/use-cases/twitter-rss-feed
- YouTube RSS: https://hushread.com/blog/youtube-channel-rss-feed
