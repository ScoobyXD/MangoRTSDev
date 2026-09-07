# Hermes Integration Business Logic Laws

Status: accepted design; not yet implemented. Start with the HTTP integration. Scheduled exports, backups, S3 storage, and PostgreSQL archive imports are later work.

1. Mango must connect to the self-hosted Hermes HTTP server through its existing authenticated Go backend.
2. Hermes must maintain its native working data, including memory notes, learned skills, session SQLite databases, and cron data, on persistent storage.
3. The backend must bind each run and its private working data to the authenticated user and selected company.
4. Requested Mango actions must use existing backend commands and their current permission checks.
5. Mango-controlled infrastructure must run scheduled exports and backups when archival is implemented.
6. Raw backup files must be stored in private S3 storage.
7. Memory and history records Mango needs to search must be imported into PostgreSQL with their existing user, company, and source access restrictions preserved.
8. Archive automation must verify export and backup completeness before treating a copy as successful or allowing retention cleanup to rely on it.

## Process story

The user chats with Hermes through Mango and requests Mango actions. Hermes maintains its working memory and history in its native persistent storage. Later, Mango-controlled infrastructure exports searchable records into PostgreSQL and stores recovery backups in private S3 storage. Exporting data does not automatically make the archive available to Hermes; archive retrieval and shared company learning are separate later capabilities.

The integration should stay close to upstream Hermes, using its HTTP API and supported extensions instead of replacing its storage internals. Use a pinned Hermes version and verify upgrades before deployment. The first integration starts fresh from the existing Mango app; it does not restore the deleted `ai/` folder or `docs/tests/AI&MCP.md`.

References: [Hermes persistent storage](https://hermes-agent.nousresearch.com/docs/user-guide/docker/#persistent-volumes), [session exports](https://hermes-agent.nousresearch.com/docs/user-guide/sessions/#export-sessions), [full backups](https://hermes-agent.nousresearch.com/docs/reference/cli-commands/#hermes-backup), [AWS S3 object storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html).
