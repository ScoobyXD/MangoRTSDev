# Signup/Login

1. The login page must show Sign Up with Email and Create password, and Sign In with Email and Password.
2. Public signup must create an email/password Cognito account and require email confirmation before issuing a Mango session.
3. The original signup page may hold the submitted password only in memory while waiting up to ten minutes for confirmation; cancellation, timeout, or leaving the page must stop that wait.
4. After confirmation, the waiting browser must authenticate with the submitted password; a closed or refreshed page must require ordinary sign-in.
5. The first authenticated request by a user without memberships must create exactly one company and a company-admin membership atomically across retries and concurrent requests.
6. Public company setup must use the fixed company-admin role; only the explicit server bootstrap allowlist may grant dev-admin.
7. Additional manual company creation must require dev-admin authority.
8. New Mango users must have mailbox access disabled, regardless of signup path or later company invitations.
9. Signup and product access must not require Google Audience, a Google account, Nylas, a mailbox grant, or an invitation.
10. Dev-admins and company-admins may invite company-admins, managers, or users; company-managers may invite only managers or users in their own company.
11. Invitation emails must normalize before storage and comparison; an existing company member cannot receive a duplicate invitation.
12. A new pending invitation for the same company and email must revoke older pending invitations.
13. Token validation must reject expired, revoked, accepted, or unknown invitations before exposing their details or changing membership.
14. Invitation creation must send the Mango invitation email without pre-creating a Cognito account or password.
15. A new invited user must set a password through the valid invitation and join only the invited company; the email invitation proves possession of the invited address.
16. Any existing Mango or Cognito account must authenticate with its own password before joining another company; an invitation must never replace an existing account password.
17. Authenticated invitation acceptance must match the invited email and preserve the user's profile, existing memberships, and each existing company role.
18. An accepted invitation must select its company, and Settings must allow switching among the user's permitted companies.
19. Signup and invitation acceptance must not create folder-share rows or bypass resource permissions in an existing company.
20. Password recovery must use Cognito directly and work before a confirmed account has created its Mango profile.
21. Company-admins may remove other members in their company; company-managers may remove only other managers or users; neither may remove a dev-admin.
22. Ordinary membership removal must fail before any change if it would remove the user's last company membership.
23. Only dev-admin may explicitly delete another entire account and its Cognito identity; self-deletion remains prohibited.
24. An invalid new invitation password must fail before Cognito account creation and return its readable password rule without exposing the raw provider response.

## Process Story

An uninvited user chooses an email and password, confirms the email, and enters their own company as its admin. An invited user opens the invitation and either creates a password or signs in with their existing password, then joins the invited company. Existing memberships remain available. New users never connect or load a mailbox.

## Scenarios

1. **Public signup:** Confirm on another device while the original page remains open. That page signs in, creates one company, and opens Mango without mailbox requests. Refreshing after confirmation instead requires the chosen password.
2. **Invitation:** A new invitee joins the target company without an extra personal company. An existing user keeps their original memberships and profile. An existing Cognito-only account must sign in instead of having its password overwritten.
3. **Membership lifecycle:** A company admin can remove a user who belongs to another company. Removing the last membership fails. Dev-admin's explicit whole-account deletion remains separate.

Validation: focused browser signup/invitation tests, HTTP auth tests, and memory/PostgreSQL store contract tests. Real Cognito email delivery and cloud rollout require a separately authorized deployment.
