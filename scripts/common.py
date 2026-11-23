"""Tiện ích dùng chung cho các script quản trị rss-home."""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent


def load_env(env_path: Path | None = None) -> dict[str, str]:
    """Đọc các biến từ file .env (ưu tiên biến môi trường đang có)."""
    path = env_path or (ROOT_DIR / ".env")
    loaded: dict[str, str] = {}
    if path.exists():
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if (value.startswith('"') and value.endswith('"')) or (
                value.startswith("'") and value.endswith("'")
            ):
                value = value[1:-1]
            loaded[key] = value
    for key, val in loaded.items():
        os.environ.setdefault(key, val)
    return loaded


class MinifluxClient:
    """Client gọn nhẹ gọi Miniflux REST API bằng API key hoặc Basic Auth."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        username: str | None = None,
        password: str | None = None,
    ) -> None:
        load_env()
        self.base_url = (
            base_url
            or os.environ.get("MINIFLUX_INTERNAL_URL")
            or os.environ.get("MINIFLUX_BASE_URL")
            or "http://localhost:8080"
        ).rstrip("/")
        # Khi chạy script từ máy host, ưu tiên localhost nếu MINIFLUX_BASE_URL trỏ Tailscale chưa bật
        if "localhost" not in self.base_url and "127.0.0.1" not in self.base_url:
            if os.environ.get("MINIFLUX_USE_LOCALHOST", "1") == "1":
                self.base_url = "http://localhost:8080"

        self.api_key = (api_key or os.environ.get("MINIFLUX_API_KEY", "")).strip()
        self.username = (username or os.environ.get("MINIFLUX_ADMIN_USERNAME", "admin")).strip()
        self.password = (password or os.environ.get("MINIFLUX_ADMIN_PASSWORD", "")).strip()

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers: dict[str, str] = {"Accept": "application/json"}
        if self.api_key:
            headers["X-Auth-Token"] = self.api_key
        elif self.username and self.password:
            token = base64.b64encode(f"{self.username}:{self.password}".encode("utf-8")).decode("ascii")
            headers["Authorization"] = f"Basic {token}"
        else:
            raise RuntimeError(
                "Thiếu thông tin đăng nhập Miniflux: cần MINIFLUX_API_KEY hoặc MINIFLUX_ADMIN_PASSWORD trong .env."
            )
        if extra:
            headers.update(extra)
        return headers

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        content_type: str = "application/json",
        timeout: int = 30,
    ) -> Any:
        url = f"{self.base_url}{path}"
        data: bytes | None = None
        extra_headers: dict[str, str] = {}
        if body is not None:
            if isinstance(body, (bytes, bytearray)):
                data = bytes(body)
                extra_headers["Content-Type"] = content_type
            elif isinstance(body, str):
                data = body.encode("utf-8")
                extra_headers["Content-Type"] = content_type
            else:
                data = json.dumps(body).encode("utf-8")
                extra_headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, method=method.upper(), headers=self._headers(extra_headers))
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if not raw:
                    return None
                ctype = resp.headers.get("Content-Type", "")
                if "application/json" in ctype or raw.lstrip().startswith((b"{", b"[")):
                    return json.loads(raw.decode("utf-8"))
                return raw.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Lỗi API Miniflux {method} {path} -> HTTP {exc.code}: {err_body}") from exc

    def get_categories(self) -> list[dict[str, Any]]:
        return self.request("GET", "/v1/categories") or []

    def ensure_category(self, title: str) -> int:
        title_clean = title.strip()
        for cat in self.get_categories():
            if cat.get("title", "").strip().lower() == title_clean.lower():
                return int(cat["id"])
        created = self.request("POST", "/v1/categories", {"title": title_clean})
        return int(created["id"])

    def get_feeds(self) -> list[dict[str, Any]]:
        return self.request("GET", "/v1/feeds") or []

    def create_feed(self, feed_url: str, category_id: int, crawler: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {"feed_url": feed_url, "category_id": category_id}
        if crawler:
            payload["crawler"] = True
        return self.request("POST", "/v1/feeds", payload)

    def update_feed(self, feed_id: int, **fields: Any) -> dict[str, Any]:
        return self.request("PUT", f"/v1/feeds/{feed_id}", fields)

    def import_opml(self, opml_bytes: bytes) -> Any:
        return self.request("POST", "/v1/import", body=opml_bytes, content_type="application/xml", timeout=60)
