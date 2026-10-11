# Performance

## Method

`npm run perf -w @sat/api` seeds an isolated in-memory replica set with **1 organization, 30 courses, 1,500 students (4 courses each), 240 published assignments and about 27,000 submissions with versions and published grades**, then measures each operation 30 times after a warm-up over real HTTP, through the full middleware stack (authentication, session check, tenant check, validation). The script exits non-zero if any p95 exceeds its budget.

## Results (2026-10-11, Windows 11 laptop, Node 26, MongoDB 8.2 in-memory)

| Operation                                                | p50 ms | p95 ms | Budget (p95) |
| -------------------------------------------------------- | -----: | -----: | -----------: |
| Login (Argon2id verify + session)                        |     46 |     51 |          250 |
| Student dashboard                                        |     16 |     21 |          300 |
| Student assignment list                                  |     16 |     19 |          300 |
| Teacher dashboard                                        |     15 |     20 |          400 |
| Course roster, first page                                |     15 |     18 |          150 |
| Submission inbox, filtered                               |     17 |     30 |          400 |
| Grading: save draft                                      |     16 |     21 |          150 |
| Assignment statistics                                    |     16 |     17 |          250 |
| Course report (8 assignments × ~200 students)            |     42 |     48 |          800 |
| Admin dashboard                                          |     49 |     57 |          400 |
| Submit (draft save + final submit, transaction + outbox) |     36 |     52 |          300 |

These are single-client latencies on one machine, not a capacity claim. Concurrency and network-attached MongoDB will add latency; load-test your target environment before stating user capacity.

## What keeps it fast

- Compound indexes for every list and filter path (see `apps/api/src/models`), stable sorts with `_id` tie-breaks, bounded page sizes.
- Batch loading in serializers (no N+1 queries), aggregation for counts and distributions.
- Lists are bounded: student assignment views are scoped to enrolled courses (capped at 2,000), exports are capped, and inboxes load one course's roster.
- Slow work (email, fan-out notifications) runs in the worker, never in the request.
- Web: route-level code splitting, charts and Markdown in separate chunks, debounced search, cached queries with targeted invalidation.
