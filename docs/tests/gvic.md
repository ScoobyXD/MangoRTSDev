Last updated: 2026-06-22

# GVIC Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

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
GVIC10 - Updating logic gate GVIC recomputes effective access for the logic gate.
GVIC11 - Updating logic gate GVIC recomputes GVIC matrix projection data for nodes assigned to that logic gate.
GVIC12 - Updating project, node, or shared resource GVIC recomputes effective access and projection data for affected users.
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

Given:
- A group has members and a GVIC assignment on a resource.
- One user also has a direct GVIC assignment.
- A user is removed from the group and a GVIC assignment is later deleted.

Expected:
- Group assignments expand into effective user assignments for current group members.
- Effective records preserve whether access came from direct or group source.
- Removing the user from the group removes only the group-derived effective access.
- Removing the GVIC assignment removes only effective access/projection rows produced by that assignment.

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
- Logic gate GVIC updates recompute effective access for the gate and assigned nodes.
- Project, node, and supported shared resource GVIC changes recompute affected access/projection data.
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
