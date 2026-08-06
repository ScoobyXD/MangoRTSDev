# Process Story: A resource resolves one live GVIC policy from its hierarchy

A user opens or changes a resource's GVIC policy
↓
The resource either uses its nearest active customized ancestor or owns one complete customized policy
↓
Force-overwrite and parent-link sequences decide whether older customizations remain active after resets and moves
↓
Current nested-group membership expands GVIC principals for My Work and notifications, while permissions remain a separate decision

Last updated: 2026-08-05

# GVIC Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: backend, HTTP, frontend contract, disposable PostgreSQL, scale, and regression coverage for V2 role validation, inherited/customized resolution, force resets, moves, detach, group changes, My Work, notifications, and fingerprints. Rule ID mapping remains partial.

## Business Logic

GVIC1 - GVIC supports Generated, Verified, Consulted, and Informed roles and normalizes input before validation.
GVIC2 - Generated accepts at most one user and no group; Verified accepts users but no groups; Consulted and Informed accept users or groups.
GVIC3 - One source principal can have only one role in one customized policy.
GVIC4 - Canonical GVIC resource types are node, logic_gate, project, company_explorer_folder, shared_inbox_folder, and shared_inbox. `shared_triage_folder` is rejected after cutover.
GVIC5 - `resource_gvic_settings` stores mode and sequences; `resource_gvic_assignments` stores only the complete customized graph. No effective, revision, snapshot, or projection table is policy authority.
GVIC6 - Every root is customized, including an empty policy. A non-root resource starts inherited unless its creation workflow explicitly customizes it.
GVIC7 - An inherited resource stores no GVIC edges. Its effective policy is the nearest active customized resource in its live parent chain.
GVIC8 - Customizing copies the current effective policy once, applies the requested complete replacement, and allocates a new customized sequence in one transaction.
GVIC9 - Returning to inherited deletes the resource's customized edges and customized sequence, then immediately exposes its current effective ancestor.
GVIC10 - An ordinary policy save changes only that resource. It does not rewrite descendants.
GVIC11 - Apply to inherited descendants saves the selected policy if needed and writes no descendant policy state. Inherited branches already resolve it live, and active customized boundaries remain protected.
GVIC12 - Overwrite all descendants records one ancestor reset sequence that also supersedes older active customized policies below that resource. The UI requires a separate confirmation.
GVIC13 - A customization made after a reset becomes active again because its customized sequence is newer.
GVIC14 - A parent relationship created or changed receives a new parent-link sequence for both policy domains. A link newer than a reset blocks that older reset from crossing the moved edge.
GVIC15 - Moving an inherited resource changes its effective policy immediately; moving a customized resource preserves that customization. Descendants are not rewritten.
GVIC16 - A Node assigned to a Logic Gate uses that Logic Gate as its immediate parent. Detaching an inherited Node materializes its current effective GVIC as a customized Node policy in the same transaction.
GVIC17 - A creator rule, including an email-derived Generated assignment, first copies the final effective parent policy and then changes the new resource to customized.
GVIC18 - Group assignments remain group pointers. Current nested membership expands at read time, and cycles are rejected.
GVIC19 - Group membership, parent-group, and deletion changes affect effective GVIC immediately without rewriting resource policies. Deleting a group removes its direct policy edges.
GVIC20 - If one user reaches several roles, the deterministic order is Generated, Verified, Consulted, then Informed; direct and shallower sources break equal-role ties.
GVIC21 - GVIC never grants Edit access. Authorization reads only the separate permission policy.
GVIC22 - My Work includes a resource only when the actor has both effective GVIC and effective Edit permission, resolved from the four canonical tables, live hierarchy, and live groups.
GVIC23 - Notification routing resolves the current effective GVIC of the exact target resource. Parent or neighboring resource GVIC never substitutes.
GVIC24 - Assignment notifications are sent only for newly effective users or effective role changes; unchanged users, removals, unrelated users, and the actor receive none.
GVIC25 - GVIC event payloads identify policy type, action, descendant action, allocated sequence, mode, and changed recipients.
GVIC26 - Reads explain the stored mode, effective mode, source resource, active reset, and an inactive stored customization superseded by force overwrite.
GVIC27 - The frontend provides Inherited and Customized controls, both descendant actions, the effective source, overwrite explanation, stale-write protection, and no optimistic descendant materialization.
GVIC28 - Fingerprints include effective source identity and sequence, eligible reset identity and sequence, the parent-link boundary, live group-membership version, and actor-specific edit result where exposed.
GVIC29 - Point reads, My Work, notification decisions, and cache validation derive current state at read time; policy writes stay constant-size with descendant count.
GVIC30 - Resource deletion deletes its settings row and cascades its GVIC edges. No missing resource, user, or group identity can remain.
GVIC31 - Shared inbox folder and shared inbox GVIC use their exact canonical resource identities and remain separate from permissions and mailbox credentials.
GVIC32 - Logic Gate work may expose its effective Generated user as request-owner metadata, but that field never implies permission.
GVIC33 - Email-derived and workspace-created resources apply creator rules only after their final parent placement so copied policy comes from the correct source.
GVIC34 - Stale in-flight reads cannot overwrite a newer committed policy response; ETags and policy fingerprints track the resolved V2 state.
GVIC35 - Step 2 runtime readers and writers use only the two canonical GVIC tables. Temporarily retained legacy tables are frozen rollback evidence and have no deployed reader or writer.
GVIC36 - All GVIC changes and their settings, graph edges, events, and read-version effects commit atomically.
GVIC37 - The editor keeps the four role columns compact; inherited policy is read-only until Customized is selected.

## Scenarios

### Scenario GVIC-S1: Role Validation And Access Levels

Business logic covered:
- GVIC1
- GVIC2
- GVIC3
- GVIC4
- GVIC5
- GVIC6
- GVIC7
- GVIC19
- GVIC22

Given:
- A company assigns users and groups to nodes, logic gates, projects, and supported shared resources.
- Requests include valid roles, aliased/cased role input, and invalid roles.

Expected:
- Generated, verified, consulted, and informed are accepted after normalization.
- Invalid roles, resource types, principal types, or missing IDs are rejected.
- Generated and verified do not produce edit/delete permission access.
- Consulted and informed do not produce edit permission access.
- Resource authorization remains controlled by permission policy: default access, direct user rows, and group rows.
- Different principals can hold different GVIC roles on the same resource without losing the role meaning.
- Node and Logic Gate Generated rejects groups and keeps one user; Verified rejects groups but accepts multiple explicit users.

### Scenario GVIC-S2: Group Expansion And Removal

Business logic covered:
- GVIC8
- GVIC9
- GVIC17
- GVIC18
- GVIC23
- GVIC37

Given:
- A group has members and a GVIC assignment on a resource.
- One user also has a direct GVIC assignment.
- A user is removed from the group and a GVIC assignment is later deleted.

Expected:
- Group assignments expand into effective user assignments for current group members.
- Effective records preserve whether access came from direct or group source.
- Removing the user from the group removes only the group-derived effective access.
- Removing the GVIC edge removes that source principal from future effective resolution.
- No permanent effective or projection row is updated or retimestamped.
- Current nested membership is expanded on each canonical read.
- Group membership or parent changes update the company group fingerprint without changing resource customization sequences.

### Scenario GVIC-S3: Canonical Resolution Without Descendant Materialization

Business logic covered:
- GVIC10
- GVIC11
- GVIC12
- GVIC13
- GVIC14
- GVIC15
- GVIC16
- GVIC35

Given:
- A Logic Gate has inherited and customized Node descendants.
- A regular Logic Gate GVIC edit is saved with inherited-only Apply.
- The user separately runs overwrite-all for that Logic Gate.
- A user later opens or refreshes My Work after GVIC assignments change.
- Another browser may retain stale My Work state until navigation or refresh.

Expected:
- A regular edit updates one complete Logic Gate policy; inherited Nodes see it and active customized Nodes do not.
- Inherited-only Apply adds no descendant state or graph writes.
- Overwrite-all updates one descendant-reset sequence and makes eligible older Node customizations inactive without walking assigned Nodes.
- Project, Node, and shared-resource policy writes remain scoped to one settings row and one complete edge set.
- My Work derives current rows from V2 policy, hierarchy, live groups, permissions, and work metadata.
- No GVIC/My Work realtime policy scope or permanent effective/projection authority is created.
- My Work sees current effective state on its next canonical load.
- Independently required notification/domain-event consumers remain, but no generic browser refresh event is published.

### Scenario GVIC-S4: Shared Inbox GVIC And Permission Separation

Business logic covered:
- GVIC20

Given:
- A shared inbox has GVIC assignments and separate resource permission grants.

Expected:
- GVIC assignment reads and writes preserve GVIC records.
- Updating shared inbox access does not convert GVIC assignments into ordinary permission grants.

### Scenario GVIC-S5: Complete Writes And Logic Gate Cache Freshness

Business logic covered:
- GVIC23
- GVIC24
- GVIC25
- GVIC26
- GVIC27
- GVIC28
- GVIC34

Given:
- A logic gate has generated, verified, consulted, and informed GVIC assignments.
- A user adds or removes one assignment through the canonical complete-policy PUT.
- The user separately invokes inherited-only Apply or overwrite-all.
- A broad Logic Gate payload or workspace list request may already be cached or in flight.
- An inherited Node is assigned to the Logic Gate and another Node owns an active customization.

Expected:
- The write replaces one complete customized edge set and its sequence in one transaction.
- Inherited-only Apply writes no descendant state; overwrite-all changes one reset sequence.
- No permanent effective or My Work authority rows are maintained.
- Editable GVIC chips and mode/source explanations reconcile from the canonical response.
- My Work and other non-live views resolve current state on open or refresh.
- Stale broad Logic Gate payloads, stale workspace list cache entries, and stale in-flight reads cannot overwrite newer Logic Gate GVIC assignments.
- Logic Gate and Node GVIC follow the same freshness contract.
- The inherited Node resolves the Logic Gate live; the customized Node remains independent until an eligible overwrite-all reset.
- Parent-link, reset, group-version, actor, and effective-source fingerprints prevent unsafe 304 responses.
- The canonical response remains authoritative without pretending descendants were individually rewritten.

### Scenario GVIC-S6: Node Logic Gate Inheritance, Detach, My Work, And Updates

Business logic covered:
- GVIC21
- GVIC28
- GVIC29
- GVIC30
- GVIC31
- GVIC32
- GVIC33
- GVIC34
- GVIC35
- GVIC36
- GVIC29

Given:
- A standalone customized Node has its own GVIC policy.
- An inherited Node and the customized Node are placed into a Logic Gate with a different policy.
- The Logic Gate GVIC changes after both Nodes have entered.
- The Logic Gate change is saved normally and may later be force-overwritten through descendants.
- One subtree is moved after an older reset.
- The inherited Node is later detached from the Logic Gate.
- Project, logic gate, and node updates are shown in Updates.

Expected:
- Placing either Node advances its parent-link sequence without replacing an active customized policy.
- The inherited Node follows the Logic Gate live; the customized Node stays independent on an ordinary parent edit.
- Selecting Customized on an inherited Node copies the raw effective source once, preserving group pointers, before edits.
- Overwrite-all changes one Logic Gate reset sequence and can supersede older customized descendants without row fanout.
- A parent link created after an older reset protects the moved subtree until a later reset.
- Detaching the inherited Node materializes its current effective policy as a customized Node policy in the same transaction.
- My Work shows the node only when the user's effective node GVIC includes that node; parent project or logic gate GVIC only provides grouping and context.
- Project GVIC does not flow down into logic gates or nodes.
- Updates visibility uses the GVIC/access rules of the updated target: project updates use project GVIC, logic gate updates use logic gate GVIC, and node updates use node effective GVIC.

### Scenario GVIC-S7: Live Inheritance And Sequence-Scaled Descendant Actions

Business logic covered:
- GVIC6
- GVIC7
- GVIC8
- GVIC10
- GVIC11
- GVIC12
- GVIC13
- GVIC14
- GVIC15
- GVIC18
- GVIC26
- GVIC28
- GVIC29

Given:
- A parent resource has configured GVIC assignments.
- Some descendants are inherited and one child has a different customization.
- The parent is saved normally, inherited-only Apply is selected, then overwrite-all is separately confirmed.
- The child is customized again after the reset and another subtree is moved after the reset.

Expected:
- New non-root resources start inherited and store no copied GVIC edges.
- Editing a parent changes inherited branches live and stops at the active customized child.
- Inherited-only Apply adds no policy state and performs no descendant writes.
- Overwrite-all changes one reset sequence and makes eligible older customizations inactive without deleting their dormant rows.
- A later child customization copies the then-current effective source, applies its changes, and becomes independent again.
- A subtree moved after the reset is protected by its newer parent-link sequence.
- Point reads explain the effective source, eligible reset, and any inactive stored customization.
- Write count stays constant as modeled descendant count grows.
- Group GVIC assignments remain group pointers and are not expanded into one source row per user.
- GVIC explanations identify source policy, direct/group principal, live membership, reset, and parent-link boundary.

### Scenario GVIC-S8: Minimal Logic Gate Work Request Owner

Business logic covered:
- GVIC21
- GVIC28
- GVIC32
- GVIC34

Given:
- A Logic Gate has one Generated user and an Arena work snapshot is cached.
- The Generated assignment changes while an older work request is still in flight.

Expected:
- The work header contains the current Generated user's ID as `request_owner_user_id`.
- The payload contains no full GVIC assignment collection.
- The assignment/policy change invalidates the gate work version and reconciles the shared cached snapshot.
- The stale response cannot overwrite the newer request owner.
- Request-owner metadata does not grant any resource permission flag.

### Scenario GVIC-S9: Email Node Creator Ownership And Normal GVIC

Business logic covered:
- GVIC29
- GVIC17
- GVIC33

Given:
- An ordinary standalone Node and an email-collaboration Node both exist.
- A participant joins the email collaboration through a direct or group mention.
- The creator submits the first priority-bearing email comment, a participant later joins through a direct or group mention, and an authorized caller edits GVIC on both Nodes.

Expected:
- The ordinary standalone Node retains editable Node GVIC source assignments.
- Email Node creation gives the creator direct Generated GVIC, and later generic GVIC mutations follow the same authorized Node rules as the ordinary Node.
- Mention participation remains a permanent collaboration access grant but creates no GVIC assignment unless a separate GVIC command assigns one.
### Scenario GVIC-S10: Narrow Entity Headers Preserve The Compact GVIC Row And More-Owned Bulk Action

Business logic covered:
- GVIC12
- GVIC27
- GVIC37

Given:
- A Node or Logic Gate editor shows the four shared GVIC role cards.
- An adjacent pane narrows the available editor width.
- A Logic Gate user can access the apply-to-assigned-nodes action.

Expected:
- Generated, Verified, Consulted, and Informed remain in one horizontal row that may be clipped rather than wrapping vertically.
- No apply/current-GVIC card appears in the header body.
- The Logic Gate bulk action remains in **More editor actions** with its existing permission, disabled, busy, and error handling.
- Selecting that action opens an explicit Yes/No confirmation.
- Choosing No, canceling, or dismissing performs no write.
- Only choosing Yes records the overwrite-all reset sequence; no assigned Node policy rows are individually rewritten.

### Scenario GVIC-S11: Editor-Owned Routing And Target-Only Assignment Updates

Business logic covered:
- GVIC36
- GVIC23
- GVIC24

Given:
- A Node is inside a Logic Gate and their current GVIC assignments differ.
- Node and Logic Gate editor actions are committed.
- Bob is newly assigned, Alice is unchanged, and Charlie is removed by a GVIC mutation.

Expected:
- Node actions use the Node's current effective roles and Logic Gate actions use the Logic Gate's current effective roles.
- Only Bob receives the assignment update; Alice, Charlie, unrelated users, and the actor do not.
- Group-backed assignments use the same effective-user delta rule without duplicating recipients.
