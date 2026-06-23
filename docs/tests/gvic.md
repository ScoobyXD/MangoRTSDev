Last updated: 2026-06-23

# GVIC Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: partial backend coverage for role validation, pointer inheritance, inherited node read-only behavior, detach-empty behavior, effective-delta stability, and scoped projection sync. Rule ID mapping is partial.

## Business Logic

GVIC1 - GVIC supports the generated, verified, consulted, and informed roles.
GVIC2 - GVIC role input is normalized before validation.
GVIC3 - GVIC resource types include node, logic gate, project, shared triage folder, and shared inbox resources where that surface supports GVIC.
GVIC4 - GVIC principal types include user and group.
GVIC5 - A GVIC assignment requires company, resource type, resource ID, principal type, principal ID, and role.
GVIC6 - Generated and verified assignments imply edit-level access to the resource.
GVIC7 - Consulted and informed assignments imply view-level access to the resource.
GVIC8 - Group GVIC assignments expand into effective user assignments for group members.
GVIC9 - Effective GVIC assignment records preserve enough source/inheritance data to explain whether access came from a direct or group assignment.
GVIC10 - Updating logic gate GVIC applies precise effective-assignment deltas for the logic gate; unchanged effective rows must not be deleted, rewritten, or retimestamped.
GVIC11 - Updating logic gate GVIC applies precise GVIC matrix projection deltas for nodes assigned to that logic gate; projection fanout is allowed, but only changed projection rows may be inserted, updated, or deleted.
GVIC12 - Updating project, node, or shared resource GVIC applies precise effective access and projection deltas for affected users without rebuilding unaffected rows.
GVIC13 - My Work reads active work from the GVIC matrix projection table, not by guessing from UI state.
GVIC14 - GVIC matrix projection sequences are tracked per company and scope so clients can process ordered deltas.
GVIC15 - When a client detects a GVIC matrix sequence gap, it must fall back to a full reload.
GVIC16 - GVIC assignment changes publish or append events needed by My Work, Updates, and workspace clients.
GVIC17 - Removing a user from a group removes the user's effective GVIC access that came only from that group.
GVIC18 - Removing a GVIC assignment removes the effective access/projection rows that were produced only by that assignment.
GVIC19 - A resource can have multiple GVIC roles across different principals without collapsing the role meaning.
GVIC20 - Shared inbox GVIC assignments must remain GVIC assignments and must not be converted into ordinary resource permission grants.
GVIC21 - A person or group can only have one GVIC assignment per each node or for each logic gate. So the same person/group can not be in, for example, Generated and Informed for the same node (same rule applies for logic gates). However of course, when a node is assigned to a logic gate, then we defer the GVIC assignment of the node, to the logic gate's.
GVIC22 - Node and logic gate generated and verified assignments are single-user slots; they must use user principals, while consulted and informed can still use users or groups.
GVIC23 - GVIC write commands update source assignments and projection/effective read models in the same transaction using precise deltas, not broad table or subsection rebuilds.
GVIC24 - GVIC editor caches are patched from the canonical source-shaped write response for the edited resource; broad cached payloads must not overwrite newer GVIC assignments.
GVIC25 - Projection and realtime deltas are the cache update path for My Work and other projection-backed views; source-shaped assignment responses are the cache update path for editable GVIC chips.
GVIC26 - Stale in-flight reads or browser cache entries must not repopulate older Logic Gate GVIC data after a successful POST or PUT.
GVIC27 - Logic Gate GVIC and Node GVIC must follow the same cache freshness contract; Logic Gate GVIC must not depend on stale broad Logic Gate payloads when Node GVIC uses fresh resource GVIC data.
GVIC28 - Logic Gate pointer inheritance keeps source assignments on the logic gate; linked node effective access and My Work rows resolve through that gate without materializing copied child-node effective rows.
GVIC29 - A standalone node owns editable node GVIC source assignments.
GVIC30 - A node inside a logic gate inherits GVIC from that parent logic gate; node GVIC reads must display the parent logic gate assignments as inherited, read-only node assignments.
GVIC31 - Creating a node inside a logic gate, placing a standalone node into a logic gate, or moving a node between logic gates clears the node's standalone GVIC assignments and makes the node inherit from the current parent logic gate.
GVIC32 - Detaching a node from a logic gate makes it standalone with empty GVIC; old standalone GVIC assignments must not be restored.
GVIC33 - Node GVIC writes are rejected while the node inherits from a logic gate; users must update the parent logic gate GVIC instead.
GVIC34 - Projects have their own GVIC for project visibility and updates, but logic gates and nodes do not inherit GVIC from projects.
GVIC35 - My Work membership is based on node effective GVIC only; project and logic gate data decorate and group visible node rows but do not hide or reveal node rows.
GVIC36 - Updates visibility is target-based: node events use node effective GVIC/access, logic gate events use logic gate GVIC/access, and project events use project GVIC/access.

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
- Generated and verified produce edit-level access.
- Consulted and informed produce view-level access.
- Different principals can hold different GVIC roles on the same resource without losing the role meaning.
- Node and logic gate generated and verified fields reject group principals and keep only one user for each role.

### Scenario GVIC-S2: Group Expansion And Removal

Business logic covered:
- GVIC8
- GVIC9
- GVIC17
- GVIC18
- GVIC23

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

### Scenario GVIC-S3: Projection, Sequence, And Realtime

Business logic covered:
- GVIC10
- GVIC11
- GVIC12
- GVIC13
- GVIC14
- GVIC15
- GVIC16

Given:
- A logic gate has assigned nodes and GVIC assignments.
- A user has My Work open while GVIC assignments change.
- A client receives matrix deltas with and without sequence gaps.

Expected:
- Logic gate GVIC updates apply precise effective-assignment deltas for the gate and precise matrix projection deltas for assigned nodes.
- Project, node, and supported shared resource GVIC changes apply precise access/projection deltas for affected users.
- My Work reads from the GVIC matrix projection table.
- Projection sequence values are ordered per company and scope.
- Sequence gaps cause a full reload.
- GVIC changes publish or append refresh events for affected clients.

### Scenario GVIC-S4: Shared Inbox GVIC Compatibility

Business logic covered:
- GVIC20

Given:
- A shared inbox has GVIC assignments and separate resource permission grants.

Expected:
- GVIC assignment reads and writes preserve GVIC records.
- Updating shared inbox access does not convert GVIC assignments into ordinary permission grants.

### Scenario GVIC-S5: Delta Writes And Logic Gate Cache Freshness

Business logic covered:
- GVIC23
- GVIC24
- GVIC25
- GVIC26
- GVIC27
- GVIC28

Given:
- A logic gate has generated, verified, consulted, and informed GVIC assignments.
- A user adds or removes one assignment through POST or PUT.
- A broad Logic Gate payload or workspace list request may already be cached or in flight.
- A node is assigned to the logic gate and uses the logic gate's GVIC through pointer inheritance.

Expected:
- The write changes source assignments and affected projection/effective rows in one transaction.
- Effective assignment maintenance deletes only disappeared rows and inserts only new rows.
- Effective rows that still represent the same user, resource, role, source, and inheritance identity are not rewritten and keep their updated timestamps.
- Editable GVIC chips are patched from the source-shaped write response.
- My Work and projection-backed views update from projection or realtime deltas.
- Stale broad Logic Gate payloads, stale workspace list cache entries, and stale in-flight reads cannot overwrite newer Logic Gate GVIC assignments.
- Logic Gate and Node GVIC follow the same freshness contract.
- Linked node effective access resolves through the Logic Gate assignment without copied child-node effective rows.

### Scenario GVIC-S6: Node Logic Gate GVIC Inheritance, My Work, And Updates

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

Given:
- A standalone node has its own GVIC assignments.
- The node is placed into a logic gate that has different GVIC assignments.
- The node is later detached from the logic gate.
- Project, logic gate, and node updates are shown in Updates.

Expected:
- Before placement, the standalone node GVIC is editable and controls the node's My Work visibility.
- When the node is placed into the logic gate, the node's standalone GVIC assignments are cleared.
- While the node is inside the logic gate, the node GVIC editor shows the parent logic gate GVIC as inherited read-only rows and rejects direct node GVIC writes.
- Changing the parent logic gate GVIC immediately changes the linked node's effective GVIC and My Work visibility through pointer inheritance, without copying GVIC rows into the node.
- My Work shows the node only when the user's effective node GVIC includes that node; parent project or logic gate GVIC only provides grouping and context.
- Detaching the node makes it a standalone node with empty GVIC.
- Project GVIC does not flow down into logic gates or nodes.
- Updates visibility uses the GVIC/access rules of the updated target: project updates use project GVIC, logic gate updates use logic gate GVIC, and node updates use node effective GVIC.
