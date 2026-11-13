# Bugs found by the e2e sweep

Each bug: where it was found, what happened vs what should happen, and the fix commit.

| # | Found by | Repo | Bug | Expected | Fix |
|---|---|---|---|---|---|
| B-01 | Harness design (DB reset while the API runs) | sg-api | `pg.Pool` had no `error` listener. When Postgres dropped an idle connection (restart, failover, admin kill), Node treated it as an unhandled `error` event and **the API process exited**. | API logs it, discards the connection and keeps serving. Verified by killing the API's DB connections with `pg_terminate_backend`. | `467c2a7` |
| B-02 | STU-03, TUT-14 (slow, 1.6–1.8 s) | sg-app, sg-backoffice | React Query retried every failed request, including 4xx, so "Class not found" or "forbidden" appeared about 1 s late. | 4xx shown immediately; only network/5xx errors are retried (once). | sg-app `6d731a4`, sg-backoffice `b8779f2` |
| B-03 | Running lint after the first e2e build | sg-app, sg-backoffice | ESLint linted the `.next-e2e` build output (6,000+ false problems). | Build output ignored. | sg-app `5b9d076`, sg-backoffice `0fcc7cb` |
| B-04 | SEC-08 | sg-api | A malformed JSON body (e.g. `{not json`) returned **500 "Something went wrong"**: `express.json()` parse errors fell through to the generic handler. Oversized bodies did the same. | 400 "The request body is not valid JSON"; 413 for bodies over 100 kB. Unit test added in sg-api. | `6e20cd9` |
