# Make Emails Good: Email Thread Remediation Charter

Last updated: 2026-07-14
Status: implemented on `codex/fix-email-thread-reply-timeline0000580` and verified against the screenshot-class regression fixture; pending review and explicit integration/deployment. This remains the authoritative remediation contract.

## Why this document exists

Mango's email thread viewer was recently changed to hide quoted history and present messages as a neumorphic timeline. The change passed its source-level tests and was merged, but the actual product behavior is still fundamentally wrong.

In the real thread shown in the comparison screenshots, Mango renders the same provider message repeatedly as if each copy were a different reply. The repeated cards have the same sender, time, body, signature, attachment, and actions. Hiding quoted history inside each card does not solve that problem because the duplicated unit is the message row itself.

Front shows the same email conversation as a coherent sequence of distinct messages. Each real message appears once. Quoted prior mail remains subordinate to the message that contains it and is collapsed behind a deliberate affordance. Attachments stay with their originating message. Internal comments and assignment events are visually distinct from email messages.

This document records what was observed, what Mango is doing wrong, what the correct product model is, and what proof is required before this work may be called complete again.

## Authority and required reading

An agent working on this problem must read, in order:

1. AGENTS.md.
2. This document.
3. docs/tests/email.md.
4. docs/tasks/email-thread-viewer-parity.md.
5. The committed backend and frontend data path. Committed code is the final source of truth when older documentation drifts.

For the remediation described here, this document supersedes older email-viewer statements that conflict with the observed Front behavior or the acceptance contract below. In particular, a passing source-text test and a default of newest-first are not sufficient evidence of Front-like thread behavior.

Front is the reference for conversation semantics and information hierarchy. Mango should continue to use Mango's established neumorphic components, colors, spacing tokens, and interaction patterns rather than copying Front's visual styling wholesale.

## Executive verdict

The current implementation is not a usable email thread.

It is a vertically stacked collection of oversized message cards whose data composition can repeat the exact same provider message multiple times. The new styling makes the repeated-data failure more prominent; it does not repair it.

The non-negotiable product rule is:

> One canonical email message identity produces one visible email timeline item. A thread is an ordered sequence of distinct messages and non-email events, not a sequence of cumulative body snapshots or duplicate hydration records.

Quote extraction, card styling, action placement, and attachment previews are downstream concerns. The identity and reconciliation model must be correct first.

## The exact comparison that exposed the failure

The screenshots compare the same subject and conversation:

**Re: A/N for OI-41329 / COSU6502396670 / CSLU1990929**

The Mango screenshots supplied for the comparison were:

- codex-clipboard-aa062b8a-80b5-477b-be4f-0e0d20b0e11b.png
- codex-clipboard-7c8a4d73-cd54-4cd6-bdc9-061e5acaea2f.png
- codex-clipboard-746d0ee4-6470-4696-8964-5b8d4cd6ae8e.png
- codex-clipboard-e17265a7-788e-4de5-93e4-956ac803f1f3.png

The Front screenshots supplied for the comparison were:

- codex-clipboard-32182627-b3fc-4c96-9d76-b8c40b6bbea6.png
- codex-clipboard-594ea1f2-416f-42be-b581-a8ec1f4cb5a9.png
- codex-clipboard-aeb06c4c-203e-4106-9e3d-051f8874f32d.png
- codex-clipboard-6f32b337-5d25-423a-98e6-87c03a5d1b2a.png
- codex-clipboard-904a8a3e-2a7d-495f-bbea-dd9ee47655f0.png
- codex-clipboard-c797a535-d86a-4f7c-8ced-ece76393c574.png
- codex-clipboard-073cfbb2-1056-43ad-8c73-8462575e1082.png

These temporary screenshot files may not remain available to future agents. The observations and acceptance criteria in this document are therefore the durable record.

## What Mango currently does wrong

### 1. It repeats the same provider message as multiple timeline items

Mango visibly renders the following message at least three times in the same thread:

- Sender: **Giang Tran <ap@180snacks.com>**
- Time: **Jul 14, 11:13 AM**
- Opening: **Hello, Yimin,**
- Body: **Please see the remittances attached below for 15 invoices. Thank you!**
- Signature: the same Giang Tran finance/administration signature and phone numbers
- Attachment: the same Wire Details PDF, displayed with the same file information

This is not a subtle quote-boundary mistake. The complete visible message unit is duplicated: header, recipients, timestamp, authored body, signature, quoted-history control, attachment, and action buttons.

Different messages from Andy/Alee and Luke are also present, so Mango is capable of showing distinct rows. The failure is that the thread-composition path also introduces duplicate representations of at least one real provider message.

### 2. It treats quote hiding as if it solved message identity

Every duplicate card says that earlier quoted messages were hidden and offers **Show quoted history**. That affordance only controls content inside one rendered message. It cannot make two or more rows representing the same provider message become one row.

The prior change fixed a narrower presentation symptom while missing the higher-level data invariant.

### 3. It gives every row excessive visual weight

Each message is rendered as a large bordered card with a large inner body surface, a separate quoted-history surface, attachment space, and repeated actions. Long signatures and disclaimers produce enormous blank or low-value regions. A short reply can consume most of a screen.

The result is poor information density and makes it difficult to answer basic questions:

- Who replied next?
- Which message introduced an attachment?
- Where does one message end and another begin?
- What is the latest authored statement?
- Is this card a new reply or another copy of something already shown?

### 4. It repeats heavy actions on every message

Reply, Reply all, Create shared draft, and Forward are displayed as four prominent buttons on every expanded card. These actions must remain available, but repeating the full action group at the top of every large item creates noise and competes with the actual conversation.

Actions should be contextual to the selected, hovered, focused, or latest actionable message while remaining keyboard and touch accessible.

### 5. It renders attachments as low-information generic tiles

Mango shows generic PDF blocks with truncated names and little visual context. Front groups attachments with their originating message, shows useful document thumbnails, supports download-all where appropriate, and can display an inline document meaningfully inside the message.

Attachment ownership is part of message correctness, not merely decoration. A duplicated message must not duplicate its attachment in the timeline, and an attachment must never migrate to a neighboring reply during reconciliation.

### 6. It wastes space and creates awkward scrolling

The screenshots show giant body regions, large gaps, a nested-feeling scroll experience, and a horizontal scrollbar. The reader must travel a huge distance through repeated material to reconstruct a six-message conversation.

The desktop thread should use one clear vertical reading surface. Normal email content must not force page-level horizontal scrolling. Long bodies, wide HTML, tables, images, and attachment previews must be constrained within the message surface.

### 7. It exposes unfinished interaction states

A heavy black focus outline appears around a message header in the screenshots. Focus visibility is required, but it must use the design system and must not look like an accidental debug border or broken component state.

## What Front does correctly

Front's value in this comparison is not that it uses white cards. It is that its conversation model is legible and internally consistent.

### 1. Each distinct message appears once

The same thread is shown as a sequence containing different contributions, including:

- Luke requesting freight and commercial invoices.
- Andy/Alee responding about the container and clearance documents.
- Claire providing an arrival notice and guarantee letter.
- Yimin sending six documents.
- Giang asking for bank-detail verification.
- Yimin sending an updated invoice.
- Giang acknowledging the updated invoice.
- Giang sending the final remittance message with the Wire Details attachment.

The final Giang remittance message appears once at the bottom of the sequence. It is not repeated three times.

### 2. Chronology is readable

Front presents the conversation in chronological, oldest-to-newest reading order, with the newest activity at the bottom and brought into view. Sender changes and time progression are obvious without requiring the user to decode repeated metadata blocks.

Mango's correct default for this experience is therefore:

- oldest message at the top;
- newest message at the bottom;
- initial focus or scroll positioned so the newest relevant activity is visible;
- an explicit order control may remain if useful, but it must not compromise message identity or the default reading flow.

### 3. Quoted content remains subordinate

Some Front messages contain prior email history as part of the provider body. Front keeps that history nested within the containing message and collapses it behind an ellipsis or similar secondary affordance.

Correct behavior is not “delete all quoted text.” Correct behavior is:

- render the authored portion prominently;
- keep quoted/original content associated with its real containing message;
- collapse lower-value history by default;
- let the user deliberately reveal it;
- never promote nested quoted messages into fake top-level timeline items;
- never use quote removal to conceal a duplicate top-level message.

### 4. Attachments are visually tied to their message

Front displays an attachment group in the same card as the message that sent it. It provides real thumbnails, counts, filenames, paperclip context, and Download all when multiple attachments exist. An invoice included inline in the HTML body remains visible as meaningful message content.

### 5. Email, comments, and workflow events are different things

Front visually distinguishes:

- external or sent email messages;
- internal teammate comments;
- assignment events;
- resolution/archive events.

Mango must not coerce these into one generic email-card shape. They belong in one chronological activity stream but use different semantic and visual item types.

### 6. Controls are contextual and restrained

Sender, recipients, relative time, seen state, attachment indicator, menu, and reply control fit into a compact header. The latest actionable message exposes clear reply controls without four large action buttons dominating every historical item.

### 7. The layout favors scanning

Cards have clear boundaries but remain compact. Whitespace separates meaningful regions rather than inflating short messages. The conversation can be understood by scanning sender, time, authored text, and attachments.

## The correct data model

### A thread is not a list of arbitrary records

A displayed thread is an ordered projection of canonical email messages plus explicitly typed non-email events.

For each email message, the projection needs:

- canonical identity;
- mailbox/account scope;
- provider and grant/source scope;
- provider thread identity;
- sender and recipients;
- sent/received direction;
- authoritative sent/received time;
- subject where useful;
- sanitized full provider body;
- authored-body display projection;
- quoted-history projection and collapsed state;
- attachment identities and ownership;
- read/seen/draft/sent state;
- provenance for local, provider, or collaboration representations.

### Canonical identity

The primary email identity must be based on the provider message identity within its mailbox/provider scope, not on React array position, a thread ID, body text, timestamp alone, or whichever local record happened to load first.

A conceptual canonical key is:

**mailbox scope + provider/grant scope + provider message ID**

The exact implementation may use an existing globally unique ID if its contract is proven, but the scope and provenance must remain explicit.

### Multiple representations must reconcile to one message

The same real message may temporarily exist as:

- a provider-fetched message;
- a locally sent optimistic or completed reply;
- a collaboration/shared snapshot;
- a thread-summary embedded message;
- a detail-fetch result;
- a legacy stored representation.

Those are sources or representations, not separate timeline messages. When two records represent the same canonical provider message, the normalizer must merge or replace them deterministically and render one item.

Important reconciliation cases:

- A local sent reply is shown immediately, then reconciled with the provider copy when the provider message ID becomes available.
- A collaboration snapshot can act as a fallback while provider detail is unavailable, then yields to or merges with the exact provider row.
- Thread hydration and individual detail hydration cannot append the same provider message twice.
- Duplicate provider IDs in a thread message-ID list are fetched once and projected once.
- A retry or refresh cannot create a second visible item.

### Do not use content equality as the sole deduplication key

Two legitimate emails can have the same sender, timestamp granularity, body, or attachment name. Content-based matching may be used only as a tightly constrained reconciliation fallback for legacy or synthetic records, with provenance, bounded timing, and tests that prove it cannot swallow distinct messages.

The system must preserve two genuinely separate messages when their canonical provider IDs differ, even if their visible content is identical.

## Body, quote, signature, and sanitization contract

The stored and provider-fetched full body must remain faithful. Do not destructively rewrite stored email bodies merely to improve the default view.

The display layer may derive:

- **authored content**: the newly written portion shown by default;
- **quoted history**: prior conversation content collapsed behind a deliberate affordance;
- **signature/disclaimer region**: preserved as part of the message, with compact presentation when it is disproportionately long.

Quote handling must recognize common HTML and plain-text patterns, including:

- blockquote elements;
- Gmail quote containers;
- Outlook/Office reply separators and original-message blocks;
- Apple Mail quote containers;
- common “On [date], [person] wrote:” headers;
- forwarded-message and original-message header blocks;
- plain-text lines prefixed with greater-than quote markers.

The extractor must be conservative:

- do not delete legitimate authored text because it resembles a header;
- do not discard inline answers written between quoted paragraphs;
- do not remove signatures that belong to the current author;
- do not break safe HTML sanitization;
- do not turn quoted nested content into top-level timeline rows;
- do not treat the presence of hidden quoted history as proof that the top-level message is unique.

The full sanitized original must remain accessible for fidelity and troubleshooting through a secondary control such as **Show quoted history** or **View original message**.

## Required Mango timeline experience

The completed UI should feel like one cohesive Mango conversation timeline, not a stack of unrelated gray rectangles and not a visual clone of Front.

### Structure

- Use one chronological activity stream.
- Render each canonical email message exactly once.
- Render internal comments and workflow events as distinct item types.
- Make the start and end of each reply unmistakable.
- Keep the connecting timeline treatment subtle enough that message content remains primary.
- Use Mango's existing elevated/neumorphic surfaces and tokens with restrained depth.

### Message header

Each email item must make these easy to find:

- sender name and address;
- sent/received direction;
- time;
- recipients, with compact expansion for long lists;
- attachment indicator/count;
- read/seen or draft state when applicable;
- per-message overflow/action access.

Metadata must wrap or collapse gracefully at narrow widths. It must not force horizontal scrolling.

### Message body

- Show the newly authored content by default.
- Preserve readable HTML formatting after sanitization.
- Constrain oversized images, tables, and fixed-width provider HTML.
- Preserve line breaks without manufacturing huge empty regions.
- Keep signatures readable but visually secondary.
- Collapse quoted history and unusually large disclaimers behind deliberate controls.
- Provide an explicit empty-body state for attachment-only messages.

### Attachments

- Keep every attachment on its originating message.
- Show useful previews when supported.
- Preserve filename, type, size, and download/open actions.
- Support multiple attachments compactly and offer Download all where the existing API supports it.
- Avoid duplicating attachment tiles when message representations reconcile.
- Keep inline content-ID images in the body when they are part of the message rather than presenting them as unrelated downloads.

### Actions

Reply, Reply all, Create shared draft, and Forward must remain usable.

They should be available through contextual controls on the relevant message and clear primary controls for the latest actionable message. Historical rows do not need four permanently prominent buttons each. Keyboard focus, touch access, and accessible labels are required.

Every action must target the canonical message represented by that row. Reply/forward composition must still have access to the full original message and recipient metadata, not only the authored-body projection.

### Responsive and scrolling behavior

- One normal vertical reading surface.
- No page-level horizontal scrollbar for ordinary message HTML.
- Compact behavior for laptops and narrow split panes.
- Touch targets remain usable when actions collapse into an overflow menu.
- Long threads may use incremental rendering or virtualization only if it preserves focus, expand/collapse state, and message order.
- Opening a thread should bring the newest relevant activity into view without hiding the chronological context.

## Required diagnosis before another implementation

Do not assume the duplicate originates in the quote extractor or the React map. Trace the exact real data path.

At minimum, inspect:

1. Provider thread payloads and their message ID lists.
2. Backend Nylas/provider normalization and API shaping.
3. Stored collaboration snapshots and any locally synthesized sent replies.
4. Frontend thread-summary, detail-fetch, sent-reply, and snapshot merge paths.
5. The identity used by each deduplication map.
6. Attachment identity and ownership through every merge.
7. Home Communications and node-attached/shared-email viewers so they do not diverge.

Known current-code starting points include:

- backend/internal/http/nylas_client.go
- frontend/src/modules/communications/communicationsApi.ts
- frontend/src/pages/home/homeUtils.ts
- frontend/src/pages/home/HomePage.tsx
- frontend/src/pages/home/HomeParts.tsx
- frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx

Existing frontend merge helpers already use maps keyed by a message ID in some paths. That does not prove the model is correct. The repeated cards may have different local IDs while referring to the same provider message, may come from separate source layers, or may reflect a backend/provider-shaping problem. Establish the real provenance before choosing the fix.

During development, use a non-production diagnostic representation that can show, for every candidate row:

- mailbox/account scope;
- source kind;
- provider message ID;
- local or snapshot ID;
- provider thread ID;
- timestamp;
- attachment IDs;
- which source won reconciliation.

Do not expose sensitive message content or permanent debug identifiers in the production UI.

## Required implementation sequence

1. **Create a representative regression fixture.** Use a sanitized capture modeled on the exact failing thread, including the duplicated Giang message representation and the distinct earlier messages.
2. **Prove where duplication enters.** Compare provider IDs, backend response rows, collaboration/local rows, and final frontend candidates.
3. **Define one shared canonical normalizer.** It must order, reconcile, and type the activity items independently of UI rendering.
4. **Fix the earliest incorrect boundary.** If the backend emits duplicate representations as distinct messages, correct API shaping without corrupting stored raw fidelity. If duplication is introduced during frontend source merging, fix the shared merge boundary rather than hiding rows inside one component.
5. **Use the same normalized contract in every viewer.** Home Communications, shared/collaboration views, and node-attached email views must not implement competing identity rules.
6. **Then refine body projections.** Quote, signature, disclaimer, and inline-content behavior sit on top of a proven one-message-one-item model.
7. **Then refine the Mango timeline UI.** Apply the compact, responsive, attachment-aware design only after the rendered sequence is semantically correct.
8. **Verify with the real class of thread in a browser.** Do not stop at unit tests or source inspection.

## Required automated tests

### Identity and reconciliation tests

- The exact provider message appearing through two or more source representations renders once.
- The Giang Jul 14 11:13 AM remittance scenario produces one timeline item and one attachment group.
- A local sent reply reconciles with the later provider message instead of remaining as a duplicate.
- A collaboration snapshot reconciles with the exact provider detail message.
- Duplicate IDs in a provider thread message-ID list are fetched/projected once.
- Refreshing or retrying detail hydration does not append a second item.
- Two legitimate messages with different provider IDs remain separate even when sender, body, timestamp, and attachments appear identical.
- The normalizer is deterministic regardless of source arrival order.

### Body and quote tests

- Common Gmail, Outlook, Apple Mail, HTML blockquote, forwarded-header, and plain-text quote formats.
- Conservative handling of authored text that resembles a reply header.
- Interleaved inline replies are not aggressively removed.
- Signatures remain with the current authored message.
- Quoted content is collapsed by default and can be revealed.
- Full sanitized original content remains available to reply/forward and original-view flows.
- Sanitization behavior is unchanged or strengthened; unsafe HTML never re-enters through the expanded-original path.

### Attachment tests

- Attachments remain on the message that sent them.
- Reconciliation does not duplicate attachment groups.
- Multiple attachment previews and attachment-only messages render correctly.
- Inline content-ID images are not duplicated as unrelated files.
- Long filenames, unsupported previews, download failures, and signed-URL refreshes retain usable fallbacks.

### UI and integration tests

- Rendered DOM tests assert the visible message count and exact sender/body occurrence count, not just the presence of helper names in source text.
- Oldest-to-newest order is asserted using distinct message identities and dates.
- Email messages, internal comments, assignments, and resolution events have distinct semantics.
- Reply, Reply all, Create shared draft, and Forward target the selected canonical message.
- Collapsed and expanded quoted-history state is isolated per message.
- Narrow viewport tests prove metadata/action wrapping and the absence of horizontal overflow.
- Long-body, signature, disclaimer, sent/received, read/unread, attachment-only, and empty-body states are covered.

Source-pattern tests may supplement these tests, but they are not acceptable substitutes for behavior-level assertions.

## 2026-07-14 implementation evidence

The remediation branch now uses one shared frontend normalizer for Home/shared and node-attached viewers. It reconciles exact-ID hydrations and narrowly matches local/provisional sent representations to one authoritative provider/collaboration message. It does not collapse distinct provider IDs merely because their content matches, and it does not mutate stored provider bodies or attachment records.

Browser evidence was collected in two parts:

- The signed-in running AP mailbox (the pre-fix server) reproduced the reported before-state: three top-level Giang Tran Jul 14 11:13 AM cards with the same body and Wire Details attachment, followed by the three distinct older messages.
- An isolated browser harness rendered the actual repaired `MessageDetail` component with the screenshot-class fixture. It produced six canonical timeline items from eight input representations; `giang-remittance` appeared once with sources `provider,local`, one attachment group, one expanded newest item, six compact contextual menus, and one primary Reply/Reply all group. Oldest-first was selected, the newest item was at the bottom and in view, switching to Newest first reversed only presentation, and revealing quoted history kept the top-level item count at six.
- At a 720 px constrained layout, the preview surface and conversation both had equal client/scroll widths, proving no horizontal overflow. Sent and received fixtures retained distinct direction markers.

The temporary visual harness was removed after verification and is not production code. Automated identity, quoted-history, and UI contract coverage is maintained in the committed test suite.
## Manual browser acceptance checklist

The work is not complete until a representative real or sanitized equivalent of the compared thread passes all of these checks:

- [ ] The thread contains the expected number of unique provider messages.
- [x] The number of visible email timeline items equals the number of canonical email message identities after reconciliation.
- [x] Giang Tran's Jul 14, 11:13 AM remittance message appears exactly once.
- [x] Its Wire Details attachment appears exactly once and belongs to that message.
- [ ] Luke, Andy/Alee, Claire, Yimin, and Giang contributions appear in correct chronological order.
- [x] The newest activity is at the bottom and brought into view on open.
- [x] Authored text is visible without expanding quoted history.
- [x] Revealing quoted/original history does not add a top-level timeline row.
- [ ] Internal comments and workflow events are visually distinct from email.
- [x] Reply, Reply all, Create shared draft, and Forward remain usable and target the correct message.
- [x] Attachment previews are useful and do not migrate or duplicate.
- [x] Short replies remain compact.
- [ ] Long signatures and disclaimers do not consume an unreasonable portion of the thread by default.
- [ ] Wide provider HTML, images, and tables do not create page-level horizontal scrolling.
- [x] Desktop, laptop split-pane, and narrow/mobile layouts remain readable and actionable.
- [ ] Focus states use Mango design tokens and are clearly intentional.
- [ ] The same thread is compared side by side with the Front reference for count, order, ownership, and scanability.

Record browser screenshots or an equivalent reproducible visual artifact with the implementation evidence. A source diff is not visual acceptance.

## What not to do

- Do not call the problem fixed because quoted history is hidden.
- Do not hide duplicate rows by comparing body strings.
- Do not delete or rewrite stored raw bodies to make the UI look correct.
- Do not treat thread ID as message ID.
- Do not let local replies, collaboration snapshots, and provider detail rows render alongside one another when they represent the same message.
- Do not build another viewer-specific identity rule when a shared normalizer is required.
- Do not add more card styling before proving the rendered message sequence.
- Do not put four permanently prominent actions on every historical card.
- Do not remove legitimate signatures, inline replies, or attachments through aggressive quote stripping.
- Do not rely only on regex/source-text contract tests.
- Do not merge this work again without behavior-level tests and browser evidence from a representative thread.

## Record of the inadequate prior implementation

The failed implementation was produced on:

- Worker branch: **codex/fix-email-thread-reply-timeline0000580**
- Worker commit: **5e41fce4**
- Local main merge commit: **a6845327**

That change introduced an authored-body/quoted-history display projection and a Mango neumorphic timeline treatment. Those are potentially useful pieces, but they were accepted without proving that one real provider message mapped to one visible timeline item.

The screenshots taken after the merge show that:

- the exact same Giang message is repeated;
- the same attachment is repeated;
- every duplicate has its own quoted-history control and action group;
- the large timeline cards magnify the failure;
- passing tests did not cover the real source-reconciliation path;
- the implementation was not validated against the representative provider-backed thread in a browser before being declared complete.

Future agents must preserve any sound sanitization or quote-parsing work only if it fits the corrected identity model. They must not defend the prior design merely because it is already committed.

## Definition of done

This task is complete only when all of the following are true:

1. The duplication source is diagnosed with provider-to-render provenance evidence.
2. One canonical message identity produces one visible email timeline item across all relevant Mango viewers.
3. Local, provider, and collaboration representations reconcile deterministically.
4. Authored content, quoted history, signatures, and full-original fidelity follow this contract.
5. Attachments remain owned by the correct message and are not duplicated.
6. The timeline uses Mango's established design system while matching Front's clarity, chronology, density, and contextual control hierarchy.
7. Focused identity, quote, attachment, and mounted-UI tests pass.
8. The full repository gate passes, with any environment-only exception reported exactly.
9. A representative thread passes the complete manual browser checklist at desktop and narrow widths.
10. The implementation report includes browser evidence and explicitly states the visible message count versus canonical provider message count.

## Copy-paste implementation prompt for a future Codex agent

> Read AGENTS.md, docs/important tasks/makeemailsgood.md, docs/tests/email.md, and the committed email data path before changing code. Diagnose the exact same-message duplication across provider payloads, backend shaping, collaboration/local representations, and frontend merge paths. Implement one shared canonical thread normalizer so one provider message identity renders exactly once while legitimate identical-content messages with different IDs remain separate. Preserve raw body fidelity, sanitization, reply/forward behavior, attachments, and collaboration fallbacks. Then make the Home, shared, and node-attached viewers use one compact oldest-to-newest Mango neumorphic activity timeline with authored content prominent, quoted history deliberately collapsed, attachments owned by their source message, non-email events distinct, and contextual actions. Add behavior-level identity/reconciliation, quote, attachment, DOM, responsive, and action-target tests. Validate a representative version of the screenshot thread in a real browser, prove that Giang Tran's Jul 14 11:13 AM remittance message and Wire Details attachment each appear once, run the full repository gate, review the diff, update the relevant docs, and do not call the work complete without browser evidence.
