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
SKIP = {
    "ask39": "manual_review_required_for_patient_narrative_and_reply_completeness",
    "healthunlocked": "public_thread_returned_403_use_authorized_export",
    "mayoclinic": "site_terms_restrict_automated_access_use_authorized_export",
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
    if set(request) != {"request_id", "mode", "sites", "candidates", "limit"}:
        raise ValueError("invalid_request_fields")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", request["request_id"]):
        raise ValueError("invalid_request_id")
    if request["mode"] not in ("inspect", "collect") or type(request["limit"]) is not int:
        raise ValueError("invalid_request_mode_or_limit")
    sites = request["sites"]
    if (not isinstance(sites, list) or not sites or len(sites) != len(set(sites))
            or any(site not in SOURCE_URLS for site in sites) or not 1 <= request["limit"] <= 7):
        raise ValueError("invalid_sites_or_limit")
    candidates = request["candidates"]
    if not isinstance(candidates, dict) or set(candidates) - set(sites):
        raise ValueError("invalid_candidate_sites")
    for site, urls in candidates.items():
        if not isinstance(urls, list) or len(urls) > 12:
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



def probe_sources(site, excluded, candidates):
    from collections import Counter
    if site == "ask39":
        for listing in ASK39_LISTS:
            page = BeautifulSoup(fetch(listing), "html.parser")
            added = 0
            for link in page.select("a[href]"):
                url = urljoin(listing, link["href"])
                try:
                    identifier = source_id(site, url)
                except ValueError:
                    continue
                if identifier not in excluded and identifier not in candidates:
                    candidates[identifier] = url
                    added += 1
                    if added == 2:
                        break
            time.sleep(1)
    for identifier, url in candidates.items():
        if identifier in excluded:
            emit("probe_excluded", site=site, source_id=identifier)
            if site == "healthunlocked":
                try:
                    req = Request(url, method="HEAD", headers={"User-Agent": "SpineCommunityCollector/1.0"})
                    with http.open(req, timeout=20) as response:
                        emit("probe_access", site=site, status=response.status)
                except HTTPError as error:
                    emit("probe_access", site=site, status=error.code)
            continue
        response = api("/api/collect/claim", {
            "site": site, "collector_id": "chatgpt-source-layout-probe", "source_ids": [identifier],
        })
        lease, = response["results"]
        if lease["result"] != "granted":
            continue
        try:
            doc = BeautifulSoup(fetch(url), "html.parser")
            tags = Counter()
            for node in doc.select("[id], [class]"):
                for key in node.get("class", []) + ([node["id"]] if node.get("id") else []):
                    if re.fullmatch(r"[\w-]{1,70}", key) and re.search(r"post|content|detail|entry|ask|answer|reply|comment|page|question|problem|title|info|thread", key, re.I):
                        tags[(node.name, key)] += 1
            links = []
            for node in doc.select("link[href], a[href]"):
                href = node["href"]
                if re.search(r"[?&](?:p|pg|comment|post_id)=\d+|/comment/\d+|#comment-\d+", href):
                    if re.fullmatch(r"[A-Za-z0-9_:/?#&=.%+-]{1,300}", href):
                        links.append(href)
            containers = []
            for node in doc.select("h1,article, [class*=reply], [class*=answer], [class*=comment]"):
                parents = [x.name + "." + ".".join(x.get("class", [])) for x in list(node.parents)[:3]]
                shape = [node.name, node.get("id"), node.get("class"), len(node.get_text(strip=True)), parents,
                         sorted(k for k in node.attrs if k.startswith("data-"))]
                if shape[2] or shape[0] in ("h1", "article"):
                    containers.append(shape)
            emit("source_shape", site=site, source_id=identifier, counts=tags.most_common(55), links=list(dict.fromkeys(links))[:16],
                 containers=containers[:32], meta=[n.get("property") or n.get("name") for n in doc.select("meta")][:40],
                 scripts=[n.get("id") for n in doc.select("script[id]")][:12])
        except FetchProblem as error:
            emit("source_probe_error", site=site, source_id=identifier, reason=str(error))
            if error.status in (401, 403, 429):
                break
        finally:
            api("/api/collect/release", {"site":site, "source_id":identifier, "lease_token":lease["lease_token"]})
        time.sleep(1)


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
            eligible = {key: url for key, url in candidates.items() if key not in excluded}
            emit("plan", site=site, existing_exclusions=len(excluded), candidates=len(candidates),
                 excluded=len(candidates) - len(eligible), eligible=len(eligible))
            if request["request_id"] == "probe-expanded-sources-20261107":
                probe_sources(site, excluded, eligible)
                continue
            if site in SKIP and not args.export_dir:
                emit("source_unavailable", site=site, reason=SKIP[site])
                if site == "ask39" and request["mode"] == "inspect":
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
