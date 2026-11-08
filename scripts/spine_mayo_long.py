"""Resumable, bounded public Mayo pagination into preview-only D1 staging.

Staged replies never appear in forum lists. The worker atomically completes all
rows after it has verified every page and the reply hierarchy.
"""
import re
import time

from spine_sources import mayo_page_count, parse_mayoclinic_stage_page


def collect_mayo_long(identifier, url, payload, fetch, api, emit):
    page1 = fetch(url)
    page_count = mayo_page_count(page1, identifier)
    if not 1 <= page_count <= 400:
        raise ValueError("mayo_resource_page_limit")
    first = parse_mayoclinic_stage_page(page1, identifier, 1, page_count)
    api("/api/collect/long/start", {
        **payload, "title": first["title"], "body": first["body"],
        "source_lang": "en", "expected_pages": page_count,
    })
    progress = api("/api/collect/long/status", payload)
    if progress["expected_pages"] != page_count:
        raise ValueError("mayo_staging_count_mismatch")
    saved = {p["page_number"] for p in progress["pages"]}
    emit("mayo_resume", site="mayoclinic", source_id=identifier,
         total_pages=page_count, already_staged=len(saved),
         remaining=page_count - len(saved))
    for number in range(1, page_count + 1):
        if number in saved:
            continue
        if number == 1:
            page = first
        else:
            time.sleep(1)
            parsed = parse_mayoclinic_stage_page(fetch(f"{url}?pg={number}"),
                                               identifier, number, page_count)
            if parsed["title"] != first["title"] or parsed["body"] != first["body"]:
                raise ValueError("mayoclinic_cross_page_content_changed")
            page = parsed
        api("/api/collect/long/page", {
            **payload, "page_number": number, "comments": page["comments"],
        })
        emit("mayo_staged_page", site="mayoclinic", source_id=identifier,
             page=number, total_pages=page_count, replies=len(page["comments"]))
    result = None
    for attempt in range(2):
        try:
            result = api("/api/collect/long/finish", payload)
            break
        except Exception as error:
            if attempt or not (getattr(error, "status", None) in (0, 500, 502, 503, 504)):
                raise
            time.sleep(1)
    if result["status"] != "completed" or result.get("persisted_comments", 0) < 1:
        raise ValueError("mayo_staged_publish_unverified")
    count = result["persisted_comments"]
    emit("mayo_published", site="mayoclinic", source_id=identifier,
         total_pages=page_count, comments=count)
    return result, count, {
        "title": first["title"], "body": first["body"], "source_lang": "en",
    }


def verify_mayo_long(topic_id, draft, count, api):
    # Atomic publish guard already ensures every saved comment was inserted.
    # Read-back checks public topic identity and original title/body.
    if not re.fullmatch(r"[0-9a-f-]{36}", topic_id or "") or count < 1:
        return False
    record = api("/api/topics/" + topic_id)
    topic = record["topic"]
    return (topic.get("title") == draft["title"]
            and topic.get("body") == draft["body"]
            and topic.get("source_lang") == "en"
            and topic.get("nickname") in ("未知用户", "Unknown User"))
