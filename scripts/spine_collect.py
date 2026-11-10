import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from bs4 import BeautifulSoup
from spine_discover import PUBLIC_LISTS, discover_candidates
from spine_mayo_long import collect_mayo_long, verify_mayo_long
from spine_sources import (
    ASK39_LISTS, SOURCE_URLS, SPINE, ask39_has_ad, read_topic, source_id, validate_topic,
)

PREVIEW = "https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev"
JSON_LIMIT = 150000
DEFAULT_SITE_LIMIT = 2
MAX_SITE_LIMIT = 10
SKIP = {}


class FetchProblem(Exception):
    def __init__(self, reason, status=0):
        super().__init__(reason)
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


http = build_opener(NoRedirect())


def fetch(url, payload=None):
    headers = {"User-Agent": "SpineCommunityCollector/1.0", "Accept": "text/html,application/xhtml+xml,application/json"}
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
    request.setdefault("limit", DEFAULT_SITE_LIMIT)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", request["request_id"]):
        raise ValueError("invalid_request_id")
    if request["mode"] not in ("inspect", "collect", "discover") or type(request["limit"]) is not int:
        raise ValueError("invalid_request_mode_or_limit")
    sites = request["sites"]
    if not isinstance(sites, list) or not sites or any(not isinstance(site, str) for site in sites):
        raise ValueError("invalid_sites_or_limit")
    # "all" is resolved when the Action RUNS, using the current site registry.
    # New approved and fully implemented sources automatically join future runs
    # without changing this request template or the ChatGPT invocation phrase.
    if sites == ["all"]:
        if request["mode"] not in ("collect", "discover") or request["candidates"] != {}:
            raise ValueError("invalid_all_sites_request")
        sites = list(SOURCE_URLS)
    if (len(sites) != len(set(sites)) or any(site not in SOURCE_URLS for site in sites)
            or not 1 <= request["limit"] <= MAX_SITE_LIMIT):
        raise ValueError("invalid_sites_or_limit")
    request["sites"] = sites
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
        (row["body"], row["source_lang"], order.get(row["parent_comment_id"], -1)
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



def ask39_listing_candidates(listing, markup, excluded):
    """Only assess spine relevance and advertising in a question title."""
    page = BeautifulSoup(markup, "html.parser")
    found = {}
    for link in page.select(".question-ask-title a[href]"):
        url = urljoin(listing, link["href"])
        try:
            identifier = source_id("ask39", url)
        except ValueError:
            continue
        if identifier in excluded:
            continue
        title = (link.get("title") or link.get_text(" ", strip=True)).strip()
        # Per product rules, a short question title is acceptable. Only require
        # spine relevance and absence of advertising; check 24 patient chars
        # later against the full question body, never an adjacent doctor excerpt.
        if not SPINE.search(title) or ask39_has_ad(title):
            continue
        score = (24 * bool(re.search(r"术后|康复|复发|手术|复查|治疗|坐骨神经|腿麻", title))
                 + min(len(title), 100))
        found[identifier] = (score, url)
    return found


def ask39_directory_candidates(excluded, maximum=60):
    """Rank relevant ad-free question titles; validate patient body later."""
    ranked = {}
    listings = list(ASK39_LISTS)
    for category in (11760, 625):
        for page_number in (3, 4, 6, 8, 15, 20, 30):
            listings.append(f"https://ask.39.net/browse/{category}-1-{page_number}.html")
    for listing in listings:
        try:
            candidates = ask39_listing_candidates(listing, fetch(listing), excluded)
        except FetchProblem as error:
            emit("archive_list_unavailable", site="ask39", url=listing, reason=str(error))
            if error.status in (401, 403, 405, 429):
                break
            continue
        for identifier, item in candidates.items():
            if identifier not in ranked or item[0] > ranked[identifier][0]:
                ranked[identifier] = item
        time.sleep(1)
    ordered = sorted(ranked.items(), key=lambda item: (-item[1][0], item[0]))
    selected = {}
    checked = 0
    rejected = 0
    cooldown = 0
    # The old code took the top 60 BEFORE checking the D1 candidate queue.
    # When those 60 had all been rejected earlier, zero new posts could ever
    # be attempted even if hundreds of unchecked titles remained.
    for offset in range(0, len(ordered), 30):
        if len(selected) >= maximum:
            break
        chunk = ordered[offset:offset + 30]
        response = api("/api/collect/queue", {
            "site": "ask39", "action": "check",
            "items": [{"source_id": identifier} for identifier, _ in chunk],
        })
        if response.get("site") != "ask39" or response.get("status") != "checked":
            raise ValueError("invalid_candidate_precheck_response")
        blocked = {}
        requested = {identifier for identifier, _ in chunk}
        for item in response.get("excluded", []):
            identifier = item.get("source_id")
            status = item.get("status")
            if identifier not in requested or identifier in blocked or status not in (
                    "rejected", "completed", "retry", "processing"):
                raise ValueError("invalid_candidate_precheck_response")
            blocked[identifier] = status
        checked += len(chunk)
        rejected += sum(status in ("rejected", "completed") for status in blocked.values())
        cooldown += sum(status in ("retry", "processing") for status in blocked.values())
        for identifier, (_, url) in chunk:
            if identifier not in blocked and len(selected) < maximum:
                selected[identifier] = url
    emit("discovery_summary", site="ask39", unique_candidates=len(ranked),
         checked=checked, skipped_rejected=rejected, skipped_temporarily_unavailable=cooldown,
         selected=len(selected), strategy="queue_prechecked_spine_titles_then_body_validation")
    return selected


def read_120ask_links(markup, base_url, excluded):
    """Extract only genuine question links from public pages/search results."""
    page = BeautifulSoup(markup, "html.parser")
    found = {}
    for link in page.select("a[href]"):
        href = unquote(link["href"])
        url = urljoin(base_url, href)
        match = re.search(r"https?://www[.]120ask[.]com/question/[0-9]{1,20}[.]htm", href)
        if match:
            url = match.group(0)
        try:
            identifier = source_id("120ask", url)
        except ValueError:
            continue
        if identifier in excluded:
            continue
        title = link.get("title") or link.get_text(" ", strip=True)
        if not SPINE.search(title):
            continue
        priority = 20 * bool(re.search(r"术后|康复|复查|治疗|恢复|复发|手术", title))
        priority += min(len(title), 90)
        if identifier not in found or priority > found[identifier][0]:
            found[identifier] = (priority, url)
    return found


def discover_120ask(excluded, maximum=36):
    """Find authorized spine questions from results before claiming their bodies."""
    queries = (
        "site:www.120ask.com/question/ 腰椎 手术 康复",
        "site:www.120ask.com/question/ 颈椎 治疗 复查",
        "site:www.120ask.com/question/ 腰椎间盘突出 术后",
        "site:www.120ask.com/question/ 颈椎病 症状 恢复",
        "site:www.120ask.com/question/ 腰突 术后 腿麻",
        "site:www.120ask.com/question/ 椎管狭窄 术后",
    )
    ranked = {}
    # Official disease Q&A lists provide real stable question links and pagination.
    # Avoid relying on search engines which currently return no direct candidates.
    sources = []
    for disease in ("jingzhuibing", "yaozhuibing"):
        for page_no in (1, 2, 3, 5, 8, 12):
            base = f"https://www.120ask.com/list/{disease}/"
            sources.append(("official_disease", base if page_no == 1 else
                            f"https://www.120ask.com/list/{disease}/{page_no}/"))
    # Search is fallback only when official pages returned too few candidate IDs.
    search_urls = [("search_index", "https://www.bing.com/search?" +
                   urlencode({"q": query, "count": 30})) for query in queries]
    denied = set()
    for kind, url in sources:
        host = urlsplit(url).netloc
        if host in denied:
            continue
        try:
            candidates = read_120ask_links(fetch(url), url, excluded)
            for identifier, item in candidates.items():
                if identifier not in ranked or item[0] > ranked[identifier][0]:
                    ranked[identifier] = item
            emit("discovery_page", site="120ask", kind=kind, candidates=len(candidates))
        except FetchProblem as error:
            emit("discovery_unavailable", site="120ask", kind=kind, reason=str(error))
            if error.status in (401, 403, 405, 429):
                denied.add(host)
        time.sleep(1)
    if len(ranked) < 10:
        for kind, url in search_urls:
            try:
                for identifier, item in read_120ask_links(fetch(url), url, excluded).items():
                    if identifier not in ranked or item[0] > ranked[identifier][0]:
                        ranked[identifier] = item
            except FetchProblem as error:
                emit("discovery_unavailable", site="120ask", kind=kind, reason=str(error))
                if error.status in (401, 403, 405, 429):
                    break
            time.sleep(1)
    selected = sorted(ranked.items(), key=lambda item: (-item[1][0], item[0]))[:maximum]
    emit("discovery_summary", site="120ask", unique_candidates=len(ranked),
         selected=len(selected), strategy="official_spine_disease_questions")
    return {identifier: url for identifier, (_, url) in selected}


def complete(payload):
    for attempt in range(2):
        try:
            return api("/api/collect/complete", payload)
        except FetchProblem as error:
            if attempt or error.status not in (0, 500, 502, 503, 504):
                raise
            time.sleep(1)


def queue_mark(site, identifier, status, reason="processed"):
    api("/api/collect/queue", {"site": site, "action": "mark", "items": [
        {"source_id": identifier, "status": status, "reason": reason[:80]}
    ]})


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
            if lease["result"] == "completed" and not export_dir:
                queue_mark(site, identifier, "completed")
            emit("claim_skipped", site=site, source_id=identifier, reason=lease["result"])
            continue
        granted += 1
        payload = {"site": site, "source_id": identifier, "lease_token": lease["lease_token"]}
        committed = False
        stage = "source"
        try:
            if site == "mayoclinic" and not export_dir:
                result, count, draft = collect_mayo_long(identifier, url, payload, fetch, api, emit)
            else:
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
                        or not (verify_mayo_long(topic_id, draft, count, api) if site == "mayoclinic" and not export_dir else verify(topic_id, draft, count))):
                    raise ValueError("forum_readback_mismatch")
                new_topics += 1
                new_replies += count
                emit("imported", site=site, source_id=identifier, url=url, topic_id=topic_id, replies=count)
            queue_mark(site, identifier, "completed")
        except (FetchProblem, ValueError, TypeError, KeyError, OSError) as error:
            reason = str(error) if isinstance(error, FetchProblem) else "incomplete_or_unverified_payload"
            if isinstance(error, ValueError) and re.fullmatch(r"[a-z_]{3,80}", str(error)):
                reason = str(error)
            if committed or stage == "complete":
                unverified += 1
            emit("candidate_skipped", site=site, source_id=identifier, url=url,
                 stage=stage, reason=reason, committed=committed)
            if not committed:
                queue_mark(site, identifier, "retry" if isinstance(error, FetchProblem) and (error.status in (0, 408, 429) or error.status >= 500) else "rejected", reason)
            if isinstance(error, FetchProblem) and error.status in (401, 403, 405, 429):
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
    return not (unverified or mark_failures or stopped_reason), new_topics


REQUEST_ID = ""


def main():
    global REQUEST_ID
    parser = argparse.ArgumentParser()
    parser.add_argument("request", type=Path)
    parser.add_argument("--export-dir", type=Path)
    args = parser.parse_args()
    request = read_request(args.request)
    REQUEST_ID = request["request_id"]
    emit("request", request_id=request["request_id"], mode=request["mode"])
    ok = True
    total_new_topics = 0
    total_discovered = 0
    per_site_limit = request["limit"]
    requested_total = per_site_limit * len(request["sites"]) if request["mode"] == "collect" else 0
    site_results = []
    for site in request["sites"]:
        site_new = 0
        site_ok = True
        try:
            excluded = exclusions(site)
            candidates = request["candidates"].get(site, {})
            explicit_candidates = bool(candidates)
            if site == "mayoclinic" and args.export_dir and candidates:
                ids = json.loads((args.export_dir / "mayoclinic-ids.json").read_text(encoding="utf-8"))
                stable = {}
                for url in candidates.values():
                    identifier = ids[url]
                    if not isinstance(identifier, str) or not re.fullmatch(r"[0-9]{1,20}", identifier):
                        raise ValueError("missing_official_discussion_id")
                    stable[identifier] = url
                candidates = stable
            if request["mode"] == "collect" and not args.export_dir and not candidates:
                queued_first = api("/api/collect/queue?" + urlencode({"site": site}))["items"]
                if len(queued_first) >= 30:
                    candidates = {row["source_id"]: row["url"] for row in queued_first}
            if site == "120ask" and request["mode"] in ("collect", "discover") and not candidates and not args.export_dir:
                candidates = discover_120ask(excluded)
                total_discovered += len(candidates)
            if site == "ask39" and request["mode"] in ("collect", "discover") and not candidates and not args.export_dir:
                candidates = ask39_directory_candidates(excluded)
                total_discovered += len(candidates)
            if site in PUBLIC_LISTS and request["mode"] in ("collect", "discover") and not candidates and not args.export_dir:
                candidates = discover_candidates(site, excluded, fetch, emit)
                total_discovered += len(candidates)
            if request["mode"] in ("collect", "discover") and not args.export_dir:
                if candidates:
                    rows = list(candidates.items())
                    for start in range(0, len(rows), 30):
                        api("/api/collect/queue", {"site": site, "action": "enqueue", "items": [
                            {"source_id": key, "url": url} for key, url in rows[start:start+30]
                        ]})
                if site == "mayoclinic" and explicit_candidates and request["mode"] == "collect":
                    # Reopen only one-time legacy-size rejections explicitly selected
                    # for upgrade; never repeat failed modern validation indefinitely.
                    api("/api/collect/queue", {"site": site, "action": "reconsider",
                        "items": [{"source_id": key} for key in candidates]})
                queued = api("/api/collect/queue?"+urlencode({"site":site}))["items"]
                available = {row["source_id"]: row["url"] for row in queued}
                if explicit_candidates:
                    # An explicit test must not silently process unrelated queued topics.
                    # Respect failed-item cooldown; claim still enforces completed/claimed.
                    candidates = {key: url for key, url in candidates.items() if key in available}
                else:
                    # Prefer newly ranked discoverable questions to an older
                    # backlog, while still retaining all eligible queued IDs.
                    candidates = {key: available[key] for key in candidates if key in available}
                    candidates.update((key, url) for key, url in available.items() if key not in candidates)
            if request["mode"] in ("collect", "discover") and not args.export_dir:
                already_done = [key for key in candidates if excluded.get(key) == "completed"]
                for key in already_done:
                    queue_mark(site, key, "completed")
            eligible = {key: url for key, url in candidates.items() if key not in excluded}
            emit("plan", site=site, existing_exclusions=len(excluded), candidates=len(candidates),
                 excluded=len(candidates) - len(eligible), eligible=len(eligible))
            if site in SKIP and request["mode"] == "collect" and not args.export_dir:
                emit("source_unavailable", site=site, reason=SKIP[site])
            elif request["mode"] == "discover":
                emit("discovery_queued", site=site, queued_available=len(eligible))
            elif site == "ask39" and request["mode"] == "inspect":
                inspect_ask39()
            elif request["mode"] == "collect":
                # Each registered site has an independent quota. A previous
                # site's success must never prevent later sites from running.
                site_ok, site_new = collect(site, eligible, per_site_limit, args.export_dir)
                total_new_topics += site_new
                ok = site_ok and ok
                emit("site_target", site=site, requested=per_site_limit,
                     new_topics=site_new, target_met=site_new >= per_site_limit)
            if request["mode"] == "collect":
                site_results.append({"site": site, "requested": per_site_limit,
                                     "new_topics": site_new,
                                     "target_met": site_new >= per_site_limit,
                                     "ok": site_ok})
        except (FetchProblem, ValueError, TypeError, KeyError, OSError) as error:
            reason = str(error) if isinstance(error, FetchProblem) else "invalid_request_export_or_preview_response"
            emit("site_error", site=site, reason=reason)
            if request["mode"] == "collect":
                site_results.append({"site": site, "requested": per_site_limit,
                                     "new_topics": site_new, "target_met": False,
                                     "ok": False, "error": reason})
            ok = False
    if request["mode"] == "collect" and total_new_topics == 0:
        emit("target_not_met", reason="zero_new_topics", new_topics=0)
        return 1
    emit("run_summary", new_topics=total_new_topics, discovered_candidates=total_discovered,
         per_site_limit=per_site_limit, requested_target=requested_total,
         target_met=(all(r["target_met"] for r in site_results) if request["mode"] == "collect" else None),
         partial_success=(0 < total_new_topics < requested_total if request["mode"] == "collect" else None),
         site_results=site_results if request["mode"] == "collect" else None)
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, TypeError, OSError):
        emit("invalid_request")
        raise SystemExit(2) from None
