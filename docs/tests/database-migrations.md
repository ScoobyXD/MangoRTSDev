# Current Database Migration Business Logic Laws

1. A release migration plan must inspect one read-only repeatable-read transaction without creating a ledger or changing database objects or rows.
2. The plan must report the complete sorted applied and pending filenames, normalized pending-file SHA-256 values, repository schema fingerprint, and actual schema inventory fingerprint.
3. An absent ledger, an unknown recorded filename, or PostgreSQL outside versions 17 and 18 must block an automatic release.
4. A known one-time September migration must stop before release when its unrecorded target table, column, index, sequence, or function already exists.
5. Migration selection must use the existing runner and recorded filenames; the plan must not accept execution anchors, repair history, or infer an applied migration from an existing object.
6. Each migration body and its ledger entry must commit in one transaction; failure must roll back that file and stop before the next file.
7. Failure of a later migration must leave earlier committed migrations recorded; code rollback alone must never be presented as reversing those database changes.
8. An already recorded migration must perform no work when the runner resumes.
9. Removing retired application schema from the repository must not silently remove live objects or rewrite their migration ledger.

`miraeopus-migrate -mode plan` emits one `MANGORTS_MIGRATION_PLAN=` line containing JSON. `ready=false` produces a nonzero exit after the result is written. The plan checks known catalog conflicts; transactional SQL preconditions and data validation remain in the original migration scripts. A successful plan is not proof of full schema parity or data backfills. The ledger stores filenames, so reported file hashes identify the release's repository bytes and do not claim to prove historical applied bytes.

Tests in `backend/cmd/miraeopus-migrate` cover pending and already-applied plans, blockers, script and ledger failures, and partial-commit resumption using a transaction-isolated test driver without live database access.
