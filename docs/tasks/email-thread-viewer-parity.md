# Email Thread Viewer Parity

Last updated: 2026-07-14

Status: canonical reconciliation and compact chronological timeline implemented on `codex/fix-email-thread-reply-timeline0000580`; final repository verification is recorded in the worker commit/report.

## Scope

- Keep node-attached email behavior aligned with My Triage and Shared Triage.
- Treat provider, collaboration, detail-cache, and local sent-reply objects as representations that must be reconciled before rendering.
- Render one visible item per canonical scoped message without content-hash collapsing distinct provider IDs.
- Default the conversation to oldest-to-newest chronology, expand the newest message, and bring it into view.
- Show complete thread sender, To, Cc, and Bcc metadata when a message is expanded.
- Provide Reply, Reply all, Create shared draft, and Forward on the exact message being acted on without repeating four permanent large buttons on every row.
- Keep one stable reply draft per mailbox/message scope and retain the original message with saved reply drafts.
- Show provider and Mango attachments once under the canonical message that owns them without storing file bytes in projections.
- Resolve CID screenshots in email bodies, expose image download on selection, and open images full-screen on double-click.
- Keep the full sanitized provider body available through `Show quoted history` while authored content remains the default projection.
- Provide an explicit `Expand all threads` action and preserve selection-to-chat/create-node behavior.

## Canonical identity contract

- Exact identity is mailbox scope plus message ID. Repeated preview/detail/collaboration hydration for that identity merges to the richest representation.
- A local/provisional reply may reconcile into exactly one authoritative provider/collaboration message only when thread, normalized subject, authored body, From/To/Cc/Bcc, non-inline attachment fingerprint, and send time agree within the bounded window.
- Distinct authoritative provider IDs remain distinct even if their visible text is identical. Content similarity alone is never a deletion rule.
- Reconciliation changes only the display projection. It does not rewrite stored provider bodies, attachment records, or reply/forward source messages.

## Implementation

- `frontend/src/modules/communications/emailThreadMessages.ts`
- `frontend/src/modules/communications/emailQuotedContent.ts`
- `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`
- `frontend/src/pages/home/HomeParts.tsx`
- `frontend/src/pages/home/homeStyles.ts`
- `frontend/src/pages/home/homeMailDrafts.ts`
- `frontend/src/modules/attachments/attachmentApi.ts`

No backend or database/schema change is required for this reconciliation boundary; Nylas remains the authoritative mailbox read/send provider.

## Acceptance

- The reported AP remittance case produces one Giang Tran Jul 14 11:13 AM timeline item and one Wire Details attachment group after its local/provisional copies reconcile with the provider item.
- Legitimate same-content provider messages with different provider IDs remain separate.
- Messages render oldest to newest by default and opening a conversation brings the newest expanded message into view.
- Expanded rows show only authored content by default; full quoted/original content is available deliberately without adding timeline rows.
- Reply, Reply all, Create shared draft, and Forward target the exact canonical message and use its unchanged provider body/recipients.
- Personal, shared, node-attached, and project-attached viewers use the same reconciliation contract.
- The timeline remains responsive, horizontally bounded, direction-aware, and attachment-owned while using Mango's established elevated-surface design.

## Verification

- Identity/reconciliation fixtures: `tests/frontend/modules/communications/emailThreadMessages.test.ts`.
- Quote extraction fixtures: `tests/frontend/modules/communications/emailQuotedContent.test.ts`.
- Home/node timeline and action contracts: `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` and `tests/frontend/modules/editor/emailViewerContract.test.ts`.
- Run `node tests/frontend/scripts/run-node-relationship-tests.mjs`, `npm.cmd run build` in `frontend`, and the full gate `node scripts/run_all_tests.mjs`.
- Manually compare the representative AP thread with `docs/important tasks/makeemailsgood.md`; verify one canonical row/attachment, chronology, collapsed history, action targeting, and responsive width.
