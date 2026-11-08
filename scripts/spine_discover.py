"""Discover public source URLs only. Never scrape thread bodies or bypass access controls.

All accepted URLs pass spine_sources.source_id; fetched site lists are metadata-only.
"""
import re
import time
from urllib.parse import urljoin, urlencode, urlsplit, unquote

from bs4 import BeautifulSoup

from spine_sources import SOURCE_URLS, SPINE, source_id

# Official public landing pages. Use fixed, narrowly scoped pages to avoid open crawling.
PUBLIC_LISTS = {
    "patientinfo": (
        "https://community.patient.info/tag/spinal-problems/369",
        "https://community.patient.info/c/bones-joints-and-muscles/2",
    ),
    "healthunlocked": (
        "https://healthunlocked.com/painconcern",
        "https://healthunlocked.com/fibromyalgia-action-uk",
    ),
    "xywy": (
        "https://club.xywy.com/",
    ),
    "mayoclinic": (
        "https://connect.mayoclinic.org/group/spine-health/?index=discussions",
    ),
}

# Search result metadata is a fallback, not evidence that a whole thread can be imported.
SEARCH_TERMS = {
    "patientinfo": (
        'site:patient.info/forums/discuss/ lumbar surgery recovery',
        'site:patient.info/forums/discuss/ sciatica spinal stenosis',
    ),
    "healthunlocked": (
        'site:healthunlocked.com/ "posts" sciatica',
        'site:healthunlocked.com/ "posts" spinal stenosis',
    ),
    "xywy": (
        'site:club.xywy.com/wenda/ 腰椎 术后 康复',
        'site:club.xywy.com/wenda/ 颈椎 腰痛',
    ),
    "mayoclinic": (),
}

PREFERRED = re.compile(
    r"术后|康复|复发|手术|治疗|症状|疼痛|患者|"
    r"after|recover|recovery|surgery|fusion|stenosis|sciatica|"
    r"laminectomy|microdiscectomy|pain|experience|rehab", re.I
)
ENGLISH_SPINE = re.compile(
    r"backache|back pain|neck pain|spinal|lumbar|cervical|sciatica|"
    r"herniated|disc|disk|stenosis|fusion|laminectomy|L[1-5]|S1", re.I
)


def candidate_links(site, listing, markup, excluded):
    """Extract, rank and dedupe direct on-site discussion URLs from a public listing."""
    page = BeautifulSoup(markup, "html.parser")
    found = {}
    for link in page.select("a[href]"):
        url = urljoin(listing, link["href"])
        if urlsplit(listing).hostname == "www.bing.com":
            # Search engines sometimes wrap an on-site URL in a query parameter.
            decoded = unquote(url)
            pattern = r"https://(?:community[.]patient[.]info/t/|patient[.]info/forums/discuss/|healthunlocked[.]com/|club[.]xywy[.]com/wenda/|connect[.]mayoclinic[.]org/discussion/)[^&#\s\"'<>]+"
            match = re.search(pattern, decoded)
            if match:
                url = match.group(0)
        try:
            identifier = source_id(site, url)
        except ValueError:
            continue
        if identifier in excluded:
            continue
        title = link.get("title") or link.get_text(" ", strip=True)
        relevant = bool(SPINE.search(title) or ENGLISH_SPINE.search(title))
        # The Patient.info tag list is already limited to 'spinal problems'.
        if not relevant and not (site == "patientinfo" and "/tag/spinal-problems/" in listing):
            continue
        score = 10 * relevant + 8 * bool(PREFERRED.search(title)) + min(len(title), 100) / 100
        if identifier not in found or found[identifier][0] < score:
            found[identifier] = (score, url)
    return found


def discover_candidates(site, excluded, fetch, emit, maximum=48):
    if site not in PUBLIC_LISTS:
        raise ValueError("unsupported_source_discovery")
    found = {}
    failures = []
    pages = [("site_listing", url) for url in PUBLIC_LISTS[site]]
    pages += [("search_index", "https://www.bing.com/search?" +
               urlencode({"q": q, "count": 30})) for q in SEARCH_TERMS[site]]
    blocked_hosts = set()
    for kind, url in pages:
        hostname = urlsplit(url).hostname
        if hostname in blocked_hosts:
            emit("discovery_skipped", site=site, reason="origin_rejected_access", kind=kind)
            continue
        try:
            candidates = candidate_links(site, url, fetch(url), excluded)
            for identifier, (score, origin) in candidates.items():
                if identifier not in found or found[identifier][0] < score:
                    found[identifier] = (score, origin)
            emit("discovery_page", site=site, kind=kind, candidates=len(candidates))
        except Exception as error:
            # Import code defines FetchProblem; retain its reason without exposing markup.
            if not (error.__class__.__name__ == "FetchProblem"):
                raise
            reason = str(error)
            failures.append(reason)
            emit("discovery_unavailable", site=site, kind=kind, reason=reason)
            if getattr(error, "status", 0) in (401, 403, 405, 429):
                # Don't request another page from a host that explicitly refused access.
                blocked_hosts.add(hostname)
        time.sleep(1)
    ordered = sorted(found.items(), key=lambda item: (-item[1][0], item[0]))
    selected = {identifier: url for identifier, (_, url) in ordered[:maximum]}
    emit("discovery_summary", site=site, unique_candidates=len(found),
         selected=len(selected), blocked=bool(failures and not selected),
         unavailable_reasons=sorted(set(failures)))
    return selected
