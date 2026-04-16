# Measuring Latency on AWS: A Practical Guide

A reference for building enterprise software on AWS (EC2 + Aurora PostgreSQL) with latency in mind.

---

## Why Latency Matters

In 2006, ex-Amazon engineer Greg Linden revealed at a Stanford talk that Amazon's A/B tests found **every 100ms of added page load time cost roughly 1% in sales**. Other major players saw similar effects:

- **Google**: ~20% traffic loss from 500ms delay
- **Akamai**: ~7% conversion loss per 100ms
- **Bing**: 2-second slowdown → -4.3% revenue per user

This is still the most-cited benchmark in web performance, and it holds up. If you're charging actual money for software, latency is a revenue lever — not a nice-to-have.

---

## AWS Latency Baselines

Rough numbers to calibrate your expectations:

| Hop | Latency |
|-----|---------|
| EC2 ↔ EC2, same AZ (Nitro) | ~100 µs (sub-millisecond) |
| EC2 ↔ EC2, cross-AZ same region | ~1–2 ms |
| EC2 ↔ Aurora, same AZ | ~0.5 ms network RTT |
| Simple indexed SELECT on Aurora | 1–3 ms total |
| Aurora commit (write transaction) | ~3–6 ms |
| S3 first-byte, in-region | tens of ms |
| Cross-region (nearby, e.g. Frankfurt ↔ Ireland) | ~20–30 ms |
| Cross-region (distant, e.g. Ohio ↔ Tokyo) | 150–700+ ms |
| Public internet user → EC2 | +20–100+ ms depending on user location |

**AWS officially commits to "single-digit millisecond" cross-AZ latency.** Most AZ pairs actually measure sub-millisecond in practice. Notable exceptions: São Paulo, UAE, Tokyo, and Israel regions run higher than the rest.

---

## Tools for Measuring Latency

### 1. CloudWatch Metrics (built-in, always on)

Aurora publishes key latency metrics out of the box:

- `SelectLatency` — latency of SELECT queries
- `DMLLatency` — latency of inserts/updates/deletes
- `CommitLatency` — cumulative commit latency
- `ReadLatency` / `WriteLatency` — storage-level
- `NetworkReceiveThroughput` / `NetworkTransmitThroughput`

Set alarms on these. Don't wait for users to complain.

### 2. RDS Performance Insights (free tier included)

Shows database load broken down by:
- Top SQL queries
- Wait events (what the DB is stuck waiting on)
- User / host / application

Free tier: 7 days retention. Turn it on from day one — it's how you find the slow query that's killing you.

### 3. AWS X-Ray (distributed tracing)

The one that actually answers *"where is my latency going?"*

Instrument your app and you see:
```
User request → ALB → EC2 handler → Aurora query → external API → response
     |            |         |             |               |
    12ms        1ms       3ms          8ms            45ms  ← here's your problem
```

Without this, you're guessing.

### 4. Aurora-specific SQL functions

Direct from the database:

```sql
SELECT aurora_stat_get_db_commit_latency(oid)
FROM pg_database
WHERE datname = 'your_db';
```

Returns cumulative commit latency in microseconds. Good for ground-truth transaction timing.

### 5. Application-level instrumentation

Nothing beats measuring at the layer your users experience. Options:

- **Middleware timing** — wrap every handler and DB call
- **OpenTelemetry** — vendor-neutral, works with everything
- **Third-party APM** — Datadog, New Relic, Honeycomb, Sentry Performance

Even a basic `console.time()` / `time.perf_counter()` around DB calls beats nothing.

### 6. Network-level tools

- **VPC Reachability Analyzer** — verify paths and hops
- **CloudWatch Network Monitor** — continuous network latency checks
- **`ping` / `traceroute` from EC2** — old-school, still works

---

## Realistic Latency Targets

For a well-designed API on EC2 + Aurora:

- **Server-side, simple endpoint hitting DB once**: 10–25 ms is achievable, 30–50 ms is typical
- **Total response time (user → server → response)**: aim for under 200 ms for a good experience, under 100 ms for "feels instant"
- **Database query p99**: under 10 ms for indexed lookups; over 50 ms is a smell

If you're seeing 500ms+ for simple operations, something is wrong — almost always at the application layer, not AWS.

---

## Practical Advice for a Startup

### Architecture

1. **Put EC2 and Aurora in the same AZ for the primary path.** The cross-AZ latency difference (0.5ms vs 1–2ms) compounds when a request hits the DB 5–10 times. Use read replicas in other AZs for redundancy, not your primary DB path.
2. **Use connection pooling** (RDS Proxy or PgBouncer). Connection setup is ~5–10ms you don't need to pay per request.
3. **Put CloudFront in front of anything cacheable.** Static assets, public GETs — don't make them hit your origin.
4. **Use placement groups** if you need extreme low latency between specific EC2 instances (rarely needed outside HFT/gaming).

### Observability (do this before you have users, not after)

1. **Turn on Performance Insights on day one.** It's free.
2. **Instrument with X-Ray or an APM** from the first deploy.
3. **Set CloudWatch alarms on p99 latency**, not just averages. Averages lie; p99 is what your angriest users feel.
4. **Log slow queries** (`log_min_duration_statement = 100` in Aurora parameter group).
5. **Track latency in your app, not just at the edge.** You want to know which code path is slow, not just "the API is slow."

### Where latency actually comes from (in order)

Most latency problems aren't AWS. They're:

1. **N+1 queries** — hitting the DB in a loop instead of once
2. **Missing indexes** — sequential scans on big tables
3. **Serial calls that should be parallel** — awaiting API A, then B, then C instead of all three at once
4. **Cold Lambda starts** (if you use Lambda)
5. **Chatty ORMs** loading relations you don't need
6. **Unpooled connections**
7. **Then, finally, network**

X-Ray will expose all of these. Start there.

### Cost/latency tradeoffs worth knowing

- **Aurora I/O-Optimized** — pay more for compute, get free I/O; worth it if your I/O bill is >25% of Aurora cost
- **Graviton instances** (ARM) — often 20–40% cheaper with similar or better latency
- **Bigger instances** — sometimes fixes latency by giving you more network bandwidth and CPU headroom; measure before you assume

---

## TL;DR Checklist for Launch

- [ ] Performance Insights enabled on Aurora
- [ ] X-Ray or APM instrumenting every request
- [ ] CloudWatch alarms on `SelectLatency`, `CommitLatency`, p99 API latency
- [ ] Slow query logging on (threshold ~100ms)
- [ ] EC2 and Aurora primary in the same AZ
- [ ] Connection pooling (RDS Proxy or PgBouncer)
- [ ] CloudFront in front of static/cacheable content
- [ ] Know your p50, p95, p99 for every endpoint
