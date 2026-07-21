# Product Business Rules and Test Coverage

## Updates: current and seen history

- “Seen”, opening a row from an inbox notification menu, clearing a notification menu, and “Seen all” archive notifications by setting `read_timestamp`. These actions must not delete notification rows.
- Current Updates queries return only notifications whose `read_timestamp` is null.
- Seen Updates queries return only notifications whose `read_timestamp` is set and whose `created_timestamp` falls inside the requested inclusive calendar-date range.
- The Seen Updates header first loads only the oldest/newest accessible seen timestamps. The two date sliders then request the selected window; the browser and API both cap one query to 90 calendar days, and the default window is the newest 30 days.
- Date filtering happens in the repository query before grouping. The UI must not load all historical rows and filter them in memory.
- Seen history keeps the same per-user, company, and current resource-access checks as Current Updates. Losing access hides historical rows without destroying them.
- Notification retention cleanup may remove expired unread rows, but it must not delete rows that a user archived as seen.
- Current and Seen modes use the same filters, grouping, row presentation, and resource navigation. Clicking a seen Node, Logic Gate, or Project update opens the referenced resource and passes the notification’s `information_id` so the note can be focused when that surface supports it.
- Physical notification deletion remains a separate explicit lifecycle operation and must not be used to implement “Seen”.

Automated coverage:

- Backend handler/store tests prove read rows leave Current Updates, appear in a bounded Seen Updates date query, expose aggregate date bounds, and survive retention cleanup.
- Frontend API and date-window tests prove only the selected dates are sent and both sliders enforce the 90-day maximum.
- The normal frontend build type-checks the Current/Seen toggle, optional Seen actions, and resource-opening callbacks.

## Inline editor mentions

- A newly inserted normal `@` mention creates one `mention.created` notification for the mentioned user.
- A newly inserted urgent `!` mention creates one `mention.urgent_created` notification.
- Node, Logic Gate, and Project text boxes follow the same rule in both supported editor storage modes: Tiptap JSON and legacy collaborative HTML.
- Retaining, moving, or removing an existing stable mention does not notify. Removing and later re-adding it creates a new occurrence and may notify again.
- A retry with the same editor operation ID is idempotent and must not create another notification.
- Mention notification recipients still require current effective edit access to the referenced resource.
- Ordinary editor saves and document deletion do not create generic Updates rows.

Automated coverage:

- JSON editor HTTP tests cover ordinary edits, stable retries, retain/remove/re-add behavior, normal and urgent mentions, and all three resource types.
- Legacy collaboration HTTP tests cover normal/urgent mention extraction and notification projection for Node, Logic Gate, and Project documents.
- Notification service tests cover mention identity resolution, access filtering, event mapping, and recipient projection.

## Verification commands

From the repository root:

```powershell
node scripts\run_all_tests.mjs
```

Focused development checks:

```powershell
cd backend
go test ./internal/http ./internal/store ./internal/notifications

cd ..\frontend
npm run test:node-relationships
npm run build
```
