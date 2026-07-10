# Calendar Invite RSVP

Last updated: 2026-07-10

Status: RSVP slice implemented in code; provider scope rollout/reconnect requires explicit approval, and a full calendar workspace remains a separate task.

## Delivered

- Detect `.ics` and `text/calendar` invitations in My Triage, Shared Triage, and node-attached email.
- Present Accept, Tentative, and Decline actions.
- Read the authenticated message's raw MIME on the backend instead of trusting client-supplied event or grant IDs.
- Decode calendar MIME parts, unfold iCalendar lines, require `METHOD:REQUEST`, require exactly one `VEVENT`, and extract `UID`.
- Recover and cache bare calendar MIME parts even when the provider also reports ordinary attachments.
- Resolve the event through Nylas by iCalendar UID and reject missing or ambiguous matches.
- Send provider-neutral Nylas RSVP statuses `yes`, `maybe`, and `no` with duplicate Nylas email notification disabled.
- Apply the per-mailbox provider request gate separately to MIME lookup, event lookup, and RSVP mutation.
- Preserve personal/shared mailbox authorization boundaries; Shared Triage response requires edit access.

## Provider Boundary

- Google default application scope already includes Calendar access.
- Microsoft default application scope now includes `Calendars.ReadWrite`.
- Explicit environment/Terraform scope overrides and existing grants may still omit calendar access. Updating those values, changing Nylas settings, and reauthorizing production accounts require Jonat's explicit approval and must be performed through the human deployment path.
- New Shared Triage conversions retain `shared_inbox_id` and `account_email`, personal manual-picker attachments retain the active `account_email`, and email-node transfers preserve existing provenance. That scope is threaded through message, thread, attachment, reply, and RSVP calls. Legacy projections without provenance continue to use their original personal-mailbox behavior; shared legacy records must be reattached before shared-node RSVP can be guaranteed.

## Follow-up: Calendar Workspace

- Add calendar/event list APIs, timezone-aware day/week/month views, event create/edit, availability, recurrence, reminders, and provider error states.
- Reuse Nylas across Google Calendar and Microsoft Outlook rather than adding separate provider SDKs.
- Add event webhooks/cache invalidation and reconnect messaging for insufficient calendar scopes.
- Do not change production Nylas/provider settings or infrastructure without explicit confirmation.

## Verification

- Parser, personal-grant success, and shared view-only denial tests: `backend/internal/http/calendar_invite_handlers_test.go`.
- Nylas request tests: `backend/internal/http/nylas_client_test.go`.
- Run backend and full repository tests after local shell recovery.
