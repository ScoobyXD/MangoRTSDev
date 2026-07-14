Last updated: 2026-07-13

# Users And User Groups Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

## Business Logic

UG1 - User role input is normalized before it is stored or compared.
UG2 - Owner and admin role aliases normalize to company admin.
UG3 - Manager role aliases normalize to company manager; member, agent, and blank role inputs normalize to company user.
UG4 - Dev admin and company admin roles bypass resource permissions; company manager does not.
UG5 - The current-user endpoint returns the user, company memberships, and dev-admin status.
UG6 - Company list and company creation require dev-admin authority.
UG7 - Company list limits default to 100 and clamp to the supported maximum.
UG8 - Listing company users requires access to that company.
UG9 - Onboarding list, invitation management, user deletion, and user group mutations require company manager, company admin, or dev admin authority.
UG10 - A company user cannot delete themself from the company.
UG11 - Deleting a company user removes that user's membership in the company.
UG12 - Deleting a company user removes the user's company group memberships.
UG13 - Deleting a company user removes or recomputes the user's company resource grants, permissions, GVIC assignments, effective assignments, and projections.
UG14 - External identity deletion is queued or completed only when the user has no remaining company membership or dev-admin ownership that must be preserved.
UG15 - User group lists return both groups and group members.
UG16 - Creating a user group requires company manager authority.
UG17 - Updating a user group requires company manager authority.
UG18 - Deleting a user group requires company manager authority.
UG19 - A user group's parent must exist in the same company.
UG20 - User group hierarchy changes cannot create parent cycles.
UG21 - Setting user group members replaces the full member list for that group.
UG22 - Every user added to a group must already belong to the same company.
UG23 - User group membership changes affect resources that directly reference the group: resource permissions resolve dynamically from group rows, and GVIC effective/projection rows are recomputed.
UG24 - Creating an invitation requires company manager, company admin, or dev admin authority.
UG25 - Invitation email addresses are normalized before storage and comparison.
UG26 - Invitation roles are normalized to an invitable company role.
UG27 - A user who is already a company member cannot be invited to the same company again.
UG28 - Creating a new pending invitation for the same email/company revokes or replaces the older pending invitation.
UG29 - Invitation validation checks token status and expiration.
UG30 - Accepting an invitation checks token, email, status, and expiration before creating or updating membership.
UG31 - Invitation delivery status is tracked separately from invitation acceptance status.
UG32 - Company managers can invite company users and company managers; only company admins and dev admins can invite company admins.
UG33 - Company managers can delete company users and company managers, but cannot delete company admins or dev admins.
UG34 - Deleting a user group removes permission and GVIC source rows that reference the deleted group/subtree and refreshes affected effective/projection rows.
UG35 - The email-collaboration chat mention picker may target an active same-company user or user group. The durable chat payload identifies selected principal IDs separately from display text so renamed users/groups and duplicate names cannot retarget a mention.
UG36 - At the accepted chat transaction, a valid group mention resolves the selected group's current active same-company user closure through the existing group hierarchy plus membership source rows, deduplicates users across direct and overlapping group mentions, and snapshots those user IDs as collaboration participants. A valid empty group adds no participant; a missing, deleted, or cross-company group is rejected.
UG37 - An email-collaboration group mention is deliberately different from the dynamic group pointers in UG23: later member/hierarchy changes do not add or remove collaboration participants, change Node access, or rewrite historical mention notifications.
UG38 - Mentioning an already-participating user is idempotent. The actor remains a participant but receives no self-mention notification; every other newly mentioned resolved user receives at most one notification for the committed chat.

## Scenarios

### Scenario UG-S1: Roles, Current User, And Company Access

Business logic covered:
- UG1
- UG2
- UG3
- UG4
- UG5
- UG6
- UG7
- UG8

Given:
- Users have dev-admin, company-admin, company-manager, and company-user roles.
- Role input includes aliases and blank values.

Expected:
- Role input normalizes before storage or comparison.
- Owner/admin aliases become company admin.
- Manager aliases become company manager.
- Member/agent/blank inputs become company user.
- Dev admins and company admins bypass resource permissions.
- Company managers do not bypass resource permissions.
- The current-user endpoint returns user, memberships, and dev-admin status.
- Company list/create requires dev admin.
- Company list limits default and clamp correctly.
- Company user listing requires access to that company.

### Scenario UG-S2: Delete Company User Cleanup

Business logic covered:
- UG9
- UG10
- UG11
- UG12
- UG13
- UG14
- UG33

Given:
- A company manager deletes another company user or company manager from the company.
- The user has group memberships, resource grants, permissions, GVIC assignments, and projection rows.
- The manager also attempts to delete themself.
- The manager also attempts to delete a company admin.

Expected:
- User deletion requires company manager authority.
- A user cannot delete themself.
- Deleting another user removes company membership and group memberships.
- Resource grants, permissions, GVIC assignments, effective assignments, and projections are removed or recomputed.
- External identity deletion is not performed while other memberships or dev-admin ownership must be preserved.
- Company managers cannot delete company admins or dev admins.

### Scenario UG-S3: User Group Hierarchy And Members

Business logic covered:
- UG15
- UG16
- UG17
- UG18
- UG19
- UG20
- UG21
- UG22
- UG23
- UG34

Given:
- A company has nested user groups and company users.
- A manager changes group hierarchy and member lists.
- Resources have permission and GVIC source rows that reference those groups.
- A request tries to add a user from another company.

Expected:
- Group listing includes groups and members.
- Group create, update, delete, and member changes require company manager authority.
- Parent groups must exist in the same company.
- Hierarchy changes cannot create cycles.
- Setting members replaces the full member list.
- Users from another company are rejected.
- Membership changes dynamically affect group permission rows and recompute group-derived GVIC projections.
- Deleting a group removes permission and GVIC source rows for the deleted group/subtree and refreshes affected rows.

### Scenario UG-S4: Invitations

Business logic covered:
- UG24
- UG25
- UG26
- UG27
- UG28
- UG29
- UG30
- UG31
- UG32

Given:
- A company manager invites a new user.
- A company manager invites a new manager.
- A company manager tries to invite a company admin.
- A company admin invites a company admin.
- The email casing varies between invite, validation, and acceptance.
- A pending invitation already exists for the same email/company.
- A token may be valid, expired, accepted, or revoked.

Expected:
- Invitation creation requires company manager authority.
- Emails and roles normalize before storage and comparison.
- Company managers can invite users and managers.
- Company managers cannot invite company admins.
- Company admins and dev admins can invite company admins.
- Existing company members cannot be invited again.
- A new pending invitation revokes or replaces the older pending invitation.
- Validation checks status and expiration.
- Acceptance checks token, email, status, and expiration before creating/updating membership.
- Delivery status is tracked separately from acceptance status.

### Scenario UG-S5: Email Collaboration User And Group Mentions

Business logic covered:
- UG15
- UG19
- UG20
- UG21
- UG22
- UG23
- UG35
- UG36
- UG37
- UG38

Given:
- A collaboration chat selects one company user and one nested company group whose resolved members overlap that user.
- Another selected group is valid but empty, and requests also try a deleted or cross-company group.
- Group membership changes after the chat commits.

Expected:
- Selected principal IDs, not display labels, identify mentions.
- The valid group resolves from current hierarchy/member source rows and each distinct current active same-company user is snapshotted once.
- The empty valid group adds nobody without inventing a user; deleted/cross-company groups are rejected.
- The actor receives no self-mention notification and retries/overlap produce no duplicate participant or notification.
- Later group changes still affect dynamic resource permission/GVIC group pointers under UG23 but do not affect the collaboration snapshot.
