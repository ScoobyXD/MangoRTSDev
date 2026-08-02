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
---

The short version: Nylas is limiting in places, but it is not the reason screenshot #1 is broken. Mango damages that forwarded message before Nylas sends it. Nylas can support much of the desired experience if Mango builds the right product layer around it.

The useful mental model is simple: an email thread is a collection of separate messages. Each message has its own identity, body, attachments, and reply links. A forward is a new message containing a safe, faithful copy of an old message—not plain text scraped from its HTML.

I found the referenced charter at [docs/important tasks/makeemailsgood.md](</C:/Users/Jonat/.codex/worktrees/1250/MangoRTSDev/docs/important tasks/makeemailsgood.md:1>), rather than `docs/tests/makeemailsgood.md`.

## 1. Email threads

Gmail primarily uses its thread ID plus reply headers and matching subjects. Microsoft exposes similar conversation IDs and standard message headers. Nylas normalizes those provider conversations into `thread_id`, `message_ids`, and individual message objects. Front follows provider/header relationships, displays each real message once, and always presents the conversation oldest-to-newest. [Gmail threading](https://developers.google.com/workspace/gmail/api/guides/threads), [Microsoft message model](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0), [Nylas Threads API](https://developer.nylas.com/docs/v3/email/threads/), [Front threading](https://help.front.com/en/articles/2039).

Mango now has the correct foundation: [emailThreadMessages.ts](/C:/Users/Jonat/.codex/worktrees/1250/MangoRTSDev/frontend/src/modules/communications/emailThreadMessages.ts:173) reconciles provider, collaboration, and temporary local copies before rendering. It scopes identity by mailbox plus message ID, keeps legitimate separate messages separate, and displays oldest-to-newest with quoted history collapsed.

What remains is product hardening:

- Prove the real provider-backed AP thread has exactly one visible item per provider message.
- Finish the unchecked visual cases: long signatures, wide marketing HTML, focus styling, comments/events, and side-by-side Front comparison.
- Manual “Split conversation” and “Merge conversations” controls are intentionally deferred; they are not part of the current thread work.
- Never group messages merely because their subjects or bodies look alike.

## 2. Forwarding

The failure shown in screenshot #1 is explained directly by [HomePage.tsx](/C:/Users/Jonat/.codex/worktrees/1250/MangoRTSDev/frontend/src/pages/home/HomePage.tsx:260). Mango currently removes HTML tags with a regular expression, but leaves the text inside `<style>` blocks. That is why the recipient sees `@font-face`, Outlook CSS, and layout rules as prose. It also destroys the Equifax design and does not automatically carry the original attachments into the forward.

Nylas sends the HTML body and attachments Mango supplies; it does not magically reconstruct the original message. [Nylas Send Message](https://developer.nylas.com/docs/reference/api/messages/send-message/). Outlook’s native forwarding APIs preserve the original message and attachments, while Front offers both “Forward in this conversation” and “Forward as a new conversation.” [Microsoft forwarding](https://learn.microsoft.com/en-us/graph/api/message-createforward?view=graph-rest-1.0), [Front forwarding](https://help.front.com/en/articles/2247).

The correct Mango implementation should:

- Start from the complete original message, not its snippet or plain-text approximation.
- Preserve the sanitized HTML body as one locked forwarded block.
- Remove scripts, forms, hidden trackers, and unsafe content without flattening visible styling.
- Reattach ordinary attachments automatically.
- Resolve `cid:` inline images and give them new outbound content IDs.
- Preserve visible remote banners/images through a safe image proxy or forwarded inline copy.
- Show a real send preview using the same rendering path the recipient will receive.
- Offer “Forward as attachment (.eml)” when exact original fidelity matters.
- For now, Forward is a new outbound message with preserved original context; conversation split/merge and alternate in-conversation forwarding controls are intentionally out of scope.

That work should be the immediate priority because today’s behavior can send visibly corrupted mail to customers.

## 3. Calendar invitations and meeting links

Mango already detects `.ics`/`text/calendar` messages, resolves the event securely through its calendar UID, and sends Accept/Tentative/Decline through Nylas. The existing slice is documented in [calendar-invite-rsvp.md](/C:/Users/Jonat/.codex/worktrees/1250/MangoRTSDev/docs/tasks/calendar-invite-rsvp.md:1), with the current controls in [HomeParts.tsx](/C:/Users/Jonat/.codex/worktrees/1250/MangoRTSDev/frontend/src/pages/home/HomeParts.tsx:4188).

But this is only three buttons. Gmail, Outlook, and Front treat an invitation as an event card: title, date, timezone, organizer, attendees, location, availability/conflict, current response, and a prominent Join button. Nylas already exposes event timing, participants, location, RSVP state, and conferencing details for Google Meet, Teams, Zoom, WebEx, and others. [Nylas Calendar API](https://developer.nylas.com/docs/v3/calendar/), [Nylas conferencing](https://developer.nylas.com/docs/v3/calendar/add-conferencing/), [Nylas RSVP](https://developer.nylas.com/docs/reference/api/events/send-rsvp/), [Front Calendar](https://help.front.com/en/articles/2237).

Recommended next step:

- Replace the generic invitation strip with a proper event card.
- Load the authoritative Nylas event and display its date/timezone, organizer, attendees, location, response, and conferencing URL.
- Add `Join meeting`, `Open in calendar`, and `Copy meeting link`.
- Persist the provider response so it survives refresh; the current UI remembers it only in component state.
- Reconcile cancellations, reschedules, and event updates through calendar webhooks.
- Treat the full day/week/month calendar as a later project. The email-invite experience can become excellent first.

## 4. Read receipts

Mango already enables Nylas open tracking on every outbound send and stores `message.opened` timestamps. The current [MessageReadReceiptChip.tsx](/C:/Users/Jonat/.codex/worktrees/1250/MangoRTSDev/frontend/src/pages/home/MessageReadReceiptChip.tsx:12) correctly warns that the recipient’s identity is unavailable.

The hard truth: Nylas records a tracking-pixel download, not a verified human read. Image blocking causes missing signals; Gmail, security gateways, and Apple privacy proxies can create immediate or false signals. Nylas itself recommends treating opens as soft signals. [Nylas open tracking](https://developer.nylas.com/docs/cookbook/use-cases/build/track-email-opens/).

Front gets closer to the screenshot by sending separately tracked copies when it can. It tracks names separately for up to four recipients; five or more lose names, and Office 365 cannot provide named multi-recipient tracking through Front’s approach. [Front Seen receipts](https://help.front.com/en/articles/2034).

My recommendation for Mango:

- Call the external signal `Likely opened`, not definitively `Read`.
- For one recipient, display the contact name as inferred attribution, with the reliability warning.
- For multi-recipient messages, remain anonymous unless Mango deliberately adopts separate-per-recipient sends.
- Do not silently split multi-recipient mail: it affects Sent folders, threading, Cc/Bcc semantics, rate limits, and provider behavior.
- Track three confidence levels: `Likely opened`, `Link clicked`, and `Replied`.
- Group repeated activity as `David Phuong · 16 opens`, then expand to timestamps—cleaner than repeating the same name 16 times.
- Track Mango teammates separately with exact internal `Seen by` events. Internal app reads can be authoritative; external email opens cannot.
- Provide a mailbox-level tracking/privacy setting and appropriate disclosure.

Native Gmail and Outlook read-receipt requests are a separate mechanism, but they are also optional and unreliable: Gmail restricts them to eligible work/school accounts, and Outlook recipients can refuse them. [Gmail receipts](https://support.google.com/mail/answer/9413651), [Outlook receipts](https://support.microsoft.com/en-us/outlook/change-how-outlook-processes-read-receipts-and-meeting-responses).

## Recommended order

1. Fix forwarding fidelity and attachments.
2. Complete real-browser acceptance for threaded conversations.
3. Build the full invitation card with Join/Open/RSVP state.
4. Improve receipts with honest confidence levels and grouped history.
5. Only then consider named multi-recipient tracking and a complete calendar workspace.

Worktree: `C:\Users\Jonat\.codex\worktrees\1250\MangoRTSDev`
Branch: `codex/plan-email-user-experience0000590`
HEAD: `013b35ca7b860009b9a7727b381b596c86cc0296`
Final Git status: clean; no code or documentation changes, commits, merges, or pushes.

<oai-mem-citation>
<citation_entries>
MEMORY.md:47-49|note=[thread reconciliation and viewer routing context]
MEMORY.md:198-199|note=[exact account read receipt storage context]
MEMORY.md:1038-1046|note=[Nylas provider boundary and email architecture context]
</citation_entries>
<rollout_ids>
019f641b-9ac6-7802-b4f2-9b2e69535763
019f5f17-6245-7e23-8241-ad33ba917e4e
019f43ef-b078-7ea2-9f35-f5be5133c50a
</rollout_ids>
</oai-mem-citation>

## Implementation status — worker branch

This worker keeps the existing canonical oldest-to-newest thread timeline and deliberately does **not** add Split conversation or Merge conversations controls.

The email experience in this branch now reflects the product decisions above:

- Forward is an explicit draft/send mode, separate from Reply. It does not send a reply reference or accidentally continue the source thread.
- The full original message is kept as a locked, sanitized HTML block instead of being flattened into plain text. Visible email styling is retained while scripts, forms, unsafe URLs, and obvious tracking pixels are removed.
- Ordinary original attachments and referenced inline images are copied into Mango's forward draft. Copied inline images are rewritten to durable Mango attachment references before send.
- The compose screen shows a locked forwarded-message preview produced by the same forwarding renderer used for the outbound body.
- Calendar invitations render through one shared event card in both Home email and node-attached email. It shows the authoritative provider event title, time/timezone, organizer, guests, location, saved RSVP state, meeting link, and calendar link when Nylas supplies them.
- External open tracking is labeled **Likely opened**. Exact provider identity is used only when actually reported; a single recipient may be labeled as inferred; multi-recipient unknown activity remains anonymous. Repeated signals are grouped under one person/unknown label with every available timestamp.

Still intentionally outside this change: manual thread splitting/merging, forwarding as an `.eml` attachment, safe proxying of every remote image, calendar conflict detection/webhook reconciliation, separate-per-recipient multi-send tracking, and a full calendar workspace.

## Current implementation progress (July 2026)

This section is the authoritative current status. The research and recommendations above remain as the original project context.

### Email threads - implemented

- Mango keeps canonical provider/header thread identity, exact mailbox scoping, one visible item per canonical message, and deterministic conversation rendering.
- Manual **Split conversation** and **Merge conversations** controls remain deliberately deferred.

### Forwarding - implemented

- Forward is an explicit draft/send mode, separate from Reply, and never sends a reply reference that would accidentally continue the source thread.
- The complete original message is retained as a locked, sanitized HTML block. Safe visible HTML/CSS survives while scripts, forms, unsafe URLs, event handlers, and obvious tracking pixels are removed.
- Ordinary source attachments and referenced inline images are copied into the exact Mango forward-draft scope. Inline CIDs are rewritten to copied durable attachment references and the existing 24,000,000-byte outbound limit is enforced before copying.
- Compose displays a locked preview produced by the same forwarding renderer used to construct the outbound body; partial attachment-copy failure remains visible and recoverable.

### Calendar invitation email experience - implemented

- Home email and node/project-attached email use one shared event card backed by authenticated invitation UID resolution plus the authoritative Nylas event.
- The card displays available title, time/timezone, organizer, guests, location, current RSVP, meeting join/copy controls, and provider calendar link. Accept, Tentative, and Decline show saved state only after provider success.

### Read receipts - implemented

- External open tracking is labeled **Likely opened**, never definitive Read/Seen. Provider-reported identity is used only when present; a sole recipient may be labeled **inferred**; unknown multi-recipient activity remains anonymous.
- Repeated signals are grouped under one identity/unknown label and every distinct provider timestamp is available on hover or keyboard focus with a tracking-pixel reliability warning.

### Verification

- Forwarding, draft semantics, calendar event lookup/card usage, communications API requests, thread-viewer contracts, and receipt presentation have automated coverage.
- The complete repository gate passes: frontend relationship/feature tests, production build, backend Go tests, and infrastructure attachment contracts.

### Still deliberately deferred

- Manual thread split/merge, forwarding as an `.eml` attachment, proxying every remote image, calendar conflict detection and webhook reconciliation, separate-per-recipient multi-send tracking, and a full calendar workspace.
- The next quality step is real-provider/browser acceptance against representative complex threads, forwarded marketing/Outlook HTML, and live Google/Microsoft invitations.
## Mango Front email thread comparison number two

### Scope and implementation boundary

This comparison records the second Mango-versus-Front review of the exact same conversation:

**Re: [EXTERNAL] Re: Payment - POs 2026-00-28449, 2026-00-28450, and 2026-00-28451**

The evidence was reviewed in the user's exact screenshot order. Screenshots 1 through 16 are Mango; screenshots 17 through 24 are Front. The Front set is intentionally incomplete because the real Front conversation contains more messages than were captured.

This section is documentation only for the item 5 thread-data problem. The item 5 data/reconciliation fix is deliberately deferred. The separate item 4 opening-state defect shown by screenshots 1 and 2 is addressed by the current triage-behavior work, but that does not prove or repair the missing/duplicate message history documented here.

### What the screenshots show, in exact order

| Screenshot | Product | Evidence |
| --- | --- | --- |
| 1 | Mango | The selected inbox card advertises a four-message conversation, but the detail pane initially shows only the latest Giang Tran message from July 15 at 1:19 PM. There is no visible timeline proving that this is a thread. |
| 2 | Mango | The same selection later changes into a long timeline without a new deliberate thread-opening action. Several collapsed and expanded cards appear, proving that screenshot 1 was an incomplete transient presentation. |
| 3 | Mango | The earliest clearly visible Mango card is Giang Tran on July 8 at 7:12 AM. Mango therefore presents this conversation as beginning roughly one week before the latest message. |
| 4 | Mango | Expanding quoted content exposes a large nested prior reply from Luke Mendoza and Pilar Barrabes instead of keeping each real provider message as a clean independent timeline item. |
| 5 | Mango | Another Giang reply includes Pilar's prior message and large inline order screenshots inside quoted history, making one card contain a substantial copy of earlier conversation state. |
| 6 | Mango | The same quoted body continues across a very tall area with multiple order images, signatures, and disclaimers. This creates a false sense that one message is the whole thread. |
| 7 | Mango | Another expanded body again includes prior sender headers, prior authored text, signatures, and disclaimers. Distinct authored content and copied history are difficult to distinguish. |
| 8 | Mango | Two consecutive Giang Tran cards have the same July 13 11:37 AM timestamp, sender, recipients, and pricing-request body. A third copy begins below them. |
| 9 | Mango | The duplicate July 13 11:37 AM Giang message is visible again before the next Pilar card. This is direct visible duplicate evidence, although the screenshots do not expose provider IDs. |
| 10 | Mango | Pilar's July 14 card contains order imagery and then another embedded copy of the July 13 Giang message, multiplying content that should remain collapsed quoted history. |
| 11 | Mango | Luke's reply contains another long embedded copy of Pilar's earlier message, signatures, and prior headers. |
| 12 | Mango | The nested quoted chain continues into the July 8 messages, so the user must read repeated history inside cards while still lacking Front's older real messages. |
| 13 | Mango | More inline order imagery and signatures continue inside the expanded quoted chain, consuming a large amount of vertical space. |
| 14 | Mango | Near the newer end, several collapsed Giang July 15 1:19 PM cards appear consecutively with the same sender, time, and preview. |
| 15 | Mango | At least three expanded copies of the same Giang July 15 1:19 PM remittance message are visible. Each copy repeats the same body and Wire Details PDF attachment. |
| 16 | Mango | Additional copies of that same July 15 message and attachment continue. The attachment alternates between preview states but remains visibly repeated as if owned by multiple messages. |
| 17 | Front | Front shows a message from approximately one month earlier, from Luke Mendoza, with 11 purchase-order attachments and a detailed production table. This alone proves Mango's July 8 start is not the true start of the conversation. |
| 18 | Front | Separate Juan Flores and Stefanie Regalado messages appear as clean cards. Each card contains its own authored content and a small quote-toggle affordance instead of expanding copied history by default. |
| 19 | Front | Separate Luke and Stefanie messages continue in chronological context with no visible duplicate cards. |
| 20 | Front | Pilar's message owns its own 11 attachments and its own authored response. Attachment ownership is visually unambiguous. |
| 21 | Front | Separate Giang and Pilar cards continue the older conversation. Their authored content is readable without automatically repeating the entire prior chain. |
| 22 | Front | Luke's revised purchase-order attachment, another Luke reply, and Pilar's production-date response appear as distinct messages. Front also shows workflow context between messages without confusing those events with email bodies. |
| 23 | Front | Pilar's production-date table remains part of that exact message body and is not duplicated into neighboring message cards. |
| 24 | Front | The captured Front history reaches the recent July messages, including Luke, Giang, and the three purchase-order images. It cleanly connects the older month-long conversation to the period Mango displays. |

### What Mango is doing wrong

1. **Mango's visible history is incomplete.** Front proves that the conversation includes many real messages from approximately one month earlier. Mango begins around July 8, so older canonical members are missing from the selected thread.
2. **Mango visibly duplicates messages.** The July 13 11:37 AM Giang request appears repeatedly, and the July 15 1:19 PM Giang remittance message appears at least three or four times. Sender, timestamp, recipients, body, and attachments match. The screenshots cannot prove whether the duplicate rows share one provider message ID, so the future implementation must capture identity provenance instead of deduplicating only by visible text.
3. **Mango visibly duplicates attachment ownership.** The Wire Details PDF is repeated under each duplicate July 15 card. An attachment must belong to one canonical provider message and render once with that message.
4. **Mango mixes real messages with copied quoted history.** Expanded cards contain prior headers, signatures, order images, disclaimers, and earlier replies. This makes repeated quote payloads look like additional thread chronology while real older messages are absent.
5. **Mango has an unstable opening state.** Screenshot 1 paints one latest message even though the row reports four messages; screenshot 2 later replaces it with a timeline. That transition is jarring and makes the user doubt whether thread history exists.
6. **Mango's timeline is too tall and noisy when quotes are expanded.** Repeated signatures, disclaimers, embedded images, and copied headers dominate the view. The user cannot quickly identify what each person newly wrote.
7. **Mango has not yet proved source completeness.** A clean-looking timeline is not enough. The product must prove that every authoritative provider thread member was fetched, reconciled, and represented exactly once.

### What Front is doing right

1. **Front presents a much longer canonical history.** The same conversation reaches back approximately one month and includes messages that Mango never shows.
2. **Front gives each real message one clear card.** Sender, recipients, age, authored body, attachments, and message actions are owned by that card.
3. **Front keeps quoted history optional.** The small quote-toggle/ellipsis affordance allows the user to reveal the complete historical quote carried by a specific message without making that copied history the default timeline.
4. **Front keeps attachments attached to their source message.** Eleven purchase orders belong to the relevant Luke or Pilar message; a revised purchase order belongs to the later Luke message; recent order images belong to the recent message. They do not repeat under duplicate cards.
5. **Front separates conversation chronology from workflow context.** Assignment, waiting, snooze, topic, and status events appear between messages as contextual activity, not as fake email bodies.
6. **Front remains readable even when the conversation is long.** Authored content is prominent, repeated quotes are collapsed, and signatures do not obscure the message-to-message sequence.

### Important interpretation of Front's quote toggle

The Front screenshots suggest that each message's ellipsis/quote control can reveal the full quoted chain carried inside that provider message. That quoted chain can be very long because it represents everything copied into that one message at send time. It is not evidence that those copied blocks are additional canonical messages.

Mango must therefore preserve two separate truths:

- **Canonical thread chronology:** one timeline item per real provider message identity.
- **Per-message full body fidelity:** the unchanged body for that exact message, including quoted history, available only through an explicit Show quoted history action.

Mango must never manufacture timeline items from quoted headers, and it must never use quoted content as a substitute for provider messages missing from canonical thread membership.

### Likely failure boundaries that the future implementation must prove

The screenshots identify symptoms, not the exact failing layer. A future implementation must collect evidence at every boundary:

1. Record the provider thread ID and ordered authoritative provider message IDs for this exact mailbox.
2. Record every thread-list page token and message ID returned by Nylas, including whether the oldest pages were exhausted.
3. Record which authoritative IDs required exact Get Message hydration because they were absent from bounded preview pages.
4. Record every collaboration snapshot, locally sent provisional reply, cached detail, and provider row offered to the frontend normalizer.
5. For every visible timeline card, record the canonical scoped identity and source representations that produced it.
6. For every attachment group, record the one canonical message identity that owns it.
7. Compare the canonical provider message count with the mounted visible card count.

No fix should be accepted if it merely hides visually identical cards. Distinct provider IDs with identical text can be legitimate messages; the correction must reconcile representations of the same identity while preserving genuinely distinct messages.

### Required future correction

1. Fetch authoritative thread membership first and continue until every message ID is either hydrated or reported as a specific recoverable failure.
2. Reconcile provider, collaboration, cache, and local/provisional representations by exact mailbox-scoped message identity.
3. Use conservative semantic matching only for one temporary local send that is becoming one provider message; never collapse two distinct provider IDs because their text looks the same.
4. Render one chronological item and one attachment group per canonical provider message.
5. Show only newly authored content by default. Keep the unchanged complete provider body behind Show quoted history on that exact message.
6. Keep signatures and disclaimers faithful inside full-body view, but prevent them from becoming timeline structure.
7. Hold a stable Loading conversation state until a known thread can mount as a thread; do not paint one message and later swap the whole layout.
8. Validate this exact AP conversation in a real browser and compare it directly with Front.

### Acceptance checklist for comparison number two

- The canonical provider thread contains the same oldest-to-newest real messages that Front exposes for the captured period.
- Mango does not begin at July 8 when older provider members exist.
- The July 13 11:37 AM Giang pricing request appears exactly once per provider message ID.
- The July 15 1:19 PM Giang remittance message appears exactly once per provider message ID.
- The Wire Details PDF appears once under its owning canonical message.
- Older month-level messages and their attachments appear without being reconstructed from quoted text.
- Opening the row never shows a false single-message state before the thread.
- Every card's Show quoted history reveals only that card's unchanged provider body.
- The visible card count equals the canonical provider message count after reconciliation.
- Tests cover missing preview members, repeated provider IDs across sources, legitimate identical-content messages with distinct IDs, local-to-provider send reconciliation, repeated attachments, and incomplete pagination.
- Browser evidence records the provider ID count, visible card count, first visible message date, last visible message date, and screenshots at desktop and narrow widths.

### Explicit non-completion statement

This comparison documents item 5 in detail but does not implement the missing/duplicate thread-data correction. Item 5 remains open until the provider-to-render provenance trace and the acceptance checklist above pass on the representative AP thread.
