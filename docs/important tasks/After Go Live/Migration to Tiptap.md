# Migration to Tiptap

## Status and timing

The inactive JSON-native foundation and Tiptap implementation were added on 2026-07-18 and refined on 2026-07-19. Existing data still uses the production HTML editor. The future HTML-to-JSON conversion and atomic workspace cutover remain an after-go-live project and require separate review. Email is not part of that conversion and remains rich HTML.

This document is the project charter and decision record for that future migration. Implementation must update this file with discoveries, decisions, rollout evidence, failed approaches, risks, test results, and final proof. Do not create a competing tracker.

## Plain-language summary

Mango uses open-source Tiptap as the actual editor on the gated JSON path. Tiptap is built on ProseMirror. The browser holds and displays a structured JSON document containing paragraphs, text, formatting, lists, tables, mentions, and image references. Tiptap transactions are batched locally; Mango durably records the latest accepted local JSON before sending a validated snapshot with an exact base revision. Mango does not send a complete document after every character.

Mango will **not** use Tiptap Cloud, Tiptap's hosted collaboration service, a Tiptap document server, or any other third-party network API to make basic editing work. No Mango document will be sent to Tiptap's servers. Tiptap and ProseMirror will be installed open-source frontend libraries that execute locally as part of Mango's own browser application.

Mango will continue to own its Go backend, PostgreSQL database, authentication, authorization, realtime subscriptions, transactional event delivery, durable pending work, document limits, and attachment system. Image bytes will continue to upload directly from the browser to S3 using Mango-authorized temporary upload instructions. The saved Tiptap document will contain only permanent Mango attachment IDs and safe display information, never image bytes or temporary credentials.

## Why this is the chosen direction

Mango's editor is closer to a small collaborative word processor than a plain text box. It must preserve paragraphs, blank rows, indentation, lists, numbering, checklists, formatting, tables, mentions, pasted rich content, and inline attachments. Raw HTML is an excellent clipboard and publishing format, but it is fragile as the unit of concurrent character-by-character editing. Quill Delta is appropriate when Quill itself is the editor, but placing Quill Delta behind Mango's separate custom HTML editor forced continual conversion between two different document descriptions. That conversion lost paragraph structure and attachment behavior.

The future migration must not repeat that mistake. Tiptap/ProseMirror will be the actual browser editor and its JSON will be the document Mango saves. There will not be a separate custom editing model hidden in front of it.

This decision does not invalidate the immediate work to restore Mango's existing HTML editor before go-live. The current product must first return to its previously working behavior. Tiptap is a deliberate post-launch replacement project with its own parity, migration, and rollback gates.

## Definitions in ordinary language

- **Document JSON:** The complete current document written as JSON. It says that the document contains a paragraph, a list, an image, a table, and so on. It also records the text and supported formatting.
- **Change instruction:** A small JSON object created by ProseMirror in the browser that says what changed, such as “insert this text here,” “delete this range,” or “make this range bold.” ProseMirror documentation calls one of these a *step*. Mango documentation and product language may call it a change instruction.
- **Document sequence:** Mango's internal increasing number for accepted changes: change 81, change 82, change 83. This is not a third-party version-control product. It lets a reconnecting browser determine which changes it missed and prevents reordered network delivery from corrupting the document.
- **Complete document reload:** Loading the complete current Document JSON when a document first opens, after browser refresh, after reconnect, or when the browser discovers that it missed a change.
- **Clipboard representation:** One of the forms an application places on the system clipboard. The same copy action may provide HTML, plain text, an image, and application-specific data at the same time.

## Final product decisions

1. Tiptap on ProseMirror will become the actual browser editor, not merely a JSON converter behind Mango's existing custom editor.
2. Tiptap/ProseMirror JSON will become the single authoritative saved description of editor content after migration.
3. For Node, Project, and Logic Gate rich documents, HTML remains an import, clipboard, publishing, and legacy-conversion format but will not remain a second authoritative editable document after migration. Email compose, reply, forward, attached-email reply, drafts, signatures, and display remain authoritative rich HTML and do not use Tiptap JSON.
4. Normal typing and formatting use local ProseMirror transactions and a bounded debounce. The implemented Mango wire contract sends a strict complete JSON snapshot per batch with an exact base revision; it does not send one snapshot per character.
5. The complete Document JSON will be loaded on initial open, refresh, reconnect, detected gaps, and explicit recovery.
6. Mango's own backend and database will accept, order, store, authorize, and publish changes. No Tiptap-hosted service will participate.
7. Mango's existing direct-browser-to-S3 attachment architecture will remain in place.
8. Images in Document JSON will use permanent Mango attachment IDs. Realtime changes will never contain attachment bytes, base64 bodies, temporary signed URLs, credentials, cookies, or secrets.
9. Conversion from legacy Mango HTML to Tiptap JSON will be a controlled migration operation. Mango will not translate the entire document from HTML to JSON and back during ordinary typing, acknowledgement, or remote delivery.
10. Copy and paste quality is a first-class product requirement, not an incidental editor default.
11. Automatic merging of simultaneous edits is shelved. A stale writer receives a visible conflict and cannot silently overwrite the accepted revision.
12. One company/workspace gate selects the format for every non-email rich-document surface. The gate defaults to legacy and cannot become JSON-ready unless the complete expected Node, Project, and Logic Gate document count is converted. Email never consults this gate.

## Current inactive implementation status and remaining proof

The 2026-07-19 refinement corrected the first foundation pass: email was removed from the JSON resource/API/schema inventory; transaction bursts now produce one validated full snapshot and one exact IndexedDB write at a roughly 180 ms quiet boundary with a 1.5-second maximum; static sleeping documents render comment/change/chat decorations; exact document realtime scopes exist only while the textbox intersects the viewport; and dirty Node/Project rows publish a real pin to the outer virtualizer until acknowledgement. The backend remains canonical and revision-protected, and IndexedDB contains only unacknowledged pending work.

For JSON-mode annotations, `from`, `to`, selection endpoints, deep-link positions, comment/change positions, and chat highlight endpoints are ProseMirror positions in the exact versioned document. They are not plain-text character offsets and must never be adjusted arithmetically. ProseMirror transaction mappings move them through structured edits. In legacy HTML mode, existing offset contracts remain unchanged. The later conversion must translate legacy stored offsets against the converted document and validate the result. Durable writeback of every mapped existing annotation, complete Word/Google/PDF paste fixtures, and full production-path browser/PostgreSQL parity remain acceptance work; the transition is not complete merely because the inactive component route exists.

## What Tiptap and ProseMirror will own in the browser

The locally installed editor libraries will own:

- The editable browser surface and its connection to the browser's selection and caret.
- The in-memory Document JSON.
- Paragraph, row, list, table, and inline-format structure.
- Local keyboard editing behavior such as Enter, Backspace, selection, and list continuation.
- Creating local transactions when the document changes.
- Mapping local selections, annotations, and decorations through those transactions.
- Updating the visible editor from its in-memory document without replacing the entire editor HTML after every keypress.
- Producing JSON for persistence and HTML/plain text for copy and export.
- Reading supported pasted HTML and turning it into supported document elements.
- Local undo and redo behavior as ultimately defined for collaboration.
- Extension points for Mango mentions, attachment images, automatic numbering, and other Mango-specific content.

Using these local programming interfaces does not mean using a third-party network API. The code is bundled into Mango's frontend and runs in the user's tab.

## What Mango will own

Mango will own:

- The Go API and all document endpoints.
- PostgreSQL document storage and the durable change log.
- Company, resource, and individual text-box identity and isolation.
- Authentication and edit/no-access authorization.
- Subscription authorization, revocation, and exact realtime routing.
- Stable operation IDs, client IDs, deduplication, acknowledgement, retry, and reconnect behavior.
- The exact document revision used to reject stale saves and detect canonical changes.
- Transactional business writes and durable outbox insertion where realtime publication is required.
- Durable pending browser work, including refresh and lost-acknowledgement recovery.
- Canonical document size limits and safe error behavior.
- Attachment records, resource links, authorization, variants, and content loading.
- Temporary direct-upload authorization and upload completion.
- S3 object ownership and lifecycle.
- Search, plain-text summaries, notifications, email output, and any other derived uses of document content.
- Migration, observability, backup, rollback, and production deployment.

## Services that are explicitly out of scope

The migration must not require:

- Tiptap Cloud.
- Tiptap's hosted collaboration provider.
- A Tiptap account for Mango users.
- Sending Mango documents, change instructions, attachments, authentication tokens, or user data to Tiptap.
- A paid or hosted API for ordinary text formatting, JSON persistence, copy/paste, or image display.
- A Tiptap-controlled source of document truth.

If a paid Tiptap extension is ever considered, it requires a separate explicit product and licensing decision. The core product must not quietly become dependent on a paid network service. The preferred implementation is local open-source editor code plus Mango-owned extensions.

## Target rich-text contract

The Tiptap migration must reach or exceed the behavior of the working Mango editor. At minimum, it must support:

- Paragraphs and deliberate blank paragraphs.
- Enter-created new rows and Shift+Enter line breaks.
- Leading indentation and nested indentation.
- Left, center, right, and justified alignment where currently supported.
- Bulleted lists with correct nesting and continuation.
- Checklists with checked and unchecked items.
- Ordered lists using decimal, lower-alpha, upper-alpha, lower-Roman, and upper-Roman numbering where Mango exposes those choices.
- Mango's automatic numbering behavior and nested numbering rules.
- Headings and normal paragraphs.
- Bold, italic, underline, strikethrough, and inline code where supported.
- Font size, font family if retained by the product, foreground color, highlighting, and line height.
- Hyperlinks with safe URLs.
- Mango mentions with stable user identity, readable labels, and notification behavior.
- Tables, rows, cells, headers, alignment, and supported cell formatting.
- Mixed pasted content in its original order.
- Inline and block images, image resizing, alignment or float behavior, alt text, filename, selection controls, comments, download, preview, and Mango actions such as creating or linking a Node where currently supported.
- Unicode, emoji, international text, and correct caret behavior.

The exact allowed document elements and attributes must be written down before migration code is accepted. If the Tiptap default does not support an existing Mango feature, Mango must add a local extension or make an explicit product decision. Unsupported content must not disappear silently.

## Illustrative Document JSON

The final schema must be designed and versioned during implementation. The following is illustrative rather than a frozen database contract:

```json
{
  "type": "doc",
  "content": [
    {
      "type": "paragraph",
      "attrs": {
        "indentLevel": 1,
        "textAlign": "left"
      },
      "content": [
        { "type": "text", "text": "Important ", "marks": [{ "type": "bold" }] },
        { "type": "text", "text": "customer follow-up", "marks": [{ "type": "highlight", "attrs": { "color": "yellow" } }] }
      ]
    },
    {
      "type": "orderedList",
      "attrs": { "numberingStyle": "lower-alpha", "start": 1 },
      "content": [
        {
          "type": "listItem",
          "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Confirm the account." }] }]
        }
      ]
    },
    {
      "type": "mangoAttachmentImage",
      "attrs": {
        "attachmentId": "permanent-mango-attachment-id",
        "alt": "Customer screenshot",
        "filename": "customer-screenshot.png",
        "width": 640,
        "height": 420,
        "alignment": "left"
      }
    }
  ]
}
```

The document must not save a temporary object URL, signed S3 URL, bearer token, cookie, or image body.

## Implemented Mango JSON batching and realtime

Tiptap runs in the user's browser and ProseMirror owns the current JSON and transactions. Mango deliberately does not attempt to apply native ProseMirror steps in Go and does not attempt concurrent merge in this phase. The implemented flow is:

1. The user edits the Tiptap editor in their browser.
2. Tiptap/ProseMirror immediately updates the local visible document.
3. The frontend-backend textbox sync coalesces transactions for roughly 180 milliseconds of quiet, with a 1.5-second maximum batch window during continuous typing.
4. Before network submission, Mango writes the strict JSON snapshot, stable operation ID, client ID, and exact base revision to the document's exact IndexedDB record.
5. The browser submits that batch to Mango's exact company/resource/document API.
6. The Go API authorizes the actor, validates the complete versioned JSON schema and size, deduplicates the operation, requires the exact base revision, and atomically commits the canonical JSONB document, operation/version history, and realtime outbox event.
7. The exact document realtime scope tells other mounted subscribers to recover the canonical snapshot. Unrelated scopes do not wake.
8. A successful acknowledgement removes the durable local record. A lost acknowledgement is safe because retrying the stable operation ID is idempotent.
9. A stale base revision raises a visible keep-local/use-canonical decision. Mango never merges the two documents automatically and never silently overwrites the accepted revision.

## Backend implementation decision

The Go backend does not reimplement ProseMirror step algorithms. It validates a strict, versioned Mango JSON document without an editor-specific byte cap, stores one canonical JSONB snapshot per accepted batch, records immutable operations/versions, and uses exact optimistic revisions. The general API request-body ceiling remains separate. This is safe without a JavaScript document server because automatic simultaneous-edit merging is shelved. The browser still avoids per-character snapshots through transaction batching.

## Images and attachments

Images are a core Mango editor feature, not a later enhancement.

### Existing Mango upload architecture to preserve

Mango already uses direct browser-to-S3 upload:

1. The browser asks Mango's backend to authorize an upload and create an upload intent.
2. Mango returns a short-lived signed S3 `PUT` instruction, or signed multipart instructions for a larger file.
3. The browser uploads the bytes directly to S3. Image bytes do not pass through the ordinary Mango Go request body.
4. The browser calls Mango's completion endpoint.
5. Mango verifies and finalizes the attachment and its resource link.
6. The editor stores the permanent attachment ID.

Tiptap's local file-paste handling must call this existing Mango attachment path. Tiptap will detect the pasted file and provide a place for Mango to insert or update the image element. Tiptap will not own storage.

### Image insertion behavior

The target behavior is:

1. Detect an image file, PNG clipboard item, data image, or supported HTML image in the paste/drop operation.
2. Preserve the mixed fragment's order so the image stays between the same paragraphs in which the user copied it.
3. Show a temporary local placeholder or preview with explicit uploading status.
4. Create or reuse a retry-safe Mango upload intent.
5. Upload bytes directly from the browser to S3.
6. Finalize the attachment and resource link through Mango.
7. Replace the local placeholder with a `mangoAttachmentImage` element containing the permanent attachment ID and safe presentation attributes.
8. Publish only the durable image element through realtime after the required attachment state is committed.
9. If upload fails, retain a visible retry/remove state. Never silently erase the image or claim it is saved.

### Image display behavior

When displaying a saved image:

- The Tiptap image element contains the permanent Mango attachment ID.
- Mango's established authorized attachment loader obtains the appropriate display variant and creates a temporary local browser object URL.
- The temporary display URL is never written back into Document JSON or a realtime event.
- Preview, double-click/open, download, resizing, scrolling controls, comments, and Mango resource actions must work as they did before migration.
- Permission revocation must prevent future content reads even if the document still contains the attachment ID.

### Copying images out of Mango

Copying a selected Mango image should place the richest safe representations supported by the browser on the clipboard:

- Portable image data such as `image/png` when browser permission and support allow it.
- Clean `text/html` containing a usable image representation for rich external editors.
- A useful filename or alt-text `text/plain` fallback.
- Mango-specific attachment identity only where it is safe and useful for Mango-to-Mango paste.

Temporary signed URLs and credentials must never be copied. Mango-to-Mango copy should reuse an authorized existing attachment through a new resource link when appropriate instead of downloading and uploading identical bytes. Copying to an external program may require portable image bytes because that program cannot use Mango's private attachment ID.

## Dedicated copy-and-paste contract

Copy and paste is one of the primary reasons for choosing Tiptap/ProseMirror. Users must be able to bring substantial material into Mango without manually rebuilding it.

### The Windows clipboard is not always HTML

Windows does not convert every copied item into HTML. A source application may place several representations of the same selection on the clipboard. A browser paste event may expose:

- `text/html`
- `text/plain`
- `image/png`
- One or more files
- A source-specific representation that a browser may or may not expose

Google Docs, Microsoft Word, Word Online, Outlook, and websites commonly provide both rich HTML and plain text for selected rich text. A screenshot or copied PNG commonly provides image data. XML selected in a code editor is commonly plain text. A PDF viewer may provide plain text, limited HTML, image data, or a mixture depending on the viewer and selection. Mango must inspect the actual available representations instead of assuming that every paste is HTML.

### Source expectations

| Source | Likely browser-visible representations | Required Mango behavior |
| --- | --- | --- |
| Google Docs | HTML plus plain text; images may also appear as files, data, or HTML references | Preserve supported rows, lists, numbering, formatting, links, tables, and images in source order. |
| Microsoft Word desktop | Windows HTML clipboard data plus plain text; Office-specific HTML styles; images may be separate or referenced | Clean Office-only markup while retaining supported font sizes, emphasis, indentation, lists, tables, links, and images. |
| Word Online / Outlook Web | HTML plus plain text and possible image/file items | Preserve the supported rich fragment and upload images through Mango. |
| Website | HTML plus plain text; possible image references | Keep supported semantic formatting and links; remove scripts, event handlers, trackers, unsafe URLs, and unsupported page chrome. |
| XML, source code, Notepad, VS Code | Usually plain text | Preserve Unicode, rows, tabs/spaces according to Mango's code/plain-text paste rules; never interpret source text as executable HTML. |
| PDF selection | Often plain text; sometimes limited HTML or image data depending on viewer | Preserve the best available reading order and rows. Do not promise reconstruction of layout or formatting the clipboard did not provide. |
| PNG, screenshot, or copied bitmap | `image/png`, file data, or both | Upload directly to S3 through Mango and insert an attachment image at the caret. |
| File Explorer | File representation | Validate the file, upload through Mango, and insert or attach according to the editor product rule. |
| Another Mango editor | Clean HTML/plain text/image data plus safe Mango attachment identity where supported | Preserve the exact supported Mango structure and reuse authorized attachment identity safely. |

### Paste priority

The paste implementation must evaluate the entire clipboard payload, not blindly choose the first string:

1. If the clipboard contains a rich mixed fragment, use its HTML to preserve text structure and ordering.
2. Reconcile any image/file clipboard items with image positions in that fragment.
3. Upload images through Mango and insert permanent attachment-image elements.
4. Use plain text when no usable rich representation exists or when the user explicitly requests plain-text paste.
5. Never insert both HTML and plain text from the same selection.
6. Never duplicate an image because it appeared in both HTML and file representations.

### Local HTML-to-Tiptap import

Tiptap/ProseMirror will locally parse supported clipboard HTML into Document JSON. Mango must define a local paste-normalization extension that:

- Removes scripts, executable event attributes, unsafe URLs, credentials, tracking markup, hidden document chrome, and unsupported external controls.
- Resolves Microsoft Office markup and `mso-*` styles into the Mango features they actually represent.
- Interprets Google Docs paragraph, soft-break, list, indentation, highlight, and table patterns.
- Converts supported inline CSS such as font size, alignment, colors, and highlights into explicit Tiptap attributes.
- Rebuilds nested list structure when a source exports visually nested but structurally flat HTML.
- Retains visible text even when an unsupported style is removed.
- Preserves deliberate blank rows and spacing.
- Converts supported image sources into Mango upload work rather than saving remote or temporary URLs.
- Produces deterministic JSON so the same pasted fragment behaves consistently across browsers.

This code runs locally in Mango. It does not call a Tiptap service. Tiptap's open-source extension points may be used; a proprietary paste product is not a prerequisite.

### Honest limitations

Mango can promise high fidelity for features that Mango supports and that the source exposes to the browser. Mango cannot recreate information that never reaches the clipboard.

Examples:

- A PDF may expose only plain text with imperfect reading order.
- A PNG contains pixels, not editable paragraphs; Mango should paste it as an image unless a separate, explicitly approved optical-character-recognition feature is added later.
- Word headers, footers, floating shapes, pagination, comments, tracked changes, or page geometry may not be present in browser-accessible clipboard HTML.
- Private remote image URLs may be unreadable outside their source application.

When content cannot be represented exactly, Mango must preserve the visible information through a clear fallback and must not silently discard substantial text or images.

### Paste fixture library and tests

The implementation project must create a permanent fixture library captured from realistic sources on supported Windows browsers. It must include:

- Google Docs paragraphs, blank rows, indentation, nested bullets, ordered/alphabetical/Roman lists, checklists, highlights, links, tables, and mixed inline images.
- Microsoft Word desktop and Word Online equivalents, including Office-specific HTML.
- Outlook and common website fragments.
- Plain text and XML/code with rows, tabs, Unicode, and URLs.
- PDFs from multiple viewers, including multi-column and image-heavy examples, with documented limitations.
- Screenshots, copied PNGs, pasted files, remote webpage images, and mixed text/image fragments.
- Mango-to-Mango and Mango-to-Word/Docs round trips.

Tests must inspect the actual Tiptap editor document and visible DOM. They must verify text, row boundaries, list nesting and numbering, formatting attributes, image positions, attachment IDs, upload status, preview, download, and round-trip behavior. Callback counters and source-pattern checks are insufficient.

## Migration strategy

The future implementation should proceed in deliberate stages:

1. **Inventory the working editor contract.** Record every supported formatting command, keyboard behavior, paste source, image action, mention, table behavior, document owner, and realtime scope.
2. **Pin and license-review the local libraries.** Choose exact Tiptap and ProseMirror package versions. Confirm that required core behavior can run locally without Tiptap Cloud or a hosted API.
3. **Define Mango's Tiptap document schema.** Specify every allowed element and attribute, including Mango mentions, attachment images, indentation, numbering styles, and tables.
4. **Build an isolated browser prototype.** Prove row, list, numbering, table, mention, image, clipboard, undo, and caret behavior before touching production persistence.
5. **Prove Mango batching and conflict handling.** Demonstrate durable local-before-network batching, exact revisions, dedupe/lost-acknowledgement recovery, reconnect, explicit conflicts, and document-size enforcement through the Mango-owned Go backend.
6. **Build the paste fixture suite.** Prove Google Docs, Word, websites, PDFs, plain text, PNGs, files, and mixed fragments before migration is approved.
7. **Integrate direct-to-S3 images.** Reuse the existing Mango upload intents, signed uploads, completion, attachment IDs, variants, and hydration paths.
8. **Implement a one-time HTML conversion tool.** Convert every stored rich document in the workspace outside ordinary editor runtime. Preserve the original source for the approved rollback period and produce a migration report for unsupported content.
9. **Validate a complete disposable workspace.** A production workspace cannot mix formats or route only newly created documents to JSON.
10. **Migrate each non-email editor owner deliberately.** Nodes, Logic Gates, Projects, individual text boxes, and any other non-email rich-document surface must use the same core editor and schema while retaining exact document identity and permission scope. Email stays on its rich-HTML contract.
11. **Remove temporary compatibility code.** After migration proof and the approved rollback window, delete the legacy HTML editing path and any dual-write mechanism. Do not maintain two competing editable sources indefinitely.

The conversion tool may read legacy HTML and write the inactive JSON tables while the workspace remains in converting state. Ordinary runtime never reads stored HTML into Tiptap, never dual-writes document content, and never chooses a format per document.

## Rollout and rollback requirements

- Do not migrate production data without a separately reviewed migration and deployment plan.
- Back up the original rich HTML before conversion and retain an auditable mapping to the resulting JSON during the approved rollback window.
- Make conversion deterministic and idempotent so retrying it cannot duplicate content or attachment links.
- Report unsupported structures before committing the migrated document.
- Verify document counts, attachment references, visible text, and per-resource ownership after migration.
- Use the atomic company/workspace data-format gate. Do not enable individual pilot documents inside a production workspace.
- Do not permit edits from both editor engines against the same authoritative document at the same time.
- Define the human deployment, migration, rollback, monitoring, and go/no-go sequence before rollout.

## Required acceptance evidence

The migration is not complete until runtime evidence proves:

- Tiptap is the actual browser editor on every intended Mango surface.
- No document or attachment request is sent to Tiptap or another third-party collaboration service.
- Existing migrated documents retain exact visible text, rows, indentation, lists, numbering, checklists, formatting, mentions, tables, and attachment references within the supported contract.
- Pressing Enter and continuing to type never flattens the document or moves the caret backward because of acknowledgement or remote delivery.
- Inline images upload directly from the browser to S3, resolve through permanent Mango attachment IDs, display, preview, download, resize, copy, and survive refresh/reconnect.
- Google Docs and Word rich pastes retain supported formatting and mixed image ordering.
- PNGs/screenshots paste as durable attachment images.
- Plain-text, XML/code, and PDF fallbacks preserve all clipboard-visible text and rows as accurately as the source permits.
- Two authorized stale writers cannot silently overwrite each other; the second writer receives an explicit conflict without automatic merge.
- Duplicate delivery, lost acknowledgement, refresh, reconnect, and revision mismatches do not duplicate or silently erase accepted content.
- Exact isolation holds among companies, users, Nodes, Logic Gates, Projects, and individual text boxes.
- Permission revocation stops future document and attachment delivery.
- Document limits, paste batching, pending work, and storage failures have clear user-visible recovery with no silent truncation.
- Real browser tests assert the actual editor DOM, caret-relevant content, images, and saved/healthy status against the production-path Mango backend and disposable PostgreSQL database.

## Decisions intentionally deferred

The following details require focused proof before coding the full migration:

- The future version-upgrade policy after the pinned 3.28.0 packages.
- Any future document-schema version beyond version 1.
- Automatic simultaneous-edit merging, including its model, server validation, undo behavior, and migration plan.
- Collaborative undo/redo if simultaneous merge is ever approved.
- The supported limit for rich documents and bounded paste batches after measurement.
- The exact local Word/Google paste-normalization rules and whether any optional local package is justified.
- The supported outbound clipboard behavior for private attachment images across browsers.

These are implementation questions, not permission to replace the decided ownership model with a third-party service.

The existing-data conversion, production cutover, rollback window, and later deletion of the HTML editor remain future work. The required sequence is: write drain or maintenance window, backup, complete conversion, validation, atomic gate flip, old-client rejection, verification, rollback decision, and eventual legacy removal.

## Decision history from the editor discussion

1. Mango initially used rich HTML successfully for storage and display, including rows, indentation, formatting, lists, and images.
2. Realtime work placed Quill Delta and structured conversion behind Mango's separate custom HTML editor. Continual conversion caused visible raw HTML, flattened paragraphs, lost Enter-created rows, caret resets, and broken image hydration.
3. The immediate decision was to restore the working HTML editor before go-live while keeping Mango realtime behavior as simple as possible.
4. Research into Google Docs, Word, Notion, Linear, ProseMirror, Quill, Lexical, Slate, Markdown, HTML, and ODF showed that advanced editors commonly use a structured editable document and separate clipboard/export representations.
5. Copy/paste fidelity and native small realtime changes became the main selection criteria.
6. Tiptap on ProseMirror was selected as the preferred future direction because its actual browser editor uses structured JSON, supports extensible rich content, parses clipboard HTML, and produces small native document changes.
7. The decision was strengthened: Mango will use Tiptap as the actual browser editor, not only borrow its JSON shape.
8. The ownership boundary was made explicit: Tiptap/ProseMirror run locally in the browser; Mango owns every server, database, realtime, permission, and attachment responsibility.
9. Tiptap Cloud, hosted collaboration, and third-party document APIs were explicitly rejected.
10. Mango's existing direct browser-to-S3 attachment system was confirmed as the required image-upload path.
11. The Windows clipboard was clarified: rich sources often provide HTML plus plain text, while screenshots, PNGs, code, XML, and PDFs may provide other combinations. Mango must inspect all available representations rather than assume every paste is HTML.

## Reference material

- Tiptap editor concepts and JSON: <https://tiptap.dev/docs/editor/core-concepts/introduction>
- Tiptap local persistence choices: <https://tiptap.dev/docs/editor/core-concepts/persistence>
- Tiptap Image extension: <https://tiptap.dev/docs/editor/extensions/nodes/image>
- Tiptap FileHandler extension: <https://tiptap.dev/docs/editor/extensions/functionality/filehandler>
- Tiptap local extension and pasted-HTML hooks: <https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/extension>
- ProseMirror document, transform, and collaboration guide: <https://prosemirror.net/docs/guide/>
- Windows HTML Clipboard format: <https://learn.microsoft.com/en-us/windows/win32/dataxchg/html-clipboard-format>
- Web Clipboard API data representations: <https://www.w3.org/TR/clipboard-apis/>
- Google Docs public structured document model: <https://developers.google.com/workspace/docs/api/reference/rest/v1/documents>
- Microsoft WordprocessingML structure: <https://learn.microsoft.com/en-us/office/open-xml/word/how-to-open-and-add-text-to-a-word-processing-document>

