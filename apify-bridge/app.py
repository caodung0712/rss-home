"""Dịch vụ apify-bridge: đọc kết quả Apify Task có sẵn và xuất RSS 2.0 + /usage."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse

from bridge_core import (
    CACHE_TTL_SECONDS,
    DEFAULT_LOOKBACK_DAYS,
    TTLCache,
    build_rss_xml,
    deduplicate_and_filter_items,
    filter_recent_runs,
    parse_usage_payload,
)
from linkedin_rss import (
    LINKEDIN_HEADERS,
    _linkedin_feed_cache,
    _linkedin_post_cache,
    build_linkedin_rss_xml,
    extract_linkedin_articles_from_profile,
    extract_linkedin_post_urls,
    extract_linkedin_profile_title,
    extract_linkedin_slug,
    extract_name_from_google_rss,
    normalize_linkedin_url,
    parse_google_news_rss_items,
    parse_linkedin_post_html,
)
from social_free import (
    _facebook_feed_cache,
    _tiktok_stream_cache,
    fetch_facebook_archive,
    fetch_facebook_free_rss,
    fetch_tiktok_archive,
    resolve_tiktok_video_stream,
)
from social_metrics import (
    _single_metrics_cache,
    _tiktok_channel_metrics_cache,
    _youtube_channel_cache,
    collect_social_metrics_batch,
)
from web_free import (
    _web_feed_cache,
    build_web_rss_xml,
    fetch_sitemap_items,
    scrape_web_free,
)

APIFY_API_BASE = "https://api.apify.com/v2"

app = FastAPI(title="rss-home apify-bridge", version="1.0.0")
_dataset_cache = TTLCache(ttl_seconds=CACHE_TTL_SECONDS)
_usage_cache = TTLCache(ttl_seconds=CACHE_TTL_SECONDS)


def _get_apify_cache_seconds() -> int:
    raw = os.environ.get("APIFY_FB_CACHE_MINUTES", "180").strip()
    try:
        mins = max(10, min(1440, int(raw)))
        return mins * 60
    except ValueError:
        return 180 * 60


_apify_fb_page_cache = TTLCache(ttl_seconds=_get_apify_cache_seconds())


def _get_apify_token() -> str:
    return os.environ.get("APIFY_TOKEN", "").strip()


def _get_apify_actor_id() -> str:
    raw = os.environ.get("APIFY_FB_ACTOR_ID", "alfalfa~facebook-posts-scraper").strip()
    return raw.replace("/", "~") if "/" in raw else (raw or "alfalfa~facebook-posts-scraper")


def _get_apify_fallback_actor_id() -> str:
    raw = os.environ.get("APIFY_FB_FALLBACK_ACTOR_ID", "scraper_one~facebook-posts-scraper").strip()
    return raw.replace("/", "~") if "/" in raw else raw


def _build_apify_fb_payload(actor_id: str, page_url: str, limit: int, days: int) -> dict[str, Any]:
    if actor_id.startswith("scraper_one~"):
        since_date = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
        return {
            "pageUrls": [page_url],
            "resultsLimit": limit,
            "onlyPostsNewerThan": since_date,
        }
    return {
        "startUrls": [{"url": page_url}],
        "resultsLimit": limit,
        "onlyPostsNewerThan": f"{days} days",
    }


def normalize_apify_facebook_url(raw: str) -> str:
    val = (raw or "").strip()
    if not val:
        raise ValueError("Thiếu link hoặc tên Page Facebook.")
    if val.startswith("http://") or val.startswith("https://"):
        return val
    return f"https://www.facebook.com/{val.strip('/')}"


def _get_budget_usd() -> float:
    raw = os.environ.get("APIFY_MONTHLY_BUDGET_USD", "5").strip()
    try:
        return float(raw)
    except ValueError:
        return 5.0


async def _fetch_task_items(task_id: str, token: str) -> list[dict[str, Any]]:
    cached = _dataset_cache.get(f"items:{task_id}")
    if cached is not None:
        return cached

    headers = {"Authorization": f"Bearer {token}"}
    all_items: list[dict[str, Any]] = []

    async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
        runs_resp = await client.get(
            f"{APIFY_API_BASE}/actor-tasks/{task_id}/runs",
            params={"status": "SUCCEEDED", "desc": "1", "limit": "50"},
        )
        if runs_resp.status_code == 401:
            raise HTTPException(status_code=502, detail="APIFY_TOKEN không hợp lệ hoặc đã hết hạn.")
        if runs_resp.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Không tìm thấy Apify task {task_id}.")
        runs_resp.raise_for_status()

        payload = runs_resp.json()
        runs = (payload.get("data") or {}).get("items") or []
        recent_runs = filter_recent_runs(runs, lookback_days=DEFAULT_LOOKBACK_DAYS)

        for run in recent_runs:
            dataset_id = run.get("defaultDatasetId")
            if not dataset_id:
                continue
            ds_resp = await client.get(
                f"{APIFY_API_BASE}/datasets/{dataset_id}/items",
                params={"clean": "true", "format": "json"},
            )
            if ds_resp.status_code == 200:
                data = ds_resp.json()
                if isinstance(data, list):
                    all_items.extend(data)

    _dataset_cache.set(f"items:{task_id}", all_items)
    return all_items


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/cache/clear")
async def clear_cache() -> dict[str, Any]:
    cleared_datasets = _dataset_cache.clear()
    cleared_usage = _usage_cache.clear()
    cleared_apify_fb = _apify_fb_page_cache.clear()
    cleared_li = _linkedin_feed_cache.clear() + _linkedin_post_cache.clear()
    cleared_fb = _facebook_feed_cache.clear()
    cleared_tt = _tiktok_stream_cache.clear()
    cleared_web = _web_feed_cache.clear()
    cleared_metrics = (
        _tiktok_channel_metrics_cache.clear()
        + _single_metrics_cache.clear()
        + _youtube_channel_cache.clear()
    )
    return {
        "ok": True,
        "cleared": (
            cleared_datasets
            + cleared_usage
            + cleared_apify_fb
            + cleared_li
            + cleared_fb
            + cleared_tt
            + cleared_web
            + cleared_metrics
        ),
    }


async def _run_apify_fb_actor(
    actor_id: str,
    page_url: str,
    limit: int,
    days: int,
    token: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    payload = _build_apify_fb_payload(actor_id, page_url, limit, days)
    resp: httpx.Response | None = None
    last_exc: Exception | None = None

    async with httpx.AsyncClient(timeout=130.0) as client:
        for attempt in range(3):
            try:
                resp = await client.post(
                    f"{APIFY_API_BASE}/acts/{actor_id}/run-sync-get-dataset-items",
                    params={"clean": "true", "format": "json", "timeout": "110"},
                    headers={"Authorization": f"Bearer {token}"},
                    json=payload,
                )
                break
            except httpx.TimeoutException as exc:
                last_exc = exc
                if attempt < 2:
                    await asyncio.sleep(1.0)
                    continue
                raise HTTPException(
                    status_code=504,
                    detail="Apify chạy quá thời gian chờ (timeout), hãy thử giảm limit.",
                ) from exc
            except httpx.TransportError as exc:
                # Lần gọi đầu tiên trong container Docker đôi khi gặp lỗi DNS/kết nối tạm thời
                last_exc = exc
                if attempt < 2:
                    await asyncio.sleep(1.0)
                    continue
                raise HTTPException(
                    status_code=502,
                    detail=f"Không kết nối được tới Apify ({type(exc).__name__}): {exc}",
                ) from exc

    if resp is None:
        raise HTTPException(status_code=502, detail=f"Lỗi gọi Apify: {last_exc}")

    if resp.status_code == 401:
        raise HTTPException(status_code=502, detail="APIFY_TOKEN không hợp lệ hoặc đã hết hạn.")
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy Apify Actor '{actor_id}'.")
    if resp.status_code == 408:
        raise HTTPException(status_code=504, detail="Apify chạy quá thời gian chờ (timeout), hãy thử giảm limit.")
    if resp.status_code >= 400:
        detail_msg = resp.text[:300] if resp.text else f"HTTP {resp.status_code}"
        raise HTTPException(status_code=502, detail=f"Apify lỗi: {detail_msg}")

    raw_items = resp.json()
    if not isinstance(raw_items, list):
        return [], []

    error_items = [
        item for item in raw_items
        if isinstance(item, dict) and (item.get("error") or item.get("errorDescription"))
        and not (item.get("text") or item.get("postText") or item.get("postId"))
    ]
    valid_raw_items = [
        item for item in raw_items
        if isinstance(item, dict) and item not in error_items
    ]
    filtered = deduplicate_and_filter_items(valid_raw_items, match=None)
    return filtered, error_items


@app.get("/apify/facebook.xml")
async def apify_facebook_direct_rss(
    url: str = Query(..., description="Link Page Facebook cần cào bằng Apify"),
    limit: int = Query(default=15, ge=5, le=50),
    days: int = Query(default=14, ge=1, le=90),
    name: str | None = Query(default=None, description="Tên hiển thị Page"),
    actor: str | None = Query(default=None, description="Apify Actor ID tuỳ chọn"),
) -> Response:
    token = _get_apify_token()
    if not token:
        raise HTTPException(status_code=503, detail="Chưa cấu hình APIFY_TOKEN trong .env.")

    try:
        page_url = normalize_apify_facebook_url(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    primary_actor = _get_apify_actor_id()
    actor_override = (actor or "").strip().replace("/", "~")
    actor_id = actor_override or primary_actor
    cache_key = f"{actor_id}::{page_url}::{limit}::{days}"
    cached_xml = _apify_fb_page_cache.get(cache_key)
    if cached_xml is not None:
        return Response(
            content=cached_xml,
            media_type="application/rss+xml; charset=utf-8",
            headers={"X-Apify-Cache": "hit"},
        )

    used_actor = actor_id
    filtered, error_items = await _run_apify_fb_actor(actor_id, page_url, limit, days, token)

    fallback_actor = _get_apify_fallback_actor_id()
    if not filtered and not actor_override and fallback_actor and fallback_actor != actor_id:
        try:
            fb_filtered, fb_errors = await _run_apify_fb_actor(
                fallback_actor, page_url, limit, days, token
            )
            if fb_filtered:
                filtered = fb_filtered
                used_actor = fallback_actor
            elif fb_errors and not error_items:
                error_items = fb_errors
        except HTTPException:
            # Giữ lỗi/kết quả từ actor chính nếu actor dự phòng gặp sự cố tạm thời
            pass

    if not filtered and error_items:
        err_desc = str(error_items[0].get("errorDescription") or error_items[0].get("error") or "").strip()
        raise HTTPException(
            status_code=422,
            detail=(
                "Facebook chặn truy cập công khai hoặc đây là trang cá nhân không cho xem khi chưa đăng nhập"
                + (f" ({err_desc})" if err_desc else ".")
            ),
        )

    xml_text = build_rss_xml(filtered, task_id=used_actor, match=name or page_url)
    # Không cache kết quả rỗng (0 bài) để người dùng có thể thử lại hoặc kiểm tra ngay
    if filtered:
        _apify_fb_page_cache.set(cache_key, xml_text)
    return Response(
        content=xml_text,
        media_type="application/rss+xml; charset=utf-8",
        headers={"X-Apify-Cache": "miss", "X-Apify-Actor": used_actor},
    )


@app.get("/tiktok/video")
async def tiktok_video_stream(
    request: Request,
    url: str = Query(..., description="URL video TikTok cần phát"),
) -> Response:
    range_header = request.headers.get("range")

    async def open_upstream(force_refresh: bool):
        resolved = await resolve_tiktok_video_stream(url, force_refresh=force_refresh)
        req_headers = dict(resolved["headers"])
        if range_header:
            req_headers["Range"] = range_header
        client = httpx.AsyncClient(timeout=30.0, follow_redirects=True)
        req = client.build_request("GET", resolved["stream_url"], headers=req_headers)
        upstream = await client.send(req, stream=True)
        return client, upstream

    try:
        client, upstream = await open_upstream(force_refresh=False)
        if upstream.status_code in (401, 403):
            await upstream.aclose()
            await client.aclose()
            client, upstream = await open_upstream(force_refresh=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không tải được video TikTok: {exc}") from exc

    if upstream.status_code not in (200, 206):
        status = upstream.status_code
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"TikTok CDN trả HTTP {status}")

    pass_headers: dict[str, str] = {}
    for h_name in ("content-type", "content-length", "content-range", "accept-ranges"):
        if h_name in upstream.headers:
            pass_headers[h_name] = upstream.headers[h_name]
    if "content-type" not in pass_headers:
        pass_headers["content-type"] = "video/mp4"
    if "accept-ranges" not in pass_headers:
        pass_headers["accept-ranges"] = "bytes"

    async def body_iter():
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=65536):
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=pass_headers,
    )


@app.get("/tiktok/archive")
async def tiktok_archive(
    handle: str = Query(..., description="@handle hoặc link TikTok"),
    start: int = Query(default=1, ge=1),
    count: int = Query(default=25, ge=1, le=60),
) -> dict[str, Any]:
    try:
        return await fetch_tiktok_archive(handle=handle, start=start, count=count)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không tải thêm được TikTok: {exc}") from exc


@app.get("/facebook.xml")
async def facebook_free_rss(
    page: str = Query(..., description="Tên Page hoặc URL Facebook"),
    mode: str = Query(default="page", description="page | reels | photos"),
    name: str | None = Query(default=None, description="Tên hiển thị dự phòng"),
    limit: int = Query(default=20, ge=5, le=60),
) -> Response:
    try:
        xml_text, source = await fetch_facebook_free_rss(
            page=page, mode=mode, name=name, limit=limit
        )
        return Response(
            content=xml_text,
            media_type="application/rss+xml; charset=utf-8",
            headers={"X-Facebook-Source": source},
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/facebook/archive")
async def facebook_archive(
    page: str = Query(..., description="Tên Page hoặc URL Facebook"),
    mode: str = Query(default="page", description="page | reels | photos"),
    limit: int = Query(default=30, ge=10, le=100),
) -> dict[str, Any]:
    try:
        return await fetch_facebook_archive(page=page, mode=mode, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không tải thêm được Facebook: {exc}") from exc


@app.post("/social/metrics")
async def social_metrics_batch(request: Request) -> dict[str, Any]:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload JSON không hợp lệ.")
    items = payload.get("items")
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="Thiếu danh sách items.")
    force = bool(payload.get("force", False))
    metrics = await collect_social_metrics_batch(items, force=force)
    return {"metrics": {str(k): v for k, v in metrics.items()}}


@app.get("/web/sitemap/inspect")
async def web_sitemap_inspect(
    url: str = Query(..., description="URL website hoặc link sitemap.xml"),
    limit: int = Query(default=10, ge=1, le=50),
    match: str | None = Query(default=None, description="Lọc URL chứa chuỗi"),
    sitemap: str | None = Query(default=None, description="Link sitemap con cụ thể"),
    enrich: bool = Query(default=True, description="Lấy tiêu đề & ảnh từ từng trang"),
) -> dict[str, Any]:
    try:
        return await fetch_sitemap_items(
            url=url,
            limit=limit,
            match=match,
            sitemap_url=sitemap,
            enrich=enrich,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không đọc được sitemap: {exc}") from exc


@app.get("/web/sitemap.xml")
async def web_sitemap_rss(
    url: str = Query(..., description="URL website hoặc link sitemap.xml"),
    limit: int = Query(default=20, ge=5, le=50),
    match: str | None = Query(default=None, description="Lọc URL chứa chuỗi"),
    sitemap: str | None = Query(default=None, description="Link sitemap con cụ thể"),
    name: str | None = Query(default=None, description="Tên hiển thị của feed"),
) -> Response:
    cache_key = f"sitemap::{url.strip()}::{limit}::{match or ''}::{sitemap or ''}::{name or ''}"
    cached_xml = _web_feed_cache.get(cache_key)
    if cached_xml is not None:
        return Response(content=cached_xml, media_type="application/rss+xml; charset=utf-8")

    try:
        result = await fetch_sitemap_items(
            url=url,
            limit=limit,
            match=match,
            sitemap_url=sitemap,
            enrich=True,
        )
        feed_title = (name or "").strip() or result["feed_title"]
        xml_text = build_web_rss_xml(
            items=result["items"],
            feed_url=result["feed_url"],
            feed_title=feed_title,
            description=f"RSS tạo miễn phí từ sitemap: {result['sitemap_url']}",
        )
        _web_feed_cache.set(cache_key, xml_text)
        return Response(content=xml_text, media_type="application/rss+xml; charset=utf-8")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Lỗi tạo RSS từ sitemap: {exc}") from exc


@app.get("/web/scrape/preview")
async def web_scrape_preview(
    url: str = Query(..., description="URL trang web hoặc JSON API"),
    mode: str = Query(default="auto", description="auto | html | json"),
    selector: str = Query(default="", description="CSS selector cho mỗi item HTML"),
    json_path: str = Query(default="", description="Đường dẫn tới mảng item trong JSON"),
    title_key: str = Query(default="", description="Tên field tiêu đề trong JSON"),
    url_key: str = Query(default="", description="Tên field link trong JSON"),
    date_key: str = Query(default="", description="Tên field ngày đăng trong JSON"),
    image_key: str = Query(default="", description="Tên field ảnh trong JSON"),
    summary_key: str = Query(default="", description="Tên field mô tả trong JSON"),
    limit: int = Query(default=15, ge=1, le=50),
) -> dict[str, Any]:
    try:
        return await scrape_web_free(
            url=url,
            mode=mode,
            item_selector=selector,
            json_path=json_path,
            title_key=title_key,
            url_key=url_key,
            date_key=date_key,
            image_key=image_key,
            summary_key=summary_key,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Không cào được dữ liệu web: {exc}") from exc


@app.get("/web/scrape.xml")
async def web_scrape_rss(
    url: str = Query(..., description="URL trang web hoặc JSON API"),
    mode: str = Query(default="auto", description="auto | html | json"),
    selector: str = Query(default="", description="CSS selector cho mỗi item HTML"),
    json_path: str = Query(default="", description="Đường dẫn tới mảng item trong JSON"),
    title_key: str = Query(default="", description="Tên field tiêu đề trong JSON"),
    url_key: str = Query(default="", description="Tên field link trong JSON"),
    date_key: str = Query(default="", description="Tên field ngày đăng trong JSON"),
    image_key: str = Query(default="", description="Tên field ảnh trong JSON"),
    summary_key: str = Query(default="", description="Tên field mô tả trong JSON"),
    limit: int = Query(default=20, ge=5, le=50),
    name: str | None = Query(default=None, description="Tên hiển thị của feed"),
) -> Response:
    cache_key = (
        f"scrape::{url.strip()}::{mode}::{selector}::{json_path}::"
        f"{title_key}::{url_key}::{date_key}::{image_key}::{summary_key}::{limit}::{name or ''}"
    )
    cached_xml = _web_feed_cache.get(cache_key)
    if cached_xml is not None:
        return Response(content=cached_xml, media_type="application/rss+xml; charset=utf-8")

    try:
        result = await scrape_web_free(
            url=url,
            mode=mode,
            item_selector=selector,
            json_path=json_path,
            title_key=title_key,
            url_key=url_key,
            date_key=date_key,
            image_key=image_key,
            summary_key=summary_key,
            limit=limit,
        )
        feed_title = (name or "").strip() or result["feed_title"]
        xml_text = build_web_rss_xml(
            items=result["items"],
            feed_url=result["feed_url"],
            feed_title=feed_title,
            description=f"RSS tạo miễn phí từ scraper ({result['mode_used']}): {result['feed_url']}",
        )
        _web_feed_cache.set(cache_key, xml_text)
        return Response(content=xml_text, media_type="application/rss+xml; charset=utf-8")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Lỗi tạo RSS từ scraper: {exc}") from exc


@app.get("/linkedin.xml")
async def linkedin_rss(
    url: str = Query(..., description="URL trang cá nhân (/in/...) hoặc công ty (/company/...) trên LinkedIn"),
    name: str | None = Query(default=None, description="Tên hiển thị để dự phòng khi LinkedIn chặn guest"),
) -> Response:
    import urllib.parse

    try:
        profile_url = normalize_linkedin_url(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    cache_key = f"{profile_url}::{name or ''}"
    cached_xml = _linkedin_feed_cache.get(cache_key)
    if cached_xml is not None:
        return Response(content=cached_xml, media_type="application/rss+xml; charset=utf-8")

    slug = extract_linkedin_slug(profile_url)
    feed_title = (name or "").strip() or slug or "LinkedIn"
    posts: list[dict[str, Any]] = []
    seen_urls: set[str] = set()

    async with httpx.AsyncClient(
        timeout=20.0, headers=LINKEDIN_HEADERS, follow_redirects=True
    ) as client:
        try:
            prof_resp = await client.get(profile_url)
            if prof_resp.status_code == 200:
                prof_html = prof_resp.text
                feed_title = extract_linkedin_profile_title(prof_html, profile_url)
                post_urls = extract_linkedin_post_urls(prof_html, limit=12)

                for p_url in post_urls:
                    cached_post = _linkedin_post_cache.get(p_url)
                    if cached_post is not None:
                        posts.append(cached_post)
                        seen_urls.add(p_url)
                        continue
                    try:
                        p_resp = await client.get(p_url)
                        if p_resp.status_code == 200:
                            parsed_post = parse_linkedin_post_html(p_resp.text, p_url, feed_title)
                            if parsed_post:
                                _linkedin_post_cache.set(p_url, parsed_post)
                                posts.append(parsed_post)
                                seen_urls.add(p_url)
                    except httpx.HTTPError:
                        continue

                for art in extract_linkedin_articles_from_profile(prof_html, feed_title):
                    if art["url"] not in seen_urls:
                        posts.append(art)
                        seen_urls.add(art["url"])
        except httpx.HTTPError:
            pass

        # Dự phòng miễn phí qua Google News RSS nếu LinkedIn trả 999/chặn guest hoặc không có bài trực tiếp
        if not posts:
            resolved_name = (name or "").strip()
            if not resolved_name and slug:
                q1 = urllib.parse.urlencode(
                    {"q": f'site:linkedin.com "{slug}"', "hl": "en-US", "gl": "US", "ceid": "US:en"}
                )
                try:
                    g1 = await client.get(f"https://news.google.com/rss/search?{q1}")
                    if g1.status_code == 200:
                        resolved_name = extract_name_from_google_rss(g1.text) or ""
                except httpx.HTTPError:
                    pass

            if not resolved_name and slug:
                resolved_name = slug.replace("-", " ").strip()

            if resolved_name:
                feed_title = resolved_name
                is_company = "/company/" in profile_url
                queries = (
                    [f'site:linkedin.com/posts "{resolved_name}"', f'site:linkedin.com "{resolved_name}"']
                    if not is_company
                    else [f'site:linkedin.com/company/{slug}', f'site:linkedin.com/posts "{resolved_name}"']
                )
                for q_str in queries:
                    q2 = urllib.parse.urlencode(
                        {"q": q_str, "hl": "en-US", "gl": "US", "ceid": "US:en"}
                    )
                    try:
                        g2 = await client.get(f"https://news.google.com/rss/search?{q2}")
                        if g2.status_code == 200:
                            parsed_items = parse_google_news_rss_items(g2.text, resolved_name)
                            if parsed_items:
                                posts.extend(parsed_items[:30])
                                break
                    except httpx.HTTPError:
                        continue

    xml_text = build_linkedin_rss_xml(posts, profile_url=profile_url, feed_title=feed_title)
    _linkedin_feed_cache.set(cache_key, xml_text)
    return Response(content=xml_text, media_type="application/rss+xml; charset=utf-8")


@app.get("/task/{task_id}.xml")
async def task_rss(
    task_id: str,
    match: str | None = Query(default=None, description="Lọc theo tên page hoặc URL Facebook"),
) -> Response:
    token = _get_apify_token()
    if not token:
        raise HTTPException(status_code=503, detail="Chưa cấu hình APIFY_TOKEN trong .env.")

    raw_items = await _fetch_task_items(task_id, token)
    filtered = deduplicate_and_filter_items(raw_items, match=match)
    xml_text = build_rss_xml(filtered, task_id=task_id, match=match)
    return Response(content=xml_text, media_type="application/rss+xml; charset=utf-8")


@app.get("/usage")
async def usage() -> dict[str, Any]:
    budget = _get_budget_usd()
    token = _get_apify_token()
    if not token:
        return {
            "configured": False,
            "spend_usd": 0.0,
            "budget_usd": budget,
            "percent": 0.0,
            "warning_over_80": False,
            "message": "Chưa cấu hình APIFY_TOKEN",
        }

    cached = _usage_cache.get("usage")
    if cached is not None:
        return cached

    headers = {"Authorization": f"Bearer {token}"}
    monthly_json: dict[str, Any] | None = None
    limits_json: dict[str, Any] | None = None

    async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
        try:
            r1 = await client.get(f"{APIFY_API_BASE}/users/me/usage/monthly")
            if r1.status_code == 200:
                monthly_json = r1.json()
        except httpx.HTTPError:
            pass

        try:
            r2 = await client.get(f"{APIFY_API_BASE}/users/me/limits")
            if r2.status_code == 200:
                limits_json = r2.json()
        except httpx.HTTPError:
            pass

    if monthly_json is None and limits_json is None:
        return {
            "configured": True,
            "spend_usd": 0.0,
            "budget_usd": budget,
            "percent": 0.0,
            "warning_over_80": False,
            "error": "Không truy vấn được API usage từ Apify.",
        }

    result = parse_usage_payload(monthly_json, limits_json, budget_usd=budget)
    _usage_cache.set("usage", result)
    return result
