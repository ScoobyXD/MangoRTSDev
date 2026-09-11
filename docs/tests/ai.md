# Current AI Removal Business Logic Laws

1. Mango must expose no AI chat, agent execution, tool callback, or AI status endpoint.
2. Mango must render no AI chat composer, history, settings, status, or agent controls.
3. Application startup, tests, and deployment must require no agent runtime, gateway, AI provider credentials, or AI packages.
4. The repository schema and migration plan must define no AI chat, message, run, or action storage.
5. Removing AI must preserve ordinary resources, editors, chats, permissions, relationships, and their existing commands.
6. The independent Deepgram transcription service and authenticated transcription API must remain available.
7. Source removal must perform no live database cleanup or cloud change.

The AI integration has been removed without a replacement. Existing live AI tables and records are untouched by this source change. Removing any live objects or reconciling a recorded migration absent from the repository requires a separately authorized human operation. The migration planner retains its general unknown-history blocker and must not silently repair that history.
