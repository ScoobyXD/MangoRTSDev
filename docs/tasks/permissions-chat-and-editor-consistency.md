# Permissions, Chat, And Editor Consistency

Last updated: 2026-07-10

Status: implemented in this branch; automated execution pending local shell recovery.

## Permissions

- Every `EntityPermissionsPanel` variant displays an explicit Save button, including dialogs opened from nodes, Logic Gates, projects, Company Explorer, and Shared Triage entities.
- Save remains disabled while loading, saving, or read-only.
- Existing close-with-save behavior remains for editable dialogs; denied/read-only dialogs close without a write.

## Node Chat Links

- Detect `http://`, `https://`, `www.`, and bare web domains in non-mention chat text without linkifying email-address domains.
- Render links blue and underlined with `target="_blank"` and `rel="noopener noreferrer"`.
- Keep mention highlighting and whitespace behavior intact.
- Exclude arbitrary URI schemes such as `javascript:`.

## Unified Editor Images

- Selecting an image now also places a collapsed caret immediately before its shared image frame.
- Space/text insertion can therefore occur before the image while existing pointer drag, edge resize, copy/cut, and double-click preview behavior remains shared across all unified rich editors.

## Node Attachment Removal

- Right-clicking an email or attachment row exposes a red `Remove from node` action.
- Attachment removal unlinks the node resource attachment and refreshes active attachment metadata; it does not delete the underlying stored file.

## Verification

- Contract coverage: `tests/frontend/modules/editor/emailViewerContract.test.ts`.
- Manual permission checks must cover at least one dialog and one embedded panel.
- Manual chat checks must cover punctuation after URLs, mentions beside URLs, and blocked non-HTTP schemes.
