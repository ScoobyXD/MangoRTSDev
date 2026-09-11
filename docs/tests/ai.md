# Current AI Removal Business Logic Laws

1. Mango must expose no AI chat, agent execution, tool callback, or AI status endpoint.
2. Mango must render no AI chat composer, history, settings, status, or agent controls.
3. Application startup, tests, and deployment must require no agent runtime, gateway, AI provider credentials, or AI packages.
4. The repository schema and migration plan must define no AI chat, message, run, or action storage.
5. Removing AI must preserve ordinary resources, editors, chats, permissions, relationships, and their existing commands.
6. The independent Deepgram transcription service and authenticated transcription API must remain available.
7. Source removal must perform no live database cleanup or cloud change.
8. Human-run cleanup must remove only `public.ai_actions`, `public.ai_messages`, `public.ai_runs`, `public.ai_chats`, and the exact `20260907_hermes_action_receipts.sql` migration record.
9. Human-run cleanup must commit the table removal and migration-record deletion together or roll them all back.
10. Human-run cleanup must report the connected PostgreSQL version and stop before deletion outside PostgreSQL 17 and 18 or while another migration holds the existing migration lock.
11. Human-run cleanup must reject external table dependencies without cascading and allow already-absent target tables or migration history.

The AI integration has been removed without a replacement. Existing live AI tables and records are untouched by this source change. Removing any live objects or reconciling a recorded migration absent from the repository requires a separately authorized human operation. The migration planner retains its general unknown-history blocker and must not silently repair that history.

The authorized human cleanup is [retire_ai_storage.sql](../../scripts/retire_ai_storage.sql). Run the complete script in DBeaver after deploying the app without AI. It permanently removes the retired AI records for every company in the connected database. Ordinary chats, resources, users, companies, and other migration records remain. If execution stops with an error, run `ROLLBACK;` in the same connection before retrying. Agents do not execute this script against a live database.
