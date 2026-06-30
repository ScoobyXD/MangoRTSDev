# Signup/Login

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (invite creation, invite acceptance, password reset, and folder-share rejection have handler coverage; rule IDs are not mapped to automated tests yet)

## Business Logic

SL1 - A Mango account is created by accepting a Mango invitation, not by manually adding a user to Google OAuth test users or Cognito alone.
SL2 - Creating a company invitation requires dev-admin or company-admin authority for the target company.
SL3 - Invitation emails are normalized before storage, token validation, and acceptance comparison.
SL4 - Invitation roles normalize to supported company roles only.
SL5 - Existing members of the target company cannot be invited to that same company again.
SL6 - Creating a new pending invitation for the same company/email replaces the older pending invitation.
SL7 - Invitation validation checks token existence, status, replacement, and expiration before exposing invite details.
SL8 - Unauthenticated invite acceptance validates token, display name, invited email, and password before setting the Cognito password.
SL9 - After Cognito accepts the password, Mango writes only core identity, company membership, invitation acceptance, and related access recomputation.
SL10 - Invite acceptance must not activate Company Explorer shares, create folder permissions, or depend on Company Explorer legacy tables.
SL11 - Authenticated invite acceptance uses the authenticated Cognito subject and email instead of a submitted password.
SL12 - Login is not product access by itself; the current-user lookup must resolve a Mango user and memberships.
SL13 - Google connection is a post-signup mailbox/OAuth integration and must not create Mango account membership.
SL14 - Password reset eligibility is based on an existing Mango user, not merely an external Cognito or Google account.
SL15 - Company Explorer folder access must be granted only to existing Mango users who already belong to the company, through the permissions model rather than signup side effects.
SL16 - Invite acceptance must store a nonblank Mango display name, and later login or page-refresh auth resolution must not overwrite that Mango-owned display name with blank or email fallback token data.

## Scenarios

### Scenario SL-S1: Company Invitation Creation

Business logic covered:
- SL1
- SL2
- SL3
- SL4
- SL5
- SL6

Given:
- A company manager invites an email address to a company.
- The email address may already have external Google or Cognito state.
- A previous pending invitation may exist for the same company/email.

Expected:
- Only authorized company managers can create the invitation.
- Email and role input normalize before storage.
- Existing company members are rejected.
- The newest pending invitation replaces the prior pending invitation.
- External provider setup alone does not create a Mango user or membership.

### Scenario SL-S2: Invite Acceptance Creates Mango Access

Business logic covered:
- SL7
- SL8
- SL9
- SL10
- SL11
- SL12
- SL16

Given:
- A user opens an invite link and submits name, invited email, and password.
- The invite token may be valid, expired, accepted, replaced, or invalid.
- Cognito may already contain a user record for the email.

Expected:
- Invalid, expired, accepted, or replaced tokens are rejected before Mango membership changes.
- Email mismatch is rejected before Cognito password setup.
- Cognito password setup must succeed before Mango creates or updates the user and membership.
- Mango invite acceptance writes identity, membership, acceptance status, and access recomputation only.
- The accepted display name is stored as Mango-owned profile data.
- Invite acceptance does not read or write Company Explorer folder-share tables.
- After login, current-user loading must resolve the Mango user and memberships.
- Later page refreshes and `/v1/me` calls preserve the accepted display name instead of rewriting it from token fallback data.

### Scenario SL-S3: Login And Google Connection Boundaries

Business logic covered:
- SL12
- SL13
- SL16

Given:
- A user can authenticate with Cognito.
- The same email may be present in Google OAuth test users.
- The user may or may not have accepted a Mango invitation.

Expected:
- Cognito authentication alone is not enough to enter product surfaces.
- Mango access requires a Mango user row and company membership.
- Current-user loading may resolve the user and memberships, but it must not treat page refresh as a display-name profile edit.
- Google OAuth connection happens after signup and does not backfill account membership.

### Scenario SL-S4: Password Reset Eligibility

Business logic covered:
- SL14

Given:
- A password reset is requested for an email address.
- One email belongs to an existing Mango user and another exists only outside Mango.

Expected:
- Existing Mango users can start the reset flow.
- Emails without a Mango user are rejected even if they exist in an external identity provider.

### Scenario SL-S5: Company Explorer Access Is Not Signup

Business logic covered:
- SL10
- SL15

Given:
- A company manager attempts to share an Explorer folder by email.
- The target email may not belong to a Mango user or may belong to a user outside the company.

Expected:
- Missing Mango users and users outside the company are rejected.
- No Mango invitation or Cognito user is created from Explorer folder sharing.
- Signup does not activate pending Explorer shares or depend on dropped legacy Explorer tables.
- Existing company users receive Explorer access through the current permissions model.
