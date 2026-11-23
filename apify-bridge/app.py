"""Dịch vụ apify-bridge: đọc kết quả Apify Task có sẵn và xuất RSS 2.0 + /usage."""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Response

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

APIFY_API_BASE = "https://api.apify.com/v2"

app = FastAPI(title="rss-home apify-bridge", version="1.0.0")
_dataset_cache = TTLCache(ttl_seconds=CACHE_TTL_SECONDS)
_usage_cache = TTLCache(ttl_seconds=CACHE_TTL_SECONDS)


def _get_apify_token() -> str:
    return os.environ.get("APIFY_TOKEN", "").strip()


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
    cleared_li = _linkedin_feed_cache.clear() + _linkedin_post_cache.clear()
    return {"ok": True, "cleared": cleared_datasets + cleared_usage + cleared_li}


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
