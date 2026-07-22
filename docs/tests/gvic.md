Last updated: 2026-07-21

# GVIC Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: partial backend coverage for role validation, Logic Gate-to-node GVIC snapshots, explicit Logic Gate GVIC apply-to-descendants, linked node editing, detach preservation, effective-row stability, group membership changes, and projection sync. Rule ID mapping is partial. Pointer-scaled descendant apply rules are documented as target behavior and are not yet proven by implementation tests.

## Business Logic

GVIC1 - GVIC supports the generated, verified, consulted, and informed roles.
GVIC2 - GVIC role input is normalized before validation.
GVIC3 - GVIC resource types include node, logic gate, project, shared triage folder, and shared inbox resources where that surface supports GVIC.
GVIC4 - GVIC principal types include user and group.
GVIC5 - A GVIC assignment requires company, resource type, resource ID, principal type, principal ID, and role.
GVIC6 - Generated and verified assignments identify GVIC responsibility/notification roles only; they do not imply edit permission, delete permission, or any other resource authorization.
GVIC7 - Consulted and informed assignments identify GVIC visibility/notification roles only; they do not imply edit permission or any other resource authorization.
GVIC8 - Group GVIC assignments expand into effective user assignments for group members.
GVIC9 - Effective GVIC assignment records preserve enough source/inheritance data to explain whether access came from a direct or group assignment.
GVIC10 - Updating logic gate GVIC applies precise effective-assignment deltas for the logic gate; unchanged effective rows must not be deleted, rewritten, or retimestamped.
GVIC11 - Updating logic gate GVIC updates the logic gate's GVIC template/effective rows only by default; it must not fan out to nodes that already have a node-level snapshot unless apply-to-descendants is set.
GVIC12 - Updating project, node, or shared resource GVIC applies precise effective GVIC and projection-row changes for affected users without rebuilding unaffected rows.
GVIC13 - My Work reads active work from the GVIC matrix projection table, not by guessing from UI state.
GVIC14 - My Work/GVIC has no product realtime scope or projection sequence; canonical reads return the current transactionally maintained rows.
GVIC15 - My Work loads canonical GVIC matrix rows on open/navigation/manual refresh; temporary cross-user staleness until then is accepted.
GVIC16 - GVIC assignment changes maintain canonical projections and independently required notification/domain-event consumers; they do not publish My Work or workspace browser events.
GVIC17 - Removing a user from a group removes the user's effective GVIC access that came only from that group.
GVIC18 - Removing a GVIC assignment removes the effective access/projection rows that were produced only by that assignment.
GVIC19 - A resource can have multiple GVIC roles across different principals without collapsing the role meaning.
GVIC20 - Shared inbox GVIC assignments must remain GVIC assignments and must not be converted into ordinary resource permission grants.
GVIC21 - A person or group can only have one GVIC assignment per each node or for each logic gate. So the same person/group can not be in, for example, Generated and Informed for the same node (same rule applies for logic gates). A node assigned to a logic gate owns its node-level GVIC snapshot after entry.
GVIC22 - Node and logic gate generated and verified assignments are single-user slots; they must use user principals, while consulted and informed can still use users or groups.
GVIC23 - GVIC write commands update source assignments and projection/effective read models in the same transaction using precise row changes, not broad table or subsection rebuilds.
GVIC24 - GVIC editor caches are patched from the canonical source-shaped write response for the edited resource; broad cached payloads must not overwrite newer GVIC assignments.
GVIC25 - Source-shaped assignment responses patch editable GVIC chips for the initiating browser. My Work and other non-live projection-backed views read canonical state when opened or refreshed.
GVIC26 - Stale in-flight reads or browser cache entries must not repopulate older Logic Gate GVIC data after a successful POST or PUT.
GVIC27 - Logic Gate GVIC and Node GVIC must follow the same cache freshness contract; Logic Gate GVIC must not depend on stale broad Logic Gate payloads when Node GVIC uses fresh resource GVIC data.
GVIC28 - Logic Gate GVIC is a template for nodes only at the moment a node enters that logic gate.
GVIC29 - Ordinary standalone nodes and ordinary linked nodes both own editable node GVIC source assignments.
GVIC30 - A node inside a logic gate displays and edits its node-level GVIC snapshot; it must not be read-only merely because it is linked to a logic gate.
GVIC31 - Creating a node inside a logic gate, placing a standalone node into a logic gate, or moving a node between logic gates replaces the node's GVIC source assignments with a snapshot of the target logic gate's current GVIC template.
GVIC32 - Detaching a node from a logic gate preserves the node-level GVIC snapshot.
GVIC33 - Existing linked nodes receive a one-time backfill snapshot from their current logic gate so current behavior is preserved, then the node decouples from future logic gate GVIC changes.
GVIC34 - Projects have their own GVIC for project visibility and updates, but logic gates and nodes do not inherit GVIC from projects.
GVIC35 - My Work membership is based on node effective GVIC only; project and logic gate data decorate and group visible node rows but do not hide or reveal node rows.
GVIC36 - Updates visibility is target-based: node events use node effective GVIC/access, logic gate events use logic gate GVIC/access, and project events use project GVIC/access.
GVIC37 - Group membership, group parent moves, and group deletion update effective GVIC for any resource that directly references the affected group, including Logic Gate templates and node snapshots.
GVIC38 - Logic Gate GVIC apply-to-descendants is an explicit one-shot bulk action available only from the shared **More editor actions** menu, not a persistent toggle, header-body control, or fifth GVIC card. The action opens an explicit Yes/No confirmation; No, cancel, or dismissal makes no change, while only Yes applies the Logic Gate's current GVIC template to nodes currently assigned to that Logic Gate by replacing each assigned node snapshot and refreshing affected node effective/projection rows.
GVIC39 - GVIC inheritance, overrides, transfers, and apply-to-descendants follow the same business semantics as permissions for every supported parent-child GVIC relationship.
GVIC40 - A parent GVIC policy is a template captured at create time or transfer time; existing children do not live-inherit future parent GVIC edits unless apply-to-descendants is set.
GVIC41 - Creating or transferring a GVIC-managed resource copies the direct target parent's current GVIC policy, not the root ancestor's policy.
GVIC42 - Editing a child resource's GVIC changes only that child; that edited child GVIC becomes the template for resources created or transferred directly under that child.
GVIC43 - Editing a parent GVIC without apply-to-descendants changes only that parent and future direct children; existing descendants keep their current GVIC policies.
GVIC44 - GVIC inheritance should be implementable as reusable policy/rule pointers or immutable rule versions, not as duplicated full GVIC assignment rows per descendant.
GVIC45 - GVIC apply-to-descendants should record changed rule applications for the subtree instead of rewriting a full GVIC policy for every descendant; the operation must remain feasible for subtrees with hundreds of thousands of descendants.
GVIC46 - Removing a GVIC rule with apply-to-descendants requires an explicit tombstone/delete application so older child or ancestor GVIC rules do not reappear.
GVIC47 - Apply-to-descendants overwrites existing descendant special GVIC rules for the same changed rule keys as of that operation; later descendant edits can override again until a newer ancestor apply occurs.
GVIC48 - Conflicting direct GVIC bindings and ancestor apply records resolve by a monotonic transaction sequence, not wall-clock time.
GVIC49 - Group GVIC assignments remain group pointers and must not be expanded into one source row per user.
GVIC50 - GVIC audit/explainability must identify whether a user's role came from a direct resource binding, create/transfer inheritance, ancestor apply-to-descendants, or group membership.
GVIC51 - Logic Gate Kanban work derives `request_owner_user_id` from the Logic Gate Generated user and does not serialize the full GVIC assignment collection.
GVIC52 - A direct Logic Gate GVIC assignment or Logic Gate GVIC policy revision invalidates that Logic Gate's dedicated work version so cached header/request-owner data cannot remain stale.
GVIC53 - The committed GVIC response patches or revalidates the initiating browser's cached Logic Gate work snapshot; a stale in-flight work response cannot overwrite a newer Generated-user change.
GVIC54 - The minimal Logic Gate work request-owner field is display/workflow metadata only and does not imply `can_edit`.
GVIC55 - Email-derived Nodes use normal editable Node GVIC semantics. First-comment creation atomically assigns the creator as direct Generated GVIC; accepted mention participation remains a separate collaboration access grant and does not itself add a GVIC role. Later authorized GVIC add/set/remove follows the ordinary Node contract.
GVIC56 - Shared Node and Logic Gate GVIC editors keep Generated, Verified, Consulted, and Informed in one compact four-column horizontal row. Narrow layouts may clip the row beneath an adjacent pane, but must not wrap cards vertically; the bulk Logic Gate action remains in More.
GVIC57 - Notification routing follows the editor/resource where the action occurs: Node editor mentions, urgent mentions, chat, and work-field updates use current effective Node GVIC; Logic Gate editor mentions and urgent mentions use current effective Logic Gate GVIC. Parent or neighboring resource GVIC never substitutes.
GVIC58 - A Node or Logic Gate GVIC mutation creates an assignment notification only for a user whose effective assignment was newly added or whose effective role changed. Unchanged existing users, removed users, unrelated users, and the actor receive no assignment notification.

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
- Node and logic gate generated and verified fields reject group principals and keep only one user for each role.

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
- Removing the GVIC assignment removes only effective access/projection rows produced by that assignment.
- Unchanged effective rows keep their original updated timestamps.
- Sync code may derive the desired effective set for comparison, but it must not delete and reinsert unchanged rows.
- Logic Gate templates and node snapshots that directly reference affected groups update through the same scoped group-resource delta path.

### Scenario GVIC-S3: Transactional Projection Without Realtime

Business logic covered:
- GVIC10
- GVIC11
- GVIC12
- GVIC13
- GVIC14
- GVIC15
- GVIC16
- GVIC38

Given:
- A logic gate has assigned nodes, node GVIC snapshots, and GVIC template assignments.
- A regular logic gate GVIC edit is saved.
- The user separately runs the one-shot apply-to-descendants action for that logic gate.
- A user later opens or refreshes My Work after GVIC assignments change.
- Another browser may retain stale My Work state until navigation or refresh.

Expected:
- Logic gate GVIC updates apply precise effective-assignment row changes for the gate template.
- Regular logic gate GVIC edits do not mutate existing assigned node snapshots or assigned-node matrix rows.
- The one-shot apply-to-descendants action updates currently assigned node snapshots and refreshes affected node effective/projection rows.
- Project, node, and supported shared resource GVIC changes apply precise GVIC/projection row changes for affected users.
- My Work reads from the GVIC matrix projection table.
- No GVIC/My Work realtime scope, event row, or projection sequence is created.
- My Work sees current rows on its next canonical load.
- Independently required notification/domain-event consumers remain, but no generic browser refresh event is published.

### Scenario GVIC-S4: Shared Inbox GVIC Compatibility

Business logic covered:
- GVIC20

Given:
- A shared inbox has GVIC assignments and separate resource permission grants.

Expected:
- GVIC assignment reads and writes preserve GVIC records.
- Updating shared inbox access does not convert GVIC assignments into ordinary permission grants.

### Scenario GVIC-S5: Precise Writes And Logic Gate Cache Freshness

Business logic covered:
- GVIC23
- GVIC24
- GVIC25
- GVIC26
- GVIC27
- GVIC28
- GVIC38

Given:
- A logic gate has generated, verified, consulted, and informed GVIC assignments.
- A user adds or removes one assignment through POST or PUT.
- The user separately invokes the one-shot apply-to-descendants action for the current Logic Gate GVIC template.
- A broad Logic Gate payload or workspace list request may already be cached or in flight.
- A node is assigned to the logic gate and receives a node-level GVIC snapshot from the logic gate's current template.

Expected:
- The write changes source assignments and affected projection/effective rows in one transaction.
- Effective assignment maintenance deletes only disappeared rows and inserts only new rows.
- Effective rows that still represent the same user, resource, role, source, and inheritance identity are not rewritten and keep their updated timestamps.
- Editable GVIC chips are patched from the source-shaped write response.
- My Work and other non-live projection-backed views load the current rows on open or refresh.
- Stale broad Logic Gate payloads, stale workspace list cache entries, and stale in-flight reads cannot overwrite newer Logic Gate GVIC assignments.
- Logic Gate and Node GVIC follow the same freshness contract.
- Linked node effective access resolves through the node's own copied snapshot rows after the node enters the logic gate.
- Regular Logic Gate GVIC add, remove, and set edits are template edits only for existing assigned nodes.
- When the explicit apply-to-descendants action runs, the same source-shaped write response remains authoritative for the edited Logic Gate; affected node snapshots are current on subsequent canonical reads.

### Scenario GVIC-S6: Node Logic Gate GVIC Snapshots, My Work, And Updates

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
- GVIC38

Given:
- A standalone node has its own GVIC assignments.
- The node is placed into a logic gate that has different GVIC assignments.
- The logic gate GVIC changes after the node has entered.
- The logic gate GVIC change is saved as a regular template edit.
- The one-shot apply-to-descendants action may be run after the template edit.
- A second node enters after the logic gate GVIC changes.
- The node is later detached from the logic gate.
- Project, logic gate, and node updates are shown in Updates.

Expected:
- Before placement, the standalone node GVIC is editable and controls the node's My Work visibility.
- When the node is placed into the logic gate, the node's GVIC assignments are replaced with a snapshot of the logic gate's current GVIC template.
- While the node is inside the logic gate, the node GVIC editor shows editable node-level assignments.
- Changing the parent logic gate GVIC as a regular template edit does not change the existing node's GVIC or My Work visibility.
- Running the explicit apply-to-descendants action updates existing assigned node snapshots and My Work visibility for affected users.
- Nodes created in or transferred into the logic gate after that change receive the logic gate's new GVIC template.
- My Work shows the node only when the user's effective node GVIC includes that node; parent project or logic gate GVIC only provides grouping and context.
- Detaching the node preserves the node-level GVIC snapshot.
- Project GVIC does not flow down into logic gates or nodes.
- Updates visibility uses the GVIC/access rules of the updated target: project updates use project GVIC, logic gate updates use logic gate GVIC, and node updates use node effective GVIC.

### Scenario GVIC-S7: GVIC Parent Templates And Pointer-Scaled Descendant Apply

Business logic covered:
- GVIC39
- GVIC40
- GVIC41
- GVIC42
- GVIC43
- GVIC44
- GVIC45
- GVIC46
- GVIC47
- GVIC48
- GVIC49
- GVIC50

Given:
- A parent resource has configured GVIC assignments.
- Existing descendants have their own GVIC policies.
- A child GVIC policy has been edited to differ from the parent.
- A parent GVIC edit is saved once without apply-to-descendants and once with apply-to-descendants.

Expected:
- New or transferred resources receive the direct target parent's current GVIC policy.
- Editing a child GVIC affects only that child and future resources directly created or transferred under that child.
- Saving a parent GVIC edit without apply-to-descendants changes only the parent and future direct children.
- Saving a parent GVIC edit with apply-to-descendants updates every current supported descendant for the changed GVIC rule keys.
- A copied child GVIC policy may be represented by policy/rule pointers or immutable rule versions instead of duplicated GVIC assignment rows.
- Apply-to-descendants records changed rule applications or tombstones for the subtree instead of materializing a full GVIC policy on every descendant.
- The apply operation overwrites descendant GVIC rules for the same changed keys, while unrelated child-specific GVIC rules remain unless the saved change removes or replaces them.
- Later descendant GVIC edits win over earlier ancestor applies until a newer ancestor apply is recorded.
- Group GVIC assignments remain group pointers and are not expanded into one source row per user.
- GVIC explanations identify whether a role came from a direct rule, create/transfer inheritance, descendant apply, or group membership.

### Scenario GVIC-S8: Minimal Logic Gate Work Request Owner

Business logic covered:
- GVIC51
- GVIC52
- GVIC53
- GVIC54

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
- GVIC55

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
- GVIC38
- GVIC56

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
- Only choosing Yes applies the current Logic Gate GVIC assignment snapshot to all currently assigned nodes.

### Scenario GVIC-S11: Editor-Owned Routing And Target-Only Assignment Updates

Business logic covered:
- GVIC36
- GVIC57
- GVIC58

Given:
- A Node is inside a Logic Gate and their current GVIC assignments differ.
- Node and Logic Gate editor actions are committed.
- Bob is newly assigned, Alice is unchanged, and Charlie is removed by a GVIC mutation.

Expected:
- Node actions use the Node's current effective roles and Logic Gate actions use the Logic Gate's current effective roles.
- Only Bob receives the assignment update; Alice, Charlie, unrelated users, and the actor do not.
- Group-backed assignments use the same effective-user delta rule without duplicating recipients.
