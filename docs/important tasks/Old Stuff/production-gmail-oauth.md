# Production Gmail OAuth Verification

## Status

MangoRTS local email connection through Nylas now works with the dev Nylas app and Google connector.

The current Google OAuth app is still in Testing mode. That is acceptable for local/dev and controlled pilots, but it is not acceptable for broad customer onboarding.

## Why This Matters

MangoRTS communications relies on users connecting their own Gmail or Google Workspace mailbox through Nylas. Before MangoRTS can onboard many customer companies and users, the Google OAuth path must be production-ready.

While the Google OAuth app is in Testing mode:

- Only manually added Google test users can connect.
- The current Google Cloud UI shows a 100 lifetime test-user cap.
- Customer Google Workspace admins may block unverified/test apps.
- This does not support public self-serve onboarding or large customer rollouts.

## Decision Path

Preferred path:

- Ask Nylas to enable Nylas Shared GCP Project / shared Google OAuth credentials for MangoRTS.
- This should reduce the need for MangoRTS to immediately complete its own Google security review.
- Confirm whether this requires a different Nylas contract tier or account approval.

Backup/control path:

- Complete MangoRTS-owned Google OAuth verification for the MangoRTS Google Cloud app.
- Because MangoRTS needs Gmail scopes such as `gmail.modify`, `gmail.send`, and `gmail.labels`, Google verification and possibly a restricted-scope security assessment may be required.
- This path gives MangoRTS more direct control, but it is slower and may involve compliance cost.

## Immediate Tasks

1. Contact Nylas support/account manager.

   Ask:

   ```text
   MangoRTS is building B2B SaaS email workflows using the Nylas Email API.
   We need production-scale Gmail OAuth for many customer companies and users.
   Can you enable the Nylas Shared GCP Project / shared Google OAuth credentials for our dev and production Nylas apps?
   If not, what contract tier, approval, or Google verification path is required?
   ```

2. Prepare MangoRTS-owned verification in parallel.

   Required prep:

   - Verify the `mangorts.com` domain in Google Cloud.
   - Publish a public privacy policy.
   - Publish terms of service.
   - Finish Google OAuth consent branding.
   - Document exactly why each Gmail scope is needed.
   - Record a short demo video showing the OAuth flow and email features.
   - Prepare security/data-handling notes for restricted-scope review.

3. Keep OAuth scopes narrow.

   Current needed scopes:

   - `gmail.modify`
   - `gmail.send`
   - `gmail.labels`

   Avoid broader scopes unless a feature truly needs them.

4. Keep pilots controlled until production OAuth is resolved.

   A 15-user pilot can work by adding those user emails as Google test users, but this does not scale beyond controlled testing.

## Done Criteria

This task is done when one of these is true:

- Nylas Shared GCP Project is enabled and confirmed to support production customer Gmail onboarding.
- MangoRTS-owned Google OAuth verification is approved, required Gmail scopes are approved, and any required security assessment is complete.

## References

- Nylas Google provider guide: https://developer.nylas.com/docs/provider-guides/google/
- Nylas Google verification and security assessment guide: https://developer.nylas.com/docs/provider-guides/google/google-verification-security-assessment-guide/
- Google restricted scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Google Gmail API scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
