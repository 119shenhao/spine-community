# Spine Community — Draft Product Requirements (v0.1)

## Mission
Build an English-first, global, peer-to-peer discussion community focused exclusively on lived experiences with **neck/cervical spine** and **lower back/lumbar spine** conditions. The community does **not** diagnose conditions or endorse treatments.

## Audiences
- People experiencing symptoms and seeking peer experiences
- People sharing personal stories and their longer-term recovery journeys
- Caregivers and curious visitors (no proof of illness required)
- Moderators/admins who enforce safety and authenticity rules

## Primary navigation
1. Neck & Cervical Spine
2. Lower Back & Lumbar Spine
3. Patient Stories
4. Recovery Journals

A forum thread belongs to one primary category and gets one clearly labeled intent:
- My Experience
- Question / Seeking Experiences
- Recovery Update
- Caregiver Experience

These tags describe self-reported content, **not verified medical information**.

## Core MVP after scaffold
- Account registration/login (email verification and credential security), pseudonymous public handles
- Threads with plain-text content, comments and topic navigation
- Search/filter by condition, symptom, duration, treatment attempted, and self-reported outcome (optional, privacy-aware metadata)
- Recovery journals that can be updated over time
- Moderation: report, hide, remove, suspend, anti-spam, rate limits
- Profiles with granular privacy settings, deletion/export, clear retention policy
- SEO: safe public-thread pages, semantic metadata, robots/sitemap once published

## Scaffold stage (this commit)
- English responsive landing page with honest coming-soon status
- Workers code, optional D1 binding, initial SQL migrations
- Simple read-only health/categories/topics APIs
- No registration, posting, or live patient data collection
- No fabricated patient posts or medical claims

## Image uploads
- Design interface, access checks, and future private R2 integration in a later development phase
- Feature flag **OFF by default**; no public upload/read endpoint
- Even if UI is bypassed, Worker returns HTTP 403
- No public R2 domain; validate file types, size, quotas, moderation, and access controls before enabling
- Implement admin-only testing before public release

## Financial and security guardrails
- Prefer Workers Free + D1 Free during validation
- No paid auto-escalation, and no user-controlled unlimited expensive queries
- Use D1 indexes, pagination with hard limits, and caching where safe
- Turnstile, server-side rate limits, daily quotas, WAF as available, emergency write shutdown
- Cloudflare billing alerts **are not hard spending caps**
- Do not deploy R2 or other metered services before explicit review

## Trust, safety and privacy launch gate
- Clear peer-support disclaimer; content is not medical advice
- Content policies prohibit dangerous medical instructions, false cures, scams, and harassment
- Remove inadvertent identifying information; avoid requiring upload of medical records
- Allow pseudonymous discussion, reporting, and account/content deletion
- Plan legal privacy/terms documents, jurisdictional and age requirements before launching
- Moderation workflows and incident response must be operational before accepting users

## Technology
- GitHub private repository, main branch
- Cloudflare Workers + static assets in one project (not separate Pages)
- Cloudflare D1 as initial relational database; isolate persistence for later migration
- Cloudflare R2 only when image functionality is enabled and reviewed
- No external DB, VPS or local Java/Tomcat needed

## Milestones
1. **Scaffold** — public landing page, safe read-only API, database migrations
2. **Private testing** — D1 binding, test content, accounts/auth, posting/replies, moderation
3. **Core community** — journal entries, filters/search, security hardening
4. **Controlled launch** — SEO, public access, policies, backup/monitoring
5. **Optional images** — private R2 integration with admin-only gate and cost controls

Decisions not yet fixed: public brand/domain, detailed authentication provider, moderation staffing, privacy/retention policy, launch criteria, image quotas.
