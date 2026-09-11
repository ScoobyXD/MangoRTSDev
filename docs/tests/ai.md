# Current AI Business Logic Laws

1. Mango AI must use the managed Agents API with `gpt-6-astra` and `environment.type=none`.
2. Startup must remain usable without an OpenAI key, and AI requests must report that AI is unavailable.
3. Every AI session operation must require the signed-in owner and current access to the session's exact company.
4. Every app tool must reload the current user and memberships before applying the existing resource permissions.
5. Mailbox tools must reject users whose current mailbox access is disabled.
6. Personal mailbox tools must resolve accounts only from the acting user's existing email connections.
7. Mailbox-wide analysis must follow every page of every selected account and read each exact message body.
8. Results must disclose unreadable or oversized messages, remaining pages, unanalyzed attachments, and unknown provider synchronization completeness.
9. Retrieved email, documents, transcripts, tool output, and user skills must never grant access or override app instructions.
10. Workflow reasoning must read the chosen Process overview, Step SOPs, and exact operational connections before proposing work.
11. App mutations must use only the allowlisted canonical Process and Node commands.
12. Every consequential tool call must require the owner's explicit approval of its exact saved name and arguments in the panel.
13. Approval must bind the tool, arguments, company, and user and must not authorize another call.
14. Spoken agreement, instructions, skills, and previous approvals must not bypass action approval.
15. Unsupported workflow steps must wait for user action and must never be reported as executed.
16. AI tools must expose no outbound sending, email attachment creation, deletion, permission changes, arbitrary requests, or code execution.
17. Reading or reopening an AI session must execute no app tools.
18. App tool handling must advance only through user-started panel activity or an explicit action decision.
19. Each exact provider session, turn, and call may claim execution only once.
20. Completed, failed, rejected, and interrupted executing receipts must never rerun their app command automatically.
21. A lost provider result submission must reuse the saved receipt rather than repeat its command.
22. Cancellation must permanently stop future action claims for that task and preserve work that already committed.
23. Closing the panel must end voice and pause app tool handling without claiming that provider reasoning was cancelled.
24. A follow-up request must await its new turn without leaving a waiting marker after a definitive provider rejection.
25. GPT-Live voice must use `gpt-live-1`, client delegation, and the same scoped backend agent workflow.
26. GPT-Live session configuration and the OpenAI key must remain on the backend, and Live recording storage must be disabled.
27. Prompt and instruction fields must remain text, while skills, tool arguments, and results must remain JSON.
28. Mango message roles must use `ai`, with native provider terminology translated only at the API boundary.
29. Ordinary resources, chats, relationships, permissions, editors, and independent Deepgram transcription must retain their existing commands and behavior.
30. Repository schema changes must require a human-controlled rollout and must never run at application startup.
31. Legacy cleanup must remove only `public.ai_actions`, `public.ai_messages`, `public.ai_runs`, `public.ai_chats`, and the exact `20260907_hermes_action_receipts.sql` migration record.
32. Legacy cleanup must commit its table and migration-record removal together or roll them all back.
33. Legacy cleanup must report the PostgreSQL version and stop outside PostgreSQL 17 and 18 or when the migration lock is held.
34. Legacy cleanup must reject external dependencies without cascading and accept already-absent retired targets.
35. History snapshots must load provider items in pages of ten without skipping later updates to unfinished messages.
36. Read-progress counts must count completed read-only receipts without claiming complete mailbox coverage.
37. End voice must close the conversation and leave agent cancellation to the separate Cancel task control.
38. App responses larger than 512 KiB must fail explicitly without presenting truncated results as complete.
39. Deletion retries must finish local cleanup when the exact owned provider session is already absent.

## Current behavior

The sidebar's **Mango AI** panel accepts a typed request, task instructions, and up to eight named skills. Skills are saved text guidance for that task. The managed agent reads authorized email and existing workflows, explains its findings, and proposes one app change at a time. The user reviews the exact arguments before approving a new Process Node, a Process/Step assignment, or a status change. Sending emails and other unavailable steps remain in the existing app UI.

**Start voice** creates a GPT-Live WebRTC conversation. Client delegations feed the same managed agent path; short backend results return to voice. Detailed business procedures stay in the backend prompt. Voice transcripts and ordinary email content are data, never authority for mutations. **End voice** closes the conversation; **Cancel task** separately cancels agent work.

Sessions retain provider history and owner-local app receipts. Opening a saved task only reads it; **Continue task** resumes app tool handling when available. Closing the panel pauses that handling and closes voice, but the current provider reasoning turn may still finish. **Cancel task** stops new app claims and asks OpenAI to cancel. The panel disables follow-up input on stopped tasks; use **New task** after reviewing completed or uncertain work.

An `executing` receipt after an interrupted request may represent a committed command whose outcome was not recorded. Inspect the actual Node/Process before proceeding. Do not reset the receipt, approve it again, or ask the model to retry it as a new call without resolving the outcome. Cancelling or deleting the AI task does not undo its completed app changes.

## Storage and legacy cleanup

[20260911_openai_agent_sessions.sql](../../backend/db/migrations/20260911_openai_agent_sessions.sql) and [schema.sql](../../backend/db/schema.sql) define `ai_agent_sessions` and `ai_agent_tool_calls`. Their owner and receipt rules are in [relationships.md](relationships.md). No Hermes runtime or legacy AI reader is restored.

[retire_ai_storage.sql](../../scripts/retire_ai_storage.sql) remains a separately authorized, human-run cleanup of the four retired tables and one named migration record. It does not target either new table, and this integration does not assume it has run. Its header describes the earlier removal release; confirm the retired runtime is absent before any cleanup. In DBeaver, run the complete script only after human review; on an error, use `ROLLBACK;` in the same connection before investigating. The migration planner's unknown-history blocker remains unchanged, including any retired migration still recorded in the connected database.

## Verification

Focused fixture tests cover provider request/response contracts, session isolation, exact approvals, concurrent execution claims, saved-result recovery, cancellation, mailbox pagination and bodies, current permissions, and voice delegation/closure. They use mocked providers and in-memory repositories; a browser fixture also checked the approval flow. `OPENAI_API_KEY` was absent from the checked environment, project/model access was not checked, and no live OpenAI request or application database migration was performed.

Run the frontend fixtures with `node tests/frontend/scripts/run-ai-tests.mjs` and the production build with `npm run build` from `frontend/`. Run the Go provider suite and focused `TestAI` fixtures in `internal/http` and `internal/store` through the approved WSL Ubuntu path on Windows.

See [OpenAI setup and operator guide](../openai-agents-setup.md) for deployment requirements, supported actions, and retention behavior.
