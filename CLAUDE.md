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
