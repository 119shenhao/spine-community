# Spine Community — Repository agent instructions

When any AI agent or automation is asked to search, gather, ingest, or import threads from other sites (e.g. 百度贴吧, Reddit), **read these main-branch documents before searching any external website**:

1. [docs/ai-collector-sop.md](docs/ai-collector-sop.md) — required pre-search exclusion → candidate claim → authorized collection → atomic complete/release workflow.
2. [docs/collection-api.md](docs/collection-api.md) — request/response formats, preview-only keyless access, retry/error rules.
3. [docs/topic-dedup-and-sync.md](docs/topic-dedup-and-sync.md) — title/body fingerprint and developer-to-production one-time sync policy.

Use the development preview only, preserve original-language text and reply parentage, avoid reposting external users' material without permission or misleading people about its origin, and **do not write to production D1 without explicit authorization**.

Agents with no HTTP/network action capability must say so instead of claiming to have checked or imported content. The collector API needs no API key, but per-thread claim tokens should stay out of GitHub commits and public logs.

Only place documentation on `main`; code for the ongoing preview implementation currently lives on `feature/v1-community-build-20261106`.
