# Process Story: prepare V2 policy storage without changing the running application

A human applies the three additive Step 1 migrations to the intended PostgreSQL 17.x database
↓
The old GVIC and permission tables, functions, triggers, readers, and writers remain active and unchanged
↓
The human runs the read-only DBeaver preflight and reviews every source identity, schema check, policy count, invalid principal, snapshot/tombstone count, and projection comparison
↓
Only a final `READY` row permits the separately operated copy
↓
The copy takes one repeatable-read snapshot, resolves the latest old snapshot and direct-revision boundaries, converts every current resource to a complete customized V2 baseline, and reconciles exact counts and fingerprints
↓
The human may rerun the copy safely; any mismatch aborts the transaction and leaves the prior V2 destination intact
↓
Step 2 later pauses writers, reruns the final delta copy, and performs the separately reviewed application cutover

# V2 GVIC and permissions Step 1 operations

The authoritative product and migration contract remains [`v2gvic&permissions.md`](v2gvic&permissions.md). This file records only the human-run order for the Step 1 artifacts.

## Artifacts

Apply these repository migrations in filename order:

1. `backend/db/migrations/20260805_zzz_v2_gvic_permissions_step1.sql`
2. `backend/db/migrations/20260805_zzza_v2_gvic_permissions_step1_resolvers.sql`
3. `backend/db/migrations/20260805_zzzb_v2_gvic_permissions_step1_preflight_report.sql`

Then use:

1. `scripts/v2_gvic_permissions_step1_preflight.sql`
2. `scripts/v2_gvic_permissions_step1_copy_reconcile.sql`

The production target is PostgreSQL 17.x. The SQL also accepts PostgreSQL 18.x so the same artifacts can be exercised against the repository's disposable local test server. Other major versions return or raise `STOP`.

## Human-run order

1. Confirm the intended database, current PostgreSQL server version, normal backup policy, and deployment change record.
2. Apply the three additive migrations with the normal migration runner. Do not paste only part of a migration. Each migration must commit fully or roll back fully.
3. In DBeaver, run `scripts/v2_gvic_permissions_step1_preflight.sql` as a script. It opens a read-only transaction. Review all `STOP` rows and the last `FINAL` row.
4. Do not run the copy unless the final preflight row is `READY`. A source/effective/projection disagreement is a blocker that must be classified; do not edit the SQL to ignore it.
5. Run `scripts/v2_gvic_permissions_step1_copy_reconcile.sql` separately. It writes only the V2 settings tables, V2 staging graph tables, and two V2 sequences. It does not update or delete old policy storage.
6. Confirm the copy's final row is `READY`, review each resource-type count and fingerprint, and rerun the read-only preflight.
7. Rerun the copy whenever a later exact delta is needed. The copy is restartable and replaces the V2 baseline with the policy resolved from one repeatable-read source snapshot.
8. If DBeaver reports an exception during the copy, run `rollback;` on that connection before retrying. Fix or classify the reported source/schema mismatch first.
9. Stop after Step 1. Do not rename graph tables, switch application readers or writers, or retire old storage. Those actions require the separately approved Step 2 and Step 3 work.

## Baseline conversion

Step 1 never guesses that equal parent and child policies were inherited. Every existing supported resource receives:

- stored mode `customized`;
- its fully resolved current policy in V2 staging;
- `descendant_reset_sequence = 0`;
- `parent_link_sequence` equal to the migration baseline for children and zero for roots;
- a customization sequence equal to the migration baseline;
- separate GVIC and permission sequences whose next values are strictly above the baseline.

The copy normalizes old GVIC `shared_triage_folder` identities to `shared_inbox_folder`. Missing resources or principals, invalid GVIC role shapes, hierarchy cycles, unresolved permission defaults, old effective-table disagreements, and My Work projection disagreements stop the copy instead of being guessed or silently repaired.
