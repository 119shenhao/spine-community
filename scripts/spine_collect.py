import argparse
import json
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import HTTPRedirectHandler, Request, build_opener

from bs4 import BeautifulSoup
from spine_sources import (
    ASK39_LISTS, SOURCE_URLS, read_topic, source_id, validate_topic,
)

PREVIEW = "https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev"
JSON_LIMIT = 150000
DEFAULT_TOPIC_LIMIT = 10
SKIP = {
    "mayoclinic": "public_thread_returned_403_use_authorized_export",
}


class FetchProblem(Exception):
    def __init__(self, reason, status=0):
        super().__init__(reason)
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


http = build_opener(NoRedirect())


def fetch(url, payload=None):
    headers = {"User-Agent": "SpineCommunityCollector/1.0"}
    if payload is not None:
        payload = json.dumps(payload, ensure_ascii=False).encode()
        if len(payload) > JSON_LIMIT:
            raise ValueError("payload_limit_exceeded")
        headers["Content-Type"] = "application/json"
    try:
        with http.open(Request(url, data=payload, headers=headers), timeout=20) as response:
            data = response.read(4_000_001)
            if len(data) > 4_000_000:
                raise FetchProblem("response_too_large")
            return data
    except HTTPError as error:
        raise FetchProblem(f"http_{error.code}", error.code) from None
    except (URLError, OSError):
        raise FetchProblem("network_error_or_timeout") from None


def api(path, payload=None):
    return json.loads(fetch(PREVIEW + path, payload))


def exclusions(site):
    cursor = None
    cursors = set()
    result = {}
    while True:
        params = {"site": site, "limit": 200}
        if cursor is not None:
            params["cursor"] = cursor
        page = api("/api/collect/exclusions?" + urlencode(params))
        if page["site"] != site:
            raise ValueError("exclusion_site_mismatch")
        result.update((row["source_id"], row["status"]) for row in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            return result
        if not isinstance(cursor, str) or not cursor or cursor in cursors:
            raise ValueError("invalid_exclusion_cursor")
        cursors.add(cursor)


def emit(event, **fields):
    print(json.dumps({"event": event, **fields}, ensure_ascii=False), flush=True)


def read_request(path):
    request = json.loads(path.read_text(encoding="utf-8"))
    required_fields = {"request_id", "mode", "sites", "candidates"}
    if not isinstance(request, dict) or set(request) - {"limit"} != required_fields:
        raise ValueError("invalid_request_fields")
    request.setdefault("limit", DEFAULT_TOPIC_LIMIT)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", request["request_id"]):
        raise ValueError("invalid_request_id")
    if request["mode"] not in ("inspect", "collect") or type(request["limit"]) is not int:
        raise ValueError("invalid_request_mode_or_limit")
    sites = request["sites"]
    if (not isinstance(sites, list) or not sites or len(sites) != len(set(sites))
            or any(site not in SOURCE_URLS for site in sites) or not 1 <= request["limit"] <= DEFAULT_TOPIC_LIMIT):
        raise ValueError("invalid_sites_or_limit")
    candidates = request["candidates"]
    if not isinstance(candidates, dict) or set(candidates) - set(sites):
        raise ValueError("invalid_candidate_sites")
    for site, urls in candidates.items():
        if not isinstance(urls, list) or len(urls) > (36 if site == "ask39" else 12):
            raise ValueError("invalid_candidate_count")
        candidates[site] = {source_id(site, url): url for url in urls}
    return request


def render_xywy(url, identifier):
    from playwright.sync_api import Error, sync_playwright

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page()
                response = page.goto(url, wait_until="commit", timeout=15_000)
                if not response or response.status != 200:
                    status = response.status if response else 0
                    raise FetchProblem(f"source_http_{status}", status)
                if source_id("xywy", response.url) != identifier:
                    raise FetchProblem("unexpected_source_redirect")
                page.wait_for_selector("h1", timeout=15_000)
                page.wait_for_selector(".ask-con", timeout=20_000)
                page.wait_for_timeout(3_000)
                return page.content()
            finally:
                browser.close()
    except Error:
        raise FetchProblem("public_reply_render_failed") from None


def verify(topic_id, draft, count):
    if not re.fullmatch(r"[0-9a-f-]{36}", topic_id or ""):
        return False
    result = api("/api/topics/" + topic_id)
    topic, rows = result["topic"], result["comments"]
    if (result["next"] is not None or len(rows) != count
            or topic.get("nickname") not in ("未知用户", "Unknown User")
            or any(topic.get(field) != draft[field] for field in ("title", "body", "source_lang"))):
        return False

    expected = []

    def flatten(comments, parent=None):
        for comment in comments:
            index = len(expected)
            expected.append((comment["body"], comment["source_lang"], parent))
            flatten(comment.get("replies", []), index)

    flatten(draft["comments"])
    order = {row["id"]: index for index, row in enumerate(rows)}
    return len(order) == count and all(
        row.get("nickname") in ("未知用户", "Unknown User")
        and (row["body"], row["source_lang"], order.get(row["parent_comment_id"], -1)
             if row["parent_comment_id"] is not None else None) == expected[index]
        for index, row in enumerate(rows)
    )


def inspect_ask39():
    for url in ASK39_LISTS:
        try:
            page = BeautifulSoup(fetch(url), "html.parser")
            links = set()
            for node in page.select("a[href]"):
                try:
                    links.add(source_id("ask39", urljoin(url, node["href"])))
                except ValueError:
                    continue
            emit("archive_list", site="ask39", url=url, question_links=len(links))
        except FetchProblem as error:
            emit("archive_list_unavailable", site="ask39", url=url, reason=str(error))
            if error.status in (401, 403, 429):
                break
        time.sleep(1)



def ask39_directory_candidates(excluded, maximum=36):
    ranked = {}
    for listing in ASK39_LISTS:
        try:
            page = BeautifulSoup(fetch(listing), "html.parser")
        except FetchProblem as error:
            emit("archive_list_unavailable", site="ask39", url=listing, reason=str(error))
            if error.status in (401, 403, 429):
                break
            continue
        for link in page.select("a[href]"):
            url = urljoin(listing, link["href"])
            try:
                identifier = source_id("ask39", url)
            except ValueError:
                continue
            if identifier in excluded:
                continue
            title = link.get("title") or link.get_text(" ", strip=True)
            priority = (12 * bool(re.search(r"术后|康复|手术后|复发|保守治疗", title))
                        + 8 * bool(re.search(r"我|妈妈|父亲|母亲|[0-9一二三四五六七八九十]+[年月周天岁]", title))
                        + min(len(title), 60))
            if identifier not in ranked or priority > ranked[identifier][0]:
                ranked[identifier] = (priority, url)
        time.sleep(1)
    selected = sorted(ranked.items(), key=lambda item: item[1][0], reverse=True)[:maximum]
    return {identifier: url for identifier, (_, url) in selected}


def complete(payload):
    for attempt in range(2):
        try:
            return api("/api/collect/complete", payload)
        except FetchProblem as error:
            if attempt or error.status not in (0, 500, 502, 503, 504):
                raise
            time.sleep(1)


def collect(site, candidates, limit, export_dir):
    granted = new_topics = new_replies = duplicates = unverified = 0
    expected_marks = set()
    ask39_bodies = set()
    stopped_reason = None
    for identifier, url in candidates.items():
        if new_topics >= limit:
            break
        response = api("/api/collect/claim", {
            "site": site, "collector_id": f"chatgpt-on-demand-{site}", "source_ids": [identifier],
        })
        lease, = response["results"]
        if lease["result"] != "granted":
            emit("claim_skipped", site=site, source_id=identifier, reason=lease["result"])
            continue
        granted += 1
        payload = {"site": site, "source_id": identifier, "lease_token": lease["lease_token"]}
        committed = False
        stage = "source"
        try:
            if export_dir:
                path = export_dir / site / f"{identifier}.json"
                if path.stat().st_size > JSON_LIMIT:
                    raise ValueError("export_too_large")
                draft = json.loads(path.read_text(encoding="utf-8"))
            else:
                draft = read_topic(site, identifier, url, fetch, render_xywy)
            count = validate_topic(draft)
            if site == "ask39" and not export_dir:
                body_key = re.sub(r"\s+", "", draft["body"])
                if body_key in ask39_bodies:
                    raise ValueError("repeated_patient_narrative_in_run")
                ask39_bodies.add(body_key)
            stage = "complete"
            result = complete({**payload, "topic": draft})
            committed = result["status"] == "completed"
            if not committed:
                raise ValueError("unexpected_complete_response")
            expected_marks.add(identifier)
            topic_id = result["topic_id"]
            if result.get("duplicate"):
                duplicates += 1
                emit("duplicate", site=site, source_id=identifier, url=url, topic_id=topic_id)
            else:
                stage = "readback"
                if ((not result.get("already_completed")
                     and result["imported"] != {"topics": 1, "comments": count})
                        or not verify(topic_id, draft, count)):
                    raise ValueError("forum_readback_mismatch")
                new_topics += 1
                new_replies += count
                emit("imported", site=site, source_id=identifier, url=url, topic_id=topic_id, replies=count)
        except (FetchProblem, ValueError, TypeError, KeyError, OSError) as error:
            reason = str(error) if isinstance(error, FetchProblem) else "incomplete_or_unverified_payload"
            if isinstance(error, ValueError) and re.fullmatch(r"[a-z_]{3,80}", str(error)):
                reason = str(error)
            if committed or stage == "complete":
                unverified += 1
            emit("candidate_skipped", site=site, source_id=identifier, url=url,
                 stage=stage, reason=reason, committed=committed)
            if isinstance(error, FetchProblem) and error.status in (401, 403, 429):
                stopped_reason = reason
        finally:
            if not committed:
                try:
                    api("/api/collect/release", payload)
                except (FetchProblem, ValueError):
                    emit("release_unconfirmed", site=site, source_id=identifier)
        if stopped_reason or unverified:
            break
        time.sleep(1)

    marks = exclusions(site) if expected_marks else {}
    mark_failures = sorted(key for key in expected_marks if marks.get(key) != "completed")
    emit("collection_summary", site=site, granted=granted, new_topics=new_topics, new_replies=new_replies,
         duplicates=duplicates, unverified=unverified, mark_failures=mark_failures, stopped_reason=stopped_reason)
    return not (unverified or mark_failures or stopped_reason)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("request", type=Path)
    parser.add_argument("--export-dir", type=Path)
    args = parser.parse_args()
    request = read_request(args.request)
    emit("request", request_id=request["request_id"], mode=request["mode"])
    ok = True
    for site in request["sites"]:
        try:
            excluded = exclusions(site)
            candidates = request["candidates"].get(site, {})
            if site == "mayoclinic" and args.export_dir and candidates:
                ids = json.loads((args.export_dir / "mayoclinic-ids.json").read_text(encoding="utf-8"))
                stable = {}
                for url in candidates.values():
                    identifier = ids[url]
                    if not isinstance(identifier, str) or not re.fullmatch(r"[0-9]{1,20}", identifier):
                        raise ValueError("missing_official_discussion_id")
                    stable[identifier] = url
                candidates = stable
            if site == "ask39" and request["mode"] == "collect" and not candidates and not args.export_dir:
                candidates = ask39_directory_candidates(excluded)
            eligible = {key: url for key, url in candidates.items() if key not in excluded}
            emit("plan", site=site, existing_exclusions=len(excluded), candidates=len(candidates),
                 excluded=len(candidates) - len(eligible), eligible=len(eligible))
            if site in SKIP and not args.export_dir:
                emit("source_unavailable", site=site, reason=SKIP[site])
            elif site == "ask39" and request["mode"] == "inspect":
                inspect_ask39()
            elif request["mode"] == "collect":
                ok = collect(site, eligible, request["limit"], args.export_dir) and ok
        except (FetchProblem, ValueError, TypeError, KeyError, OSError) as error:
            reason = str(error) if isinstance(error, FetchProblem) else "invalid_request_export_or_preview_response"
            emit("site_error", site=site, reason=reason)
            ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, TypeError, OSError):
        emit("invalid_request")
        raise SystemExit(2) from None
