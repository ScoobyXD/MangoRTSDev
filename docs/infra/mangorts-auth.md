# MangoRTS Auth

MangoRTS uses Cognito email/password accounts and Mango-owned users, companies, and company memberships. Google and Nylas are optional legacy mailbox services for existing eligible accounts.

## Public signup

The custom login page has Sign Up and Sign In panels. Sign Up calls Cognito `SignUp` with email and password. Cognito sends its verification link and keeps the account unconfirmed until the recipient clicks it. The original signup page retries password authentication every ten seconds for at most ten minutes. The password stays only in page memory; leaving or refreshing the page requires normal sign-in afterward. Confirmation can happen on another device because the waiting page uses its own submitted password.

Both Terraform pool definitions enable self-signup, configure `CONFIRM_WITH_LINK`, and provide a Cognito pool domain for verification links. Authentication continues to use `USER_PASSWORD_AUTH`; no passwordless tier or Google setup is needed. The app has custom forms; Cognito serves the email-confirmation link using its default email template. Custom subject/body fields would require separately configured SES developer sending, so this change does not set them.

After authentication, the backend resolves the Mango user and memberships. A user with no memberships receives one `My Company` and a fixed company-admin membership. Company creation and membership insertion share a transaction and cross-process lock. Retries cannot create duplicate companies. Additional manual company creation remains dev-admin-only.

## Invitations and company roles

A dev-admin or company-admin can invite users with company-admin, company-manager, or company-user roles. A company-manager can invite managers or users. Mango stores the hashed invitation token and sends the invitation through its existing SES mailer; it does not pre-create a Cognito identity when sending an invite.

A new recipient opens the link and chooses a password. The valid invitation proves possession of that email, so the backend creates the confirmed Cognito identity and joins the invited company without creating another company. If either Mango or Cognito already has that account, the recipient must authenticate with the existing password. An invitation never resets an existing password. The submitted new password is validated as the temporary password during identity creation before being made permanent. If setup is interrupted between those calls, the user can authenticate with that chosen temporary password and complete the password challenge before joining.

Existing users gain the new company membership and keep their previous memberships, profile, and company roles. Settings selects and switches companies. Ordinary removal cannot remove a final company membership. Only dev-admin can delete another whole account and its Cognito identity; self-deletion is prohibited.

The server's explicit `MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS` allowlist is the sole initial dev-admin exception. Keep it limited to Jonat's controlled identity and clear it after bootstrap. Public forms and invitations cannot request dev-admin.

## Mailbox boundary

`users.mailbox_enabled` is an account policy. The migration preserves existing users as enabled, while future inserts default to false. Neither signup, auth refresh, invitations, nor company switching enables it. New accounts cannot connect Google/Nylas, load personal or shared mailbox data, or ingest personal email. Existing eligible mailbox users and their shared-company ingestion continue to work.

The sidebar does not request mailbox status at startup. Home Updates and RACI load independently; actual mail views and mailbox controls load their own data when needed. Transactional signup, invitation, and password-reset messages are separate from inbox ingestion and remain available.

## Passwords and sessions

Cognito owns password validation, confirmation, recovery (`ForgotPassword` and `ConfirmForgotPassword`), and token refresh. Recovery does not depend on a Mango profile already existing. The browser retains tokens in the existing `localStorage` session mechanism, never signup passwords. Protected API requests validate the Cognito token and company membership. Public invitation validation/acceptance, provider callbacks/webhooks, and health checks retain their dedicated validation paths.

## Required rollout

These are operator actions; editing the repository does not change a live environment.

A read-only check on 2026-09-06 found `ProductionAccessEnabled=false` and `SendingEnabled=true` for `mangorts-prod` in `us-west-1`. That SES account is still sandboxed. It needs one-time production access approval before Mango invitations can reach recipients without manual SES identity verification. Cognito confirmation is separate from SES recipient verification. [AWS SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)

1. Use the designated human-run schema process to apply `backend/db/migrations/20260906_user_mailbox_access.sql` before starting the new backend. It adds the flag with true for existing rows, then changes the insert default to false. Run it once, on supported PostgreSQL 17.x or later under the repository's database procedures.
2. Deploy the backend and frontend together with the matching schema. The canonical schema already gives newly initialized databases the false default.
3. Review and apply the appropriate Terraform environment separately. The shared module covers dev/QA; production uses `infra/aws-prod/cognito.tf`. This enables self-signup and creates the verification-link domain. Do not recreate the existing pool or app client.
4. Confirm real delivery to an ordinary external address for both Cognito confirmation/reset mail and Mango SES invitation mail. Cognito's default email delivery is quota-limited; inspect the deployed sending configuration and quota before a public launch. SES sandbox recipient restrictions, if present, must be removed through the normal human-operated setup.
5. Verify confirmation on another device signs in the waiting browser, a new user receives one company with no mailbox calls, an invitee joins the right company, and an existing mailbox user can still use Mail.

No live migration, Terraform apply, cloud setting change, or real account email send is part of the local implementation tests.

## Configuration

Frontend: `VITE_AUTH_MODE=cognito`, `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, and `VITE_API_BASE_URL`.

Backend: `AUTH_MODE=cognito`, the existing Cognito pool/client configuration, `MANGORTS_APP_URL` for invitation links, and `MANGORTS_EMAIL_FROM` for the verified SES sender. The existing backend identity needs scoped Cognito admin permissions for new invitation acceptance and explicit account deletion, plus SES invitation delivery.

For cloud-integrated local development use `scripts/start_local_cognito_backend.ps1` with the existing `mangorts-dev` AWS SSO profile. Keep development and production profiles separate. New signup does not require Nylas credentials or Google Audience membership; the legacy mail worker still uses its existing deployment configuration.

## Provider references

- [Cognito signup and confirmation](https://docs.aws.amazon.com/cognito/latest/developerguide/signing-up-users-in-your-app.html)
- [Cognito verification links and message templates](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-settings-message-customizations.html)
