# The Latency Obsession Playbook

_End-to-end guide to building a fast product on AWS (or anywhere). Written for a founder who wants to charge actual money and build something that feels instant._

---

## Executive Summary (The Short Version)

**Biggest culprits, ranked by how often they actually bite:** N+1 queries and missing indexes on the backend, oversized JS bundles and render-blocking resources on the frontend, no CDN and no caching on the network side. In practice most "slow app" problems aren't AWS — they're app-layer issues that tracing will expose in a week.

**Day 1 non-negotiables:** same-AZ EC2 + Aurora, connection pooling (RDS Proxy), CloudFront, Performance Insights on, distributed tracing (X-Ray or OpenTelemetry), RUM collecting real user data, CloudWatch alarms on **p95/p99** (not averages), Lighthouse CI blocking bad deploys, bundle size budget set.

**The cultural piece:** p99 is the product. Averages hide the users who churn. Gil Tene's core argument is that watching averages means you're measuring the good instead of the bad. Set SLOs with error budgets so perf doesn't always lose to features.

**Best resources to start with:**
- *High Performance Browser Networking* (Ilya Grigorik, free at hpbn.co) — the single best book on how the network actually works
- **web.dev** — Google's canonical frontend performance resource
- **The SRE book** (free at sre.google) — for the observability mindset
- **P99 CONF talks** on YouTube — for low-latency engineering culture
- **People worth following:** Gil Tene, Addy Osmani, Charity Majors, Brendan Gregg, Marc Brooker

---

## Why This Matters (One More Time)

- Amazon: **every 100ms of added latency = ~1% revenue loss** (Greg Linden, 2006)
- Google: 500ms extra = 20% traffic drop
- Bing: 2-second slowdown = -4.3% revenue per user
- Akamai: 7% conversion loss per 100ms

Fast isn't a polish item. It's a revenue lever, a retention lever, and a moat. Slow products lose silently — people just don't come back.

---

## Mental Model: The Full Request Path

Every user interaction traverses this chain. Each hop adds latency:

```
User device
  ↓ (DNS lookup, TCP handshake, TLS handshake)
CDN / Edge
  ↓ (miss → origin)
Load Balancer
  ↓
API server (EC2 / Lambda / container)
  ↓ (maybe: auth, validation, serialization)
Cache (Redis / ElastiCache)       ← hit? return
  ↓ (miss)
Database (Aurora PostgreSQL)
  ↓ (maybe: external API calls, third-party services)
Response serialized
  ↓
Back through LB → CDN → User
  ↓ (parse HTML, fetch JS/CSS/fonts/images, execute JS, render)
Pixel on screen
```

**Your latency budget** for a "feels instant" interaction is about **100–200ms total**. That's not much when you realize:
- TLS handshake alone: ~50–100ms cold
- Cross-continent RTT: 100–200ms
- JavaScript parse/execute: 50–500ms on a mid-range phone

This is why **minimizing hops and moving work closer to the user** is the whole game.

---

## The Biggest Culprits (Ranked by How Often They Bite)

Based on what actually slows real products down, in rough order of impact:

### Backend

1. **N+1 queries.** Fetching a list of 50 items, then issuing 50 more queries to get each item's relations. Single worst offender in any ORM-based app. Fix: eager loading, JOINs, or `IN` clauses. [Reference](https://www.zigpoll.com/content/can-you-explain-how-to-optimize-database-queries-to-improve-api-response-times-in-our-backend-service)
2. **Missing indexes.** A sequential scan on a million-row table is 1000× slower than an index lookup. Run `EXPLAIN ANALYZE` on your slowest queries.
3. **No caching.** Every request hits the DB. In-memory caches like Redis can be 100–1000× faster than DB reads for repeated queries.
4. **Serial waterfalls.** `await A(); await B(); await C();` when they could be `Promise.all([A, B, C])`. Adds up fast.
5. **No connection pooling.** Opening a fresh DB connection costs 5–10ms every time. Use RDS Proxy or PgBouncer.
6. **Unnecessary cross-AZ / cross-region hops.** Keep hot-path services in the same AZ.
7. **Cold starts** (if using Lambda). Provisioned concurrency or just use Fargate/EC2 for latency-sensitive paths.
8. **Chatty microservices.** Every service hop is a network roundtrip. Don't split services until you have a good reason.

### Frontend

9. **Oversized JavaScript bundles.** The #1 frontend killer. Every KB of JS has to be downloaded, parsed, AND executed. On a mid-range Android phone, 1MB of JS can take 3–5 seconds to become interactive.
10. **Render-blocking resources.** CSS and synchronous JS in `<head>` block the page from rendering. Inline critical CSS, defer the rest.
11. **Unoptimized images.** Serving 2MB hero images when a 150KB WebP would do. Use responsive images, modern formats (WebP/AVIF), and lazy loading below the fold.
12. **Font loading blocking text.** FOIT (flash of invisible text). Use `font-display: swap` and preload critical fonts.
13. **Third-party scripts.** Analytics, chat widgets, ad trackers, A/B test tools. Each one can add 100–500ms. Audit ruthlessly.
14. **Layout shift.** Content jumping around as stuff loads. Reserve space with explicit width/height on images and embeds.

### Network

15. **No CDN.** Serving static assets from your origin means every user pays the full distance tax. CDNs cut this to ~20ms.
16. **No HTTP/2 or HTTP/3.** Still running HTTP/1.1? You're serializing requests unnecessarily.
17. **Too many DNS lookups.** Every unique domain = fresh DNS + TCP + TLS handshake. Consolidate.
18. **Uncompressed responses.** Enable gzip or Brotli. Brotli compresses ~20% better than gzip for text.

---

## The Measurement Discipline (Do This First, Always)

> "You can't optimize what you don't measure." — every performance engineer ever

### Percentiles, not averages

Averages lie. If your p50 is 50ms but p99 is 2000ms, 1 in 100 of your requests is a disaster. That 1% is the user who tweets about you.

- **p50 (median)**: typical experience
- **p95**: what most users feel on a bad day
- **p99**: what your power users and biggest customers will notice
- **p99.9**: where rare-but-real distributed system issues show up

Latency expert Gil Tene (of "oh sh*t, how NOT to measure latency" fame) argues relentlessly that if you're only watching averages, you're "measuring the good rather than the bad." Ship your SLOs on p95 or p99, not p50.

Charity Majors puts it bluntly: alert on a few SLOs that reflect user pain, not hundreds of symptom checks.

### Real User Monitoring (RUM) vs Synthetic

- **Synthetic** (Lighthouse, WebPageTest, k6): controlled lab conditions, good for catching regressions in CI
- **RUM**: actual user data from production, includes real devices, networks, and edge cases

**You need both.** Synthetic for regression-catching, RUM for understanding what users actually experience.

### SLOs and Error Budgets

Borrowed from Google's SRE book:
- **SLI** (Indicator): the metric — e.g., "p95 API latency"
- **SLO** (Objective): the target — e.g., "p95 < 200ms over 30 days"
- **Error budget**: 100% - SLO = how much "bad" you tolerate

Error budgets force the conversation: if you've blown your latency budget this month, you pause feature work and fix perf. Without this, performance always loses to features.

---

## Core Web Vitals (Frontend's Canonical Metrics)

Google's three user-centric metrics — these are the ones that affect your SEO and your users' perception:

| Metric | What it measures | Target (p75) |
|---|---|---|
| **LCP** (Largest Contentful Paint) | When main content appears | < 2.5s |
| **INP** (Interaction to Next Paint) | How fast UI responds to clicks/taps | < 200ms |
| **CLS** (Cumulative Layout Shift) | Visual stability (jumping content) | < 0.1 |

INP replaced FID in March 2024. It's stricter and more representative of real interaction lag.

---

## Day 1 Action Plan

The non-negotiables. Do these before you onboard your first paying customer.

### Architecture
- [ ] EC2 and Aurora primary in the **same AZ** for the hot path
- [ ] **Connection pooling** enabled (RDS Proxy or PgBouncer)
- [ ] **CloudFront** in front of all static assets and cacheable API responses
- [ ] **Redis/ElastiCache** provisioned (even if you don't use it yet — you will)
- [ ] HTTP/2 or HTTP/3 enabled at the load balancer
- [ ] Brotli/gzip compression on

### Database
- [ ] **Performance Insights** enabled on Aurora (it's free)
- [ ] `pg_stat_statements` extension enabled to track query performance
- [ ] Slow query logging on (threshold 100ms)
- [ ] Indexes on every `WHERE`, `JOIN`, `ORDER BY` column used in hot queries
- [ ] No `SELECT *` — fetch only columns you need

### Observability (the big one)
- [ ] **Distributed tracing** in place (AWS X-Ray, OpenTelemetry, or Datadog/Honeycomb)
- [ ] **RUM** collecting from real users (Core Web Vitals + custom events)
- [ ] CloudWatch alarms on **p95/p99 latency** of each critical endpoint (not averages)
- [ ] Error budget defined for your top 3 user journeys
- [ ] Dashboard showing: p50/p95/p99 latency, error rate, throughput — per endpoint

### Frontend
- [ ] Bundle size budget set (e.g., <200KB JS gzipped for first load)
- [ ] Images in WebP/AVIF with `width`/`height` attributes set
- [ ] Critical CSS inlined, rest deferred
- [ ] Fonts preloaded, using `font-display: swap`
- [ ] Lighthouse CI in your pipeline — build fails if perf score drops
- [ ] Third-party scripts audited; each one justified

### Culture
- [ ] Performance regressions treated as bugs, not nice-to-haves
- [ ] p95 latency shown on a team dashboard everyone sees
- [ ] Every PR that touches hot path includes a latency impact note

---

## Ongoing Practices

- **Load test before launches.** Use k6, Gatling, or Locust. Validate p99 under 2–3× expected peak traffic.
- **Canary deploys.** Roll out to 5% of traffic, compare p99 to baseline, roll back if regressing.
- **Chaos engineering.** Inject latency and failures. Production will find edge cases you didn't — better if you find them first.
- **Regular query audits.** Once a month, pull top 20 slowest queries from Performance Insights and fix the top 3.
- **Bundle audits.** Use `webpack-bundle-analyzer` or equivalent quarterly. Dependencies bloat silently.
- **Third-party script review.** Anything added to the page should have an owner and a justification.

---

## The Best Resources (Worth Actually Reading)

### Books
- **High Performance Browser Networking** — Ilya Grigorik. Free online at hpbn.co. The single best book on how the network actually works. Read it.
- **Systems Performance** — Brendan Gregg. The bible for Linux/server-side performance.
- **Designing Data-Intensive Applications** — Martin Kleppmann. Understanding how your database actually behaves at scale.
- **Site Reliability Engineering (SRE Book)** — Google. Free online at sre.google/books. SLOs, error budgets, and the observability mindset.
- **Database Internals** — Alex Petrov. If you want to understand why some queries are slow at a mechanical level.

### Living Documents
- **web.dev** (developers.google.com/web) — Google's canonical resource on web performance. Start with their Core Web Vitals section.
- **AWS Well-Architected Framework — Performance Efficiency Pillar** — AWS's own playbook.
- **Google SRE Workbook** — practical exercises for SLOs and incident response.

### People to Follow
- **Gil Tene** — latency measurement, histograms, the tail
- **Brendan Gregg** — systems performance, flame graphs
- **Addy Osmani** — frontend performance at Google Chrome team
- **Barry Pollard** — Core Web Vitals, Google
- **Charity Majors** — observability, Honeycomb
- **Marc Brooker** — AWS Principal Engineer, blog has deep AWS internals
- **Jeremy Wagner** — web performance, web.dev
- **Tanner Linsley** — frontend performance, React Query author

### Talks to Watch
- Gil Tene — "How NOT to Measure Latency" (find it on YouTube; essential)
- Ilya Grigorik — any talk on networking
- Charity Majors on observability (multiple)
- P99 CONF talks (free, online) — curated low-latency engineering content

### Tools

**Frontend:**
- Lighthouse (Chrome DevTools, CI)
- WebPageTest (webpagetest.org) — most detailed synthetic tool
- PageSpeed Insights
- Chrome DevTools Performance tab
- CrUX (Chrome User Experience Report) — real-world data at scale

**Backend / Infra:**
- AWS X-Ray — distributed tracing
- CloudWatch + Performance Insights
- Datadog, New Relic, Honeycomb — full-stack APM (pick one)
- Sentry — error + performance (good startup pricing)
- Grafana + Prometheus + Loki + Tempo — self-hosted if budget-constrained
- pg_stat_statements, pgBadger — PostgreSQL query analysis

**Load testing:**
- k6 — modern, scriptable in JS
- Gatling — Scala-based, heavy-duty
- Locust — Python-based, easy to start

**RUM:**
- SpeedCurve
- Grafana Cloud RUM
- Datadog RUM
- Vercel Speed Insights (if you're on Vercel)
- Sentry Performance (bundled with error tracking)

---

## Latency Targets to Hold Yourself To

For a B2B SaaS product:

| Metric | Good | Great | World-class |
|---|---|---|---|
| API p50 | < 100ms | < 50ms | < 20ms |
| API p95 | < 300ms | < 150ms | < 75ms |
| API p99 | < 1s | < 500ms | < 200ms |
| LCP (p75) | < 2.5s | < 1.8s | < 1s |
| INP (p75) | < 200ms | < 100ms | < 50ms |
| CLS | < 0.1 | < 0.05 | ≈ 0 |
| Time to first byte | < 500ms | < 200ms | < 100ms |

"World-class" is hard and costs engineering time. "Great" is achievable for a disciplined startup. "Good" is the minimum bar; below this, you're leaving money on the table.

---

## Final Mental Models

1. **Latency is budget.** You have ~200ms total. Every hop spends it. Know your budget and where it goes.
2. **p99 is the product.** Your average user never sees p99. Your biggest, angriest, most vocal users do. Optimize for them.
3. **Measure in production.** Synthetic tests lie. RUM tells the truth.
4. **Observability before optimization.** You cannot fix what you cannot see. Instrument first, then tune.
5. **The network is the enemy.** Most "slow app" problems are really "too many roundtrips" problems. Batch, cache, co-locate.
6. **Performance is a feature.** Not a cleanup task. It competes for roadmap space and deserves to win.
7. **Fast products feel professional.** Your paying customers notice, even if they can't articulate it. It's why they stay.

---

## The One-Sentence Summary

**Instrument everything from day one, put your compute close to your data, your data close to your users, and treat p99 as a product requirement — not an engineering nice-to-have.**
