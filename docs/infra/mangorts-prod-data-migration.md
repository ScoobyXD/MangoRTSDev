# MangoRTS Production Data Migration Plan

Production should start from repo schema plus selected business data. Do not blindly clone the dev database into prod.

Rule:

```text
Schema comes from the repo.
Selected business data comes from dev.
Environment-bound auth/provider state gets recreated or explicitly mapped.
Derived tables are rebuilt unless the team deliberately decides to copy them.
```

## Source Of Truth

Use the repo for schema:

- `backend/db/schema.sql`
- `backend/db/migrations/`
- `scripts/apply_canonical_schema.ps1`
- `scripts/apply_db_migrations.ps1`
- `scripts/check_db_ready.ps1`

Use dev data only as migration input. The dev database may contain test rows, old drift, provider state, projection rows, and one-off manual changes that should not become production truth.

## Table Classification

Create a table-by-table inventory before writing import SQL. Every table must be classified as one of:

- `copy`: copy as-is after row selection.
- `map`: copy while remapping IDs, usually `user_id`, `cognito_subject`, `company_id`, or provider references.
- `recreate`: create manually or through app/admin flows in prod.
- `rebuild`: let app jobs/projection code rebuild from source-of-truth tables.
- `skip`: do not move to prod.

Recommended starting classification:

| Table family | Initial decision | Notes |
| --- | --- | --- |
| `companies` | map or copy | Depends on the company ID decision. |
| `users` | map | Prod Cognito subjects are separate; map by lowercase email. |
| `company_memberships` | map | Import only approved real users and companies. |
| `company_user_groups`, `company_user_group_members` | map | Rewrite user and company references. |
| `nodes`, `node_information`, `node_relationships` | copy or map | Core product data; filter test/debug rows. |
| `logic_gates`, `logic_gate_information`, `logic_gate_relationships` | copy or map | Core product data; preserve relationships. |
| `node_logic_gate_assignments` | copy or map | Requires nodes and logic gates to be imported first. |
| `projects`, `project_relationships`, `accounts` | copy or map | Core business data if real. |
| `company_explorer_*` | copy or map | Preserve folder/item tree only after filtering dev/test content. |
| `shared_inbox_folders`, `shared_inboxes` | recreate or map | Safe only after prod company email connections are reconnected. |
| `resource_permissions`, `resource_permission_*`, `resource_gvic_*` | map | Rewrite user/group/company references carefully. |
| `saved_views`, `pins` | map | User-scoped convenience data; copy only for mapped real users. |
| `recycle_bin_items` | skip or copy | Copy only if recovery history matters for launch. |
| `invitations`, password reset tables | skip | Pending dev tokens and reset state are environment-bound. |
| `user_email_connections`, `company_email_connections` | recreate | Do not copy dev Nylas grant IDs into prod. |
| `communications_*` provider/cache/job/read tables | skip or rebuild | Avoid copying webhook/archive/read state unless explicitly approved. |
| `event_rows`, outbox/job tables | skip | Do not replay dev events in prod. |
| `notifications` and notification checkpoint tables | rebuild or skip | Derived/user-facing state; copy only with a deliberate decision. |
| `*_projection*`, `workspace_read_versions`, checkpoint tables | rebuild | Derived hot-read state should be regenerated where possible. |

The final migration inventory should live in a reviewed doc or script comments and include the exact table names found in the current schema.

## User And Cognito Mapping

Production Cognito must be separate from dev Cognito. Do not assume dev Cognito `sub` values are valid in prod.

Mapping process:

1. Normalize all user emails to lowercase using the same rule enforced by `users.email`.
2. Decide which dev users are real production users.
3. Create those users in the prod Cognito pool through the approved invite/bootstrap process.
4. Capture each prod Cognito `sub`.
5. Build a mapping table with:
   - dev `users.user_id`
   - dev lowercase email
   - prod Cognito `sub`
   - prod `users.user_id`
   - intended company membership role
6. Insert or update prod `users` using the prod Cognito subject.
7. Rewrite references in `company_memberships`, permissions, groups, saved views, pins, notifications if copied, audit actor columns if retained, and any `*_user_id` columns selected for import.

Validation checks:

- Every copied user reference maps to exactly one prod user.
- No unmapped dev user IDs remain in copied tables.
- No dev-only test users are present unless explicitly approved.
- `users.email` is lowercase and unique where expected.
- `/v1/me` returns the expected membership after prod login.

## Company ID Decision

Before writing import SQL, decide whether prod keeps the current dev company ID or creates a new prod company ID.

The dev fallback company ID is:

```text
11111111-1111-1111-1111-111111111111
```

Options:

- Preserve the current company ID for the initial company. This minimizes rewrite risk for a first migration.
- Create a new prod company ID. This is cleaner long term but requires rewriting every copied `company_id`.

The decision affects:

- `companies`
- every company-scoped product table
- `VITE_COMPANY_ID` in the production frontend build
- company membership authorization
- resource permissions and GVIC policy tables
- saved views, pins, notifications, workspace read versions, and projections if copied

Do not let `frontend/src/auth/currentCompany.ts` silently use the dev fallback UUID as the production tenant. Set `VITE_COMPANY_ID` explicitly for prod until tenant selection exists.

## Nylas Grant Reconnection Rule

Prod must use a separate Nylas application with prod callback and webhook URLs. Dev Nylas grant IDs, webhook secrets, OAuth state secrets, and provider tokens must not be copied into prod.

Rule:

```text
Every personal or company mailbox must reconnect through the production Nylas app.
```

Migration implications:

- Recreate `user_email_connections` through prod Hosted OAuth.
- Recreate `company_email_connections` through prod shared inbox connection flows.
- Do not import dev Nylas `grant_id` values.
- Do not import dev webhook secrets, state secrets, archive jobs, provider sync cursors, or webhook delivery state.
- Only copy business-level email artifacts if the team verifies they do not depend on dev-only provider grants.

After reconnection, validate:

- Personal Connect Google flow lands back in prod.
- Company/shared inbox connection creates a prod `company_email_connections` row.
- Nylas webhook challenge succeeds at the prod URL.
- New message events update Communications in prod.

## Rehearsal Process

1. Take a dev database backup or snapshot for analysis.
2. Restore it into a temporary migration-analysis database, or export selected rows from dev using read-only access.
3. Create a scratch prod-like database from repo schema.
4. Apply the candidate import scripts to scratch.
5. Run row-count, orphan, and application smoke checks.
6. Reset scratch and rerun the migration until it is repeatable.
7. Review the exact import scripts and generated mapping tables.
8. Take a final prod backup/snapshot before importing into real prod.
9. Import into real prod once.
10. Run production validation immediately after import.

Migration scripts can be purpose-built SQL or Go/Node tooling, but they must be repeatable and reviewed. Avoid manual console edits for the production import.

## Validation Queries

Adapt these checks to the final table inventory:

```sql
-- Expected core counts.
select count(*) from companies;
select count(*) from users;
select count(*) from company_memberships;
select count(*) from nodes;
select count(*) from logic_gates;
select count(*) from projects;
select count(*) from accounts;

-- No company-scoped rows should reference a missing company.
select 'nodes' as table_name, count(*) as orphan_count
from nodes n
left join companies c on c.company_id = n.company_id
where c.company_id is null;

-- No memberships should reference missing users or companies.
select count(*) as orphan_memberships
from company_memberships m
left join users u on u.user_id = m.user_id
left join companies c on c.company_id = m.company_id
where u.user_id is null or c.company_id is null;

-- No dev Cognito subjects should remain after mapping.
select user_id, email
from users
where cognito_subject = '' or cognito_subject is null;

-- Provider grants should be empty before prod mailbox reconnection.
select count(*) from user_email_connections;
select count(*) from company_email_connections;
```

Also run app-level validation:

- Login as the first prod admin.
- Confirm `/v1/me` returns the expected company and role.
- Load Company Explorer.
- Create, edit, and delete a node.
- Create, edit, and delete a logic gate.
- Load Kanban and mutate a card.
- Confirm permissions/GVIC behavior for at least one non-admin user.
- Confirm saved views and pins for mapped users if copied.
- Confirm no dev-only users, companies, or test content are visible.

## Stop Conditions

Stop the migration when:

- A copied row references an unmapped user or company.
- A dev Nylas grant ID appears in prod.
- A pending dev invitation or reset token appears in prod.
- The app can log in but `/v1/me` has no expected membership.
- Row counts differ from the approved inventory without explanation.
- A derived/projection table is copied without a rebuild/copy decision.
- The migration cannot be rerun cleanly in scratch.
