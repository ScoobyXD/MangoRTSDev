# Unified Work Object Proposal

## Working name
**Case** (short, neutral, and works for sales, operations, admin, and incident workflows).

Other good options:
- Work Item
- Thread
- Brief
- Ops Card

Recommended product language:
- Parent object: **Case**
- Child object: **Sub-case** (or Child task)

## Problem statement
Company-critical information is fragmented across email, chat, and disconnected docs. This creates poor visibility, duplicated effort, and delayed follow-up.

## Core idea
Create a single blank object (**Case**) that becomes the source of truth for one piece of work. Every related artifact (emails, messages, notes, files, comments, links, and tasks) is attached to that Case.

## Required capabilities
1. **Fast creation**
   - Create a Case from scratch.
   - Create a Case directly from an incoming email/message.
2. **Ownership clarity**
   - `Responsible` person is visible to everyone.
   - Optional followers/watchers for visibility.
3. **Linked evidence**
   - Attach or link email threads, files, docs, and URLs.
   - Maintain timeline of updates.
4. **Child execution**
   - Create child tasks as linked Cases.
   - Parent Case shows child status roll-up.
5. **Progress transparency**
   - Boss/leadership can review status remotely.
   - Real-time current state and blockers.
6. **Easy updates**
   - Extremely low-friction add/edit/delete/link actions.
   - Mobile-friendly quick update UX.

## Suggested data model

### Case
- `id`
- `title`
- `description`
- `status` (new, in_progress, blocked, done)
- `priority` (low, medium, high, urgent)
- `responsible_user_id`
- `watcher_user_ids[]`
- `parent_case_id` (nullable)
- `due_at` (nullable)
- `created_at`, `updated_at`

### Attachments / Links
- `id`
- `case_id`
- `type` (email, doc, file, url, message, note)
- `source_ref` (URL/message-id/file-id)
- `title`
- `created_by`
- `created_at`

### Activity timeline
- `id`
- `case_id`
- `event_type` (created, owner_changed, status_changed, child_added, note_added, attachment_added)
- `payload` (JSON)
- `created_by`
- `created_at`

## Example workflow (snack order)
1. Buyer emails requesting an order.
2. Employee creates a **Case** from the email.
3. Employee sets self as `Responsible`.
4. Employee creates two child Cases:
   - Inventory check (Operations)
   - Production scheduling (Manufacturing)
5. Parent Case tracks child status and final fulfillment.
6. Manager on vacation can open one Case and understand full progress.

## UX principles
- One-click: “Create Case from email.”
- One-field quick add: notes/links without modal-heavy flows.
- Global search by customer, order, owner, or status.
- Permission-safe visibility with transparent accountability.

## Success metrics
- Reduction in average time to find complete context.
- Reduction in missed follow-ups.
- Percentage of work requests converted into Cases.
- Lead/manager satisfaction on visibility.
