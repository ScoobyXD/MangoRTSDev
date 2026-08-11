# Process Story: GVIC inheritance is automatic and remains a raw pointer policy

An editor changes a direct Responsible, Accountable, Consulted, or Informed user/group assignment
↓
Inherited and Customized remain status displays while all authorized assignment fields stay editable
↓
The draft is Customized when its unordered raw role/principal pointers differ from the immediate parent and automatically returns to Inherited when they match exactly
↓
The backend repeats the live parent comparison in the write transaction; expanded group members are never used for policy equality
↓
A parent exposes Apply to non-customized descendants and, with confirmation, Apply to every descendant only when descendants exist
↓
The constant-size reset pointer remains the force mechanism, and GVIC never grants permission or search visibility

Last updated: 2026-08-07

# Process Story: RACI cards keep every direct assignment readable

A user opens a Node or Logic Gate with Responsible, Accountable, Consulted, and Informed assignments
↓
The four role cards reuse the Kanban In Progress orange, Done green, Review teal-blue, and Backlog purple in a deliberately pale layered gradient
↓
Each card keeps its Add action in the top-right heading row so the assignment area receives the full card width
↓
Every direct person and group occupies its own single-line name row, so one entry never becomes a two-line pill and five entries remain visible as five rows
↓
The assignment surface still opens the complete removable list on hover or click without changing RACI identity, membership, or permission behavior

Last updated: 2026-08-06

# Process Story: Existing RACI data converts without retired projection storage

A human operator runs the reviewed RACI role migration against an existing database
↓
The migration locks and converts only the final live V2 policy, notification, and Recycle Bin tables
↓
Stored notification event names are converted through the real `notifications.notification_type` column
↓
Generated becomes Responsible, while Verified or Verifier becomes Accountable
↓
The migration completes without reading, locking, or recreating the retired GVIC matrix projection table

Last updated: 2026-08-06

# Process Story: A team assigns live RACI responsibility

A manager or editor opens a Node or Logic Gate and sees Responsible, Accountable, Consulted, and Informed in that order
↓
Each role card shows the full names of its directly assigned people and the names of its directly assigned groups
↓
Any role can receive multiple people or groups, while one direct principal can hold only one role on the same resource
↓
A group assignment stays one typed group edge and expands through current members and nested subgroups whenever effective RACI is read
↓
If membership changes or a person's effective role changes, RACI inbox reads and notification routing use the new live result without copying per-user assignment rows
↓
RACI remains separate from permissions and never grants Edit access

Last updated: 2026-08-06

# RACI Tests (technical `gvic` API namespace)

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: backend, HTTP, frontend contract, disposable PostgreSQL, scale, and regression coverage for V2 role validation, inherited/customized resolution, force resets, moves, detach, group changes, RACI inboxes, notifications, and fingerprints. Rule ID mapping remains partial.

## Business Logic

RACI1 - RACI supports Responsible, Accountable, Consulted, and Informed roles and normalizes input before validation.
RACI2 - Responsible, Accountable, Consulted, and Informed each accept multiple users or groups.
RACI3 - One direct source principal can have only one RACI role in one customized resource policy.
RACI4 - Canonical RACI resource types are node, logic_gate, huddle_logic_gate, huddle_node, project, company_explorer_folder, shared_inbox_folder, and shared_inbox. `shared_triage_folder` is rejected after cutover.
RACI5 - `resource_gvic_settings` stores mode and sequences; `resource_gvic_assignments` stores only the complete customized graph. No effective, revision, snapshot, or projection table is policy authority.
RACI6 - Every root is customized, including an empty policy. A non-root resource starts inherited unless its creation workflow explicitly customizes it.
RACI7 - An inherited resource stores no RACI edges. Its effective policy is the nearest active customized resource in its live parent chain.
RACI8 - Customizing copies the current effective policy once, applies the requested complete replacement, and allocates a new customized sequence in one transaction.
RACI9 - Returning to inherited deletes the resource's customized edges and customized sequence, then immediately exposes its current effective ancestor.
RACI10 - An ordinary policy save changes only that resource. It does not rewrite descendants.
RACI11 - Apply to non-customized descendants saves the selected policy if needed and writes no descendant policy state. Inherited branches already resolve it live, and active customized boundaries remain protected.
RACI12 - Apply to every descendant records one ancestor reset sequence that also supersedes older active customized policies below that resource. The UI requires a separate confirmation.
RACI13 - A customization made after a reset becomes active again because its customized sequence is newer.
RACI14 - A parent relationship created or changed receives a new parent-link sequence for both policy domains. A link newer than a reset blocks that older reset from crossing the moved edge.
RACI15 - Moving an inherited resource changes its effective policy immediately; moving a customized resource preserves that customization. Descendants are not rewritten.
RACI16 - A Node assigned to a Logic Gate uses that Logic Gate as its immediate parent. Detaching an inherited Node materializes its current effective RACI as a customized Node policy in the same transaction. Huddle Node ownership and Huddle Explorer placement do not create RACI parentage.
RACI17 - A creator rule, including an email-derived Responsible assignment, first copies the final effective parent policy and then changes the new resource to customized.
RACI18 - Group assignments remain group pointers. Current nested membership expands at read time, and cycles are rejected.
RACI19 - Group membership, parent-group, and deletion changes affect effective RACI immediately without rewriting resource policies. Deleting a group removes its direct policy edges.
RACI20 - If one user reaches several roles, the deterministic order is Responsible, Accountable, Consulted, then Informed; direct and shallower sources break equal-role ties.
RACI21 - RACI never grants Edit access. Authorization reads only the separate permission policy.
RACI22 - A RACI inbox includes a resource only when the actor has both effective RACI and effective Edit permission, resolved from the four canonical tables, live hierarchy, and live groups.
RACI23 - Notification routing resolves the current effective RACI of the exact target resource. Parent or neighboring resource RACI never substitutes.
RACI24 - Assignment notifications are sent only for newly effective users or effective role changes; unchanged users, removals, unrelated users, and the actor receive none.
RACI25 - RACI event payloads identify policy type, action, descendant action, allocated sequence, mode, and changed recipients.
RACI26 - Reads explain the stored mode, effective mode, source resource, active reset, and an inactive stored customization superseded by force overwrite.
RACI27 - The frontend shows Inherited or Customized as a non-clickable status, keeps authorized assignment inputs editable in either state, provides both exact descendant actions only when descendants exist, protects stale writes, invalidates affected workspace reads, and performs no optimistic descendant materialization.
RACI28 - Fingerprints include effective source identity and sequence, eligible reset identity and sequence, the parent-link boundary, live group-membership version, and actor-specific edit result where exposed.
RACI29 - Point reads, RACI inbox reads, notification decisions, and cache validation derive current policy state at read time; canonical policy rows stay constant-size with descendant count, while the non-authoritative RACI Tabs UI copy may perform the accepted per-user and per-Logic-Gate reconciliation defined in `docs/tests/raci-tabs.md`.
RACI30 - Resource deletion deletes its settings row and cascades its RACI edges. No missing resource, user, or group identity can remain.
RACI31 - Shared inbox folder and shared inbox RACI use their exact canonical resource identities and remain separate from permissions and mailbox credentials.
RACI32 - Logic Gate work may expose its effective Responsible user as request-owner metadata, but that field never implies permission.
RACI33 - Email-derived and workspace-created resources apply creator rules only after their final parent placement so copied policy comes from the correct source.
RACI34 - Stale in-flight reads cannot overwrite a newer committed policy response; ETags and policy fingerprints track the resolved V2 state.
RACI35 - Canonical RACI policy readers and writers use only `resource_gvic_settings` and `resource_gvic_assignments`. Temporarily retained legacy tables are frozen rollback evidence, and the separate RACI Tabs UI copy is never read as policy authority.
RACI36 - All RACI changes and their settings, graph edges, events, and read-version effects commit atomically.
RACI37 - The editor keeps the four role columns compact, shows one neutral Inherited/Customized status, does not show raw policy-source UUIDs or customization warnings, and does not require a separate mode action before an inherited assignment can be edited.
RACI38 - A cross-Logic-Gate Node move reads and authorizes the actual canonical one-per-Node assignment. A caller-supplied source Logic Gate is only a hint and cannot select relationship authority or cause a valid move to fail when stale. The move changes the canonical Logic Gate assignment and its projections; it neither requires nor rewrites optional email or attachment relationships owned by the same Node.
RACI39 - After any successful RACI policy write, cached Node and Logic Gate records are invalidated. A descendant view must refetch its live effective policy instead of displaying a stale record cache; Apply to non-customized descendants still writes no descendant policy rows, and Apply to every descendant still uses one reset sequence instead of materializing descendants.

RACI45 - GVIC policy equality compares the unordered raw assignment set keyed by role, principal type, and principal ID. A group stays one pointer. Expanded effective users, labels, timestamps, and array order do not affect equality.

RACI46 - The frontend uses its loaded parent policy for immediate status, while the backend re-resolves the live parent and stores the authoritative mode inside the same write transaction. Roots remain customized because they have no parent.
RACI47 - Huddle Logic Gates and Huddle Nodes use direct RACI policies under the exact resource types `huddle_logic_gate` and `huddle_node`. Their RACI surfaces do not expose either descendant action.
RACI40 - The editor presents RACI as Responsible (Kanban In Progress orange #f08a24), Accountable (Kanban Done green #19c879), Consulted (Kanban Review teal-blue #19a8ff), and Informed (Kanban Backlog purple #8b5cf6), in that order. Each card keeps a pale layered treatment: a 14%/8% radial highlight, a 12%/7%/6% fill, a 34%/22%/12% edge gradient, and a 6% role-colored glow. The stronger Kanban column surface opacity is not used on RACI cards.
RACI41 - Each role card keeps Add in its top-right heading row and gives the assignment surface the full card width. Zero assignments renders one unwrapped `No assignments` row; otherwise every direct person or group renders as its own unwrapped name row, all rows remain visible as the card grows, and a group name continues to represent its live nested membership.
RACI42 - Replacing a V2 policy notifies a non-actor user when that user's highest effective RACI role changes, even when the user was already effective before the write.
RACI43 - Accountable is the green second role and uses the A inbox. The obsolete Verifier role, V inbox, and CVI notification surface are rejected after cutover; migration converts stored Verified or Verifier values to Accountable and CVI notifications to ACI.
RACI44 - The RACI forward migration uses only live V2 policy, notification, and Recycle Bin storage. Notification event-name conversion uses `notifications.notification_type`; the migration must not reference a nonexistent `notifications.event_type` column or read, lock, update, or recreate the retired `gvic_matrix_projection_table`.
RACI47 - Tower may copy effective Logic Gate users and their winning roles into `raci_tabs_items` solely for personal RACI-tab navigation. This accepted copy may fan out after policy, hierarchy, or group changes, but canonical group assignments remain pointers and neither RACI Tabs table grants RACI or permission.

## Scenarios

### Scenario RACI-S1: Role Validation And Access Levels

Business logic covered:
- RACI1
- RACI2
- RACI3
- RACI4
- RACI5
- RACI6
- RACI7
- RACI19
- RACI22
- RACI43
- RACI44

Given:
- A company assigns users and groups to nodes, logic gates, projects, and supported shared resources.
- Requests include valid roles, aliased/cased role input, and invalid roles.
- An existing database has the final live V2 tables and no gvic_matrix_projection_table.

Expected:
- Responsible, accountable, consulted, and informed are accepted after normalization.
- Legacy Generated, Verified, and Verifier role values are rejected by runtime writes after the migration.
- The forward migration converts the live role data without reading, locking, updating, or recreating the retired projection table.
- Stored CVI/RCVI notification event names are converted through `notifications.notification_type`, never a nonexistent `event_type` column.
- Invalid roles, resource types, principal types, or missing IDs are rejected.
- Responsible and Accountable do not produce edit/delete permission access.
- Consulted and informed do not produce edit permission access.
- Resource authorization remains controlled by permission policy: default access, direct user rows, and group rows.
- Different principals can hold different RACI roles on the same resource without losing the role meaning.
- Every RACI role accepts multiple direct users or groups; one direct principal cannot occupy two roles on the same resource.

### Scenario RACI-S2: Group Expansion And Removal

Business logic covered:
- RACI8
- RACI9
- RACI17
- RACI18
- RACI23
- RACI37

Given:
- A group has members and a RACI assignment on a resource.
- One user also has a direct RACI assignment.
- A user is removed from the group and a RACI assignment is later deleted.

Expected:
- Group assignments expand into effective user assignments for current group members.
- Effective records preserve whether access came from direct or group source.
- Removing the user from the group removes only the group-derived effective access.
- Removing the RACI edge removes that source principal from future effective resolution.
- No permanent effective policy row is updated or retimestamped; the non-authoritative RACI Tabs UI rows reconcile only as required by `docs/tests/raci-tabs.md`.
- Current nested membership is expanded on each canonical read.
- Group membership or parent changes update the company group fingerprint without changing resource customization sequences.

### Scenario RACI-S3: Canonical Resolution Without Descendant Materialization

Business logic covered:
- RACI10
- RACI11
- RACI12
- RACI13
- RACI14
- RACI15
- RACI16
- RACI35

Given:
- A Logic Gate has inherited and customized Node descendants.
- A regular Logic Gate RACI edit uses Apply to non-customized descendants.
- The user separately runs Apply to every descendant for that Logic Gate.
- A user later opens or refreshes a RACI inbox after assignments change.
- Another browser may retain stale RACI inbox state until navigation or refresh.

Expected:
- A regular edit updates one complete Logic Gate policy; inherited Nodes see it and active customized Nodes do not.
- Apply to non-customized descendants adds no descendant state or graph writes.
- Apply to every descendant updates one descendant-reset sequence and makes eligible older Node customizations inactive without walking assigned Nodes.
- Project, Node, and shared-resource policy writes remain scoped to one settings row and one complete edge set.
- The RACI inbox derives current rows from V2 policy, hierarchy, live groups, permissions, and work metadata.
- No RACI inbox realtime policy scope or permanent effective/projection authority is created; RACI Tabs remains a derived navigation copy and never becomes policy authority.
- The RACI inbox sees current effective state on its next canonical load.
- Independently required notification/domain-event consumers remain, but no generic browser refresh event is published.

### Scenario RACI-S4: Shared Inbox RACI And Permission Separation

Business logic covered:
- RACI20

Given:
- A shared inbox has RACI assignments and separate resource permission grants.

Expected:
- RACI assignment reads and writes preserve RACI records.
- Updating shared inbox access does not convert RACI assignments into ordinary permission grants.

### Scenario RACI-S5: Complete Writes And Logic Gate Cache Freshness

Business logic covered:
- RACI23
- RACI24
- RACI25
- RACI26
- RACI27
- RACI28
- RACI34
- RACI39

Given:
- A Logic Gate has Responsible, Accountable, Consulted, and Informed RACI assignments.
- A user adds or removes one assignment through the canonical complete-policy PUT.
- The user separately invokes Apply to non-customized descendants or Apply to every descendant.
- A broad Logic Gate payload or workspace list request may already be cached or in flight.
- An inherited Node is assigned to the Logic Gate and another Node owns an active customization.

Expected:
- The write replaces one complete customized edge set and its sequence in one transaction.
- Apply to non-customized descendants writes no descendant state; Apply to every descendant changes one reset sequence.
- No permanent effective or RACI inbox authority rows are maintained; any RACI Tabs rows remain the non-authoritative UI copy defined in `docs/tests/raci-tabs.md`.
- Editable RACI chips and mode/source explanations reconcile from the canonical response.
- RACI inboxes and other non-live views resolve current state on open or refresh.
- Stale broad Logic Gate payloads, stale workspace list cache entries, cached Node/Logic Gate records, and stale in-flight reads cannot overwrite newer Logic Gate RACI assignments or descendant effective policy.
- Logic Gate and Node RACI follow the same freshness contract.
- The inherited Node resolves the Logic Gate live; the customized Node remains independent until an eligible Apply to every descendant reset.
- Parent-link, reset, group-version, actor, and effective-source fingerprints prevent unsafe 304 responses.
- The canonical response remains authoritative without pretending descendants were individually rewritten.

### Scenario RACI-S6: Node Logic Gate Inheritance, Detach, RACI Inboxes, And Updates

Business logic covered:
- RACI21
- RACI28
- RACI29
- RACI30
- RACI31
- RACI32
- RACI33
- RACI34
- RACI35
- RACI36
- RACI29

Given:
- A standalone customized Node has its own RACI policy.
- An inherited Node and the customized Node are placed into a Logic Gate with a different policy.
- The Logic Gate RACI changes after both Nodes have entered.
- The Logic Gate change is saved normally and may later be force-overwritten through descendants.
- One subtree is moved after an older reset.
- The inherited Node is later detached from the Logic Gate.
- Project, logic gate, and node updates are shown in Updates.

Expected:
- Placing either Node advances its parent-link sequence without replacing an active customized policy.
- The inherited Node follows the Logic Gate live; the customized Node stays independent on an ordinary parent edit.
- Editing an inherited Node starts from the raw parent assignments, preserves group pointers, and automatically becomes Customized only when the saved raw assignment set differs from the immediate parent.
- Apply to every descendant changes one Logic Gate reset sequence and can supersede older customized descendants without row fanout.
- A parent link created after an older reset protects the moved subtree until a later reset.
- Detaching the inherited Node materializes its current effective policy as a customized Node policy in the same transaction.
- A RACI inbox shows the Node only when the user's effective Node RACI includes it and the viewer has Edit access; parent Project or Logic Gate RACI only provides grouping and context.
- Project RACI does not flow down into logic gates or nodes.
- Updates visibility uses the RACI/access rules of the updated target: project updates use project RACI, logic gate updates use logic gate RACI, and node updates use node effective RACI.

### Scenario RACI-S7: Live Inheritance And Sequence-Scaled Descendant Actions

Business logic covered:
- RACI6
- RACI7
- RACI8
- RACI10
- RACI11
- RACI12
- RACI13
- RACI14
- RACI15
- RACI18
- RACI26
- RACI28
- RACI29

Given:
- A parent resource has configured RACI assignments.
- Some descendants are inherited and one child has a different customization.
- The parent is saved normally, Apply to non-customized descendants is selected, then Apply to every descendant is separately confirmed.
- The child is customized again after the reset and another subtree is moved after the reset.

Expected:
- New non-root resources start inherited and store no copied RACI edges.
- Editing a parent changes inherited branches live and stops at the active customized child.
- Apply to non-customized descendants adds no policy state and performs no descendant writes.
- Apply to every descendant changes one reset sequence and makes eligible older customizations inactive without deleting their dormant rows.
- A later child customization copies the then-current effective source, applies its changes, and becomes independent again.
- A subtree moved after the reset is protected by its newer parent-link sequence.
- Point reads explain the effective source, eligible reset, and any inactive stored customization.
- Write count stays constant as modeled descendant count grows.
- Group RACI assignments remain group pointers and are not expanded into one canonical source row per user; RACI Tabs may separately copy one derived navigation row per effective user.
- RACI explanations identify source policy, direct/group principal, live membership, reset, and parent-link boundary.

### Scenario RACI-S8: Minimal Logic Gate Work Request Owner

Business logic covered:
- RACI21
- RACI28
- RACI32
- RACI34

Given:
- A Logic Gate has one Responsible user and an Arena work snapshot is cached.
- The Responsible assignment changes while an older work request is still in flight.

Expected:
- The work header contains the current Responsible user's ID as `request_owner_user_id`.
- The payload contains no full RACI assignment collection.
- The assignment/policy change invalidates the gate work version and reconciles the shared cached snapshot.
- The stale response cannot overwrite the newer request owner.
- Request-owner metadata does not grant any resource permission flag.

### Scenario RACI-S9: Email Node Creator Ownership And Normal RACI

Business logic covered:
- RACI29
- RACI17
- RACI33

Given:
- An ordinary standalone Node and an email-collaboration Node both exist.
- A participant joins the email collaboration through a direct or group mention.
- The creator submits the first priority-bearing email comment, a participant later joins through a direct or group mention, and an authorized caller edits RACI on both Nodes.

Expected:
- The ordinary standalone Node retains editable Node RACI source assignments.
- Email Node creation gives the creator direct Responsible RACI, and later generic RACI mutations follow the same authorized Node rules as the ordinary Node.
- Mention participation remains a permanent collaboration access grant but creates no RACI assignment unless a separate RACI command assigns one.
### Scenario RACI-S10: Narrow Entity Headers Preserve The Compact RACI Row And More-Owned Bulk Action

Business logic covered:
- RACI12
- RACI27
- RACI37
- RACI40
- RACI41
- RACI45
- RACI46

Given:
- A Node or Logic Gate editor shows the four shared RACI role cards.
- An adjacent pane narrows the available editor width.
- A Node or Logic Gate user can access RACI policy mode actions.
- A Logic Gate user can access both descendant actions.

Expected:
- Responsible, Accountable, Consulted, and Informed remain in one horizontal row that may be clipped rather than wrapping vertically.
- Each role card uses its matching Kanban palette color through the pale RACI gradient, and Add stays in the top-right heading row.
- `No assignments` remains one line when a role is empty.
- Five assigned people or groups render as five visible single-line name rows in the assignment surface rather than a count, a comma-truncated summary, or one name split across two rows.
- No effective-source, apply, or current-RACI card appears in the header body; the assignment surface may show one compact status pill.
- Inherited and Customized are read-only status displays beside the assignments, not mode-change buttons; authorized fields remain editable in either state.
- The Logic Gate descendant actions appear in **More editor actions** only when the Logic Gate has descendants and retain their existing permission, disabled, busy, and error handling.
- **Apply to non-customized descendants** preserves customized boundaries. **Apply to every descendant** opens an explicit Yes/No confirmation before it crosses those boundaries.
- Choosing No, canceling, or dismissing performs no write.
- Only choosing Yes records the Apply to every descendant reset sequence; no assigned Node policy rows are individually rewritten.

### Scenario RACI-S11: Editor-Owned Routing And Target-Only Assignment Updates

Business logic covered:
- RACI36
- RACI23
- RACI24

Given:
- A Node is inside a Logic Gate and their current RACI assignments differ.
- Node and Logic Gate editor actions are committed.
- Bob is newly assigned, Alice is unchanged, and Charlie is removed by a RACI mutation.

Expected:
- Node actions use the Node's current effective roles and Logic Gate actions use the Logic Gate's current effective roles.

### Scenario RACI-S12: Cross-Logic-Gate Moves Use The Canonical Assignment

Business logic covered:
- RACI38

Given:
- A Node has one canonical Logic Gate work assignment.
- The browser submits a move to another Logic Gate with an absent or stale `from_logic_gate_id` hint.
- The Node may have no email relationship, or may have email and attachment relationships that remain owned by the Node.

Expected:
- The server reads the Node's canonical assignment and authorizes the actor against that actual source Logic Gate.
- The stale hint neither produces `logic_gate_work_assignment_not_found` nor substitutes another source relationship.
- The one assignment moves to the target Logic Gate and its related projections and events use the same canonical Node and Logic Gate IDs.
- The move succeeds without an email relationship, and any existing Node email or attachment relationships remain unchanged.
- Only Bob receives the assignment update; Alice, Charlie, unrelated users, and the actor do not.
- Group-backed assignments use the same effective-user delta rule without duplicating recipients.
