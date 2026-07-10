# Email Thread Viewer Parity

Last updated: 2026-07-10

Status: implemented in this branch; automated execution pending local shell recovery.

## Scope

- Keep node-attached email behavior aligned with My Triage and Shared Triage.
- Show complete thread sender, To, Cc, and Bcc metadata.
- Provide Reply and Reply all on the exact message being answered.
- Keep one stable reply draft per mailbox/message scope and retain the original message with saved reply drafts.
- Reconcile and delete superseded remote reply-draft rows so an older duplicate cannot reappear.
- Show provider and Mango attachments without storing file bytes in projections.
- Resolve CID screenshots in email bodies, expose image download on selection, and open images full-screen on double-click.
- Provide an explicit `Expand all threads` action.
- Focus the unified reply editor as soon as Reply or Reply all opens.
- Preserve selection-to-chat/create-node actions when rich email bodies use the screenshot-capable iframe viewer.
- Make the node email-count viewer use the available viewport.
- End reply-editor resize tracking on pointer-up, pointer-cancel, lost pointer capture, or window blur.
- Add red `Remove from node` context actions for attached-email and attachment rows.

## Implementation

- `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`
- `frontend/src/modules/editor/NodeWorkspaceSurface.tsx`
- `frontend/src/modules/editor/NodeWorkspaceSurfaceShared.tsx`
- `frontend/src/modules/editor/editorProjection.ts`
- `frontend/src/modules/project-management/ProjectSummaryContent.tsx`
- `frontend/src/pages/home/HomeParts.tsx`
- `frontend/src/pages/home/homeMailDrafts.ts`
- `frontend/src/modules/attachments/attachmentApi.ts`
- `backend/internal/http/communications_triage_handlers.go`
- `backend/internal/store/memory_communications_triage.go`
- `backend/internal/store/postgres_communications_triage.go`

## Acceptance

- Reply all includes the sender/reply-to plus every visible original To/Cc recipient, deduplicated case-insensitively. Bcc is displayed when supplied by the provider but is not copied into Reply all.
- Shared Triage conversions persist `shared_inbox_id` and `account_email`; personal manual-picker attachments persist the active `account_email`. Node/project reads, downloads, replies, and calendar responses use that originating mailbox scope.
- Selecting another row and returning to a reply resumes the single semantic reply draft for that mailbox/message scope.
- Saved reply drafts show the source email; legacy drafts fetch it by `replyToMessageID` when the embedded snapshot is absent.
- Inline and attached images use authenticated attachment reads. Projection and durable draft state retain references only.
- All rich-editor surfaces inherit image caret placement, dragging, and resizing from the shared editor image implementation.

## Verification

- Contract coverage: `tests/frontend/modules/editor/emailViewerContract.test.ts`.
- Run `node scripts/run_all_tests.mjs` once PowerShell process launch is available.
- Manually verify a personal thread, shared thread, node-attached thread, CID screenshot, file attachment, and Reply all with To/Cc recipients.
