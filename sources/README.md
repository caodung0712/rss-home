# Thư mục nguồn tin (`sources/`)

Đặt các file nguồn tin của bạn vào đây (không commit dữ liệu cá nhân nếu dùng repo công khai):

1. `inoreader.opml`: Xuất từ Inoreader (`Preferences → Import/Export → Export OPML`).
2. `social.csv`: Sao chép từ `social.csv.example` thành `social.csv` và điền danh sách Facebook Page, tài khoản X, kênh YouTube.

Sau khi có đủ file, chạy:
- `python3 scripts/import_sources.py` để đưa toàn bộ feed vào Miniflux.
- `python3 scripts/check_feeds.py` để kiểm tra feed lỗi.
