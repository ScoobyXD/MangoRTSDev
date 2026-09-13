# Attachment Deletion Business Logic Laws

1. `attachments.deleted_timestamp` and the original/preview keys are the durable pending-deletion state; cleanup creates no job table or second ownership authority.
2. Removing an owner marks its attachment pending only when no active owner remains in that company.
3. API and email-worker processes wake their own cleanup consumer after each successful command that can retire attachment ownership or remove recycle protection.
4. Each consumer runs once at startup and waits without a database query when no event, known backlog, or failed work remains.
5. Cleanup uses ordered pages of 100 attachments and advances past a failed item before retrying it.
6. An API pass handles at most 1,000 attachments within five minutes and continues from its cursor only while known backlog remains.
7. Failed storage or database work retries after increasing delays from one minute to one hour; new wakes coalesce without shortening an active failure delay, and a settled pass stops retry scheduling.
8. A wake received during a continued pass also revisits earlier attachment IDs after that pass finishes.
9. A finite daily recovery task uses the same cleanup implementation to recover committed work after a lost wake or process crash.
10. Daily recovery must be available in dev and QA before releasing the timer removal; an exceptional lost wake may delay removal of inaccessible bytes until the next successful recovery run.
11. Cleanup rechecks pending state and ownership before destructive work and preserves every attachment or object key retained by a live owner, recycle snapshot, or active upload.
12. Cleanup removes unprotected original and preview objects before finalizing database rows; missing objects count as success.
13. Storage or finalization failure preserves the pending row and all storage keys so a duplicate run or restart can finish partial work.
14. Recycle restore retains exact owner identities and files; permanent purge wakes cleanup even when the attachment was already marked deleted.
15. A Node or Huddle Node textbox recorded only as upload origin does not own the attachment, so deleting that textbox preserves the resource-owned file.
16. Successful sends establish exact sent-message attachment ownership before retiring draft or redundant imported ownership.
17. Upload completion, failed-upload retry, saves, expiry cleanup, previews, downloads, and their existing HTTP APIs retain their current behavior.
18. Recovery exits unsuccessfully on a failed item, database/storage error, time limit, or unfinished item cap and exposes that failure through task logs and infrastructure failure signals.
19. Cleanup and deterministic email re-import hold the same lock for the exact company and attachment through object access and database finalization, so a stale duplicate cleanup cannot delete replacement bytes.
20. Email re-import rechecks the attachment under that lock, reuses a live attachment without uploading, and rejects a still-pending attachment before uploading.
21. Initial rollout and rollback stop all cleanup/import processes that lack the shared lock before running processes that depend on it; older and new images must not overlap.
22. Deleting a CtrlLoop job, including membership or mailbox cascades, must retire all of that exact job's workbook-version links in the deleting transaction.
23. CtrlLoop owner deletion must mark a workbook pending only when no active same-company owner remains and must preserve unrelated files and owners.
24. CtrlLoop deletion must use the existing pending markers and cleanup recovery; original/current pointers must never authorize storage deletion.

## Process Story

A successful owner-removal command commits the existing deletion marker and wakes its process's consumer. The consumer drains bounded pages, preserves protected files, and retries actual failures. When settled it waits silently. Startup and the daily finite task recover committed work if the original wake or process was lost. [The rollout runbook](../infra/attachment-deletion-recovery.md) defines the human prerequisites; repository wiring alone does not mean recovery is deployed.

## Scenarios

1. **Upload and shared ownership:** Complete an upload, save its reference, and retry a failed sibling upload. Both successful files remain usable. Removing one of two owners preserves the shared file; removing the final owner deletes unprotected original/previews before database finalization.
2. **Recycle and send:** Recycle an owning resource, confirm bytes remain, and restore the exact owner and links. Permanent purge wakes cleanup for the existing pending row. Sending a draft preserves its file through the exact sent-message link before draft cleanup.
3. **Recovery and idle:** With more than one batch and a failing first item, later items finish. Missing objects, partial object deletion, metadata errors, and finalization errors remain retryable. A new consumer recovers pending rows without the old channel or cursor; after settlement no periodic attachment-deletion query runs.
