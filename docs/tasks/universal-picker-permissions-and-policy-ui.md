# Process Story: Fast authorized search and automatic policy status

A non-admin types a nonblank Universal Picker query or chooses one entity tab
↓
Mango asks only the selected source table, or Nodes, Projects, Logic Gates, and Emails in that order for All, for a small ranked candidate set
↓
The backend checks permission only after narrowing, reuses the actor's group ancestry for the batch, and touches Company Explorer only for those candidates whose exact placement path must also be visible
↓
Denied candidates are removed and the next bounded batch is checked only when needed to fill the result limit; a newer keystroke cancels the stale browser request
↓
When an authorized manager edits RACI or permissions, Inherited and Customized update automatically from exact raw parent equality, and the acting manager cannot remove their own Edit access
↓
Parents offer Apply to non-customized descendants and confirmed Apply to every descendant without rewriting every descendant policy row

Last updated: 2026-08-07

# Universal Picker permissions and policy UI

Status: implemented and verified in the worker branch on 2026-08-07. `node scripts/run_all_tests.mjs` passed the frontend feature suite, production build, complete WSL2 backend Go suite, and infrastructure contracts.

## Problem found

The editor-ranked search path performed broad visibility work before it had a final small candidate set. Non-admin searches repeatedly resolved resource policies, nested groups, organizational locations, and visible Company Explorer folder paths across far more rows than the requested result limit. The search GET also called default-folder repair, which could open a write transaction, upsert Unfiled/Projects/Logic Gates, and fire the normal folder/version machinery during a read.

The permission and RACI interfaces also treated Inherited and Customized like modes the user had to manage. That exposed implementation detail, added warnings, and made a normal edit require an unnecessary mode choice. A company manager could also propose a default-no-access policy that removed the same acting manager's own effective Edit permission.

## Required Universal Picker behavior

1. A blank Universal Picker keeps its existing pinned/recent presentation; it does not start a company-wide free-text search.
2. A selected Node, Project, Logic Gate, or Email tab searches only that exact source.
3. All searches Nodes, Projects, Logic Gates, and Emails in that order.
4. Nodes, Projects, and Logic Gates are ranked directly from their authoritative source tables before any permission work.
5. The backend checks a bounded candidate batch, removes denied rows, and checks later batches only until it fills the requested authorized result limit or exhausts matches.
6. The actor's direct and nested group membership is resolved once per candidate batch, not once per resource.
7. Company Explorer participates only in a narrowed candidate's exact location-visibility check. It does not own entity names, permission rows, or RACI/GVIC assignments.
8. Nodes without an organizational link may be returned from Node permission alone. A Node with Logic Gate or Project organization is returned only through at least one visible exact location whose folder ancestors are also visible.
9. Search GET requests perform no default-folder repair or other database write.
10. The browser aborts an older in-flight keystroke request when a newer query replaces it, and the request context cancels the matching PostgreSQL query instead of letting obsolete permission work continue in the background.

## Required permission and RACI behavior

1. Inherited and Customized are status displays, not buttons.
2. Authorized users edit the normal fields directly while either status is displayed.
3. RACI equality compares the complete unordered raw role/principal-type/principal-ID set with the immediate parent's raw assignment set. Expanded group members do not participate in equality.
4. Permission equality compares the complete default access plus unordered raw subject-type/subject-ID/access rows with the immediate parent's policy.
5. An exact match is Inherited. Any difference is Customized. The backend repeats the comparison against the live parent inside the write transaction and is authoritative.
6. A root resource remains customized because it has no parent to inherit from.
7. Descendant actions appear only when the selected resource actually has descendants.
8. **Apply to non-customized descendants** preserves active customized boundaries and performs no descendant policy-row fanout.
9. **Apply to every descendant** requires confirmation and advances the existing reset sequence so it crosses older customized boundaries without rewriting every descendant.
10. When the acting user is a company manager, a permission save must preserve that same actor's effective Edit access by adding or correcting only their direct Edit rule if the proposed policy would otherwise deny it. The manager may still change policies that remove another manager's access.
11. RACI/GVIC remains responsibility metadata only and never grants permission or search visibility.

## Source-of-truth boundaries

- `nodes`, `projects`, `logic_gates`, and the email message endpoint own searchable entities.
- `company_explorer_folders` and `company_explorer_items` own typed folder paths and Project/Logic Gate placement.
- `node_logic_gate_assignments` and `project_relationships` supply exact Node organization links.
- `resource_gvic_settings` and `resource_gvic_assignments` own RACI policy.
- `resource_permission_settings` and `resource_permissions` own authorization policy.
- Policy inheritance follows the canonical immediate-parent relationships. It does not turn Company Explorer into permission storage and does not add an effective-permission fanout table.

## Verification contract

- Backend store and HTTP tests cover candidate-first SQL shape, absence of search-time default repair, automatic parent equality, and acting-manager self-lockout prevention.
- Frontend contract tests cover exact tab source filters, All ordering, request cancellation, status-only mode UI, and exact descendant labels.
- The production frontend build and full repository test runner must pass.
