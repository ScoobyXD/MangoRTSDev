# Hermes Integration Business Logic Laws

1. Mango must follow Hermes's native storage conventions where applicable, storing plain text as text and structured data as JSON while preserving native identities.
2. Mango must connect to the pinned self-hosted Hermes HTTP Runs API through its existing authenticated Go backend and shared frontend transport.
3. Exactly one Hermes container and native gateway must serve all configured company/user profiles through one private origin and native /p/<profile> routes.
4. A Hermes home must reject another company/user binding and retain native memory, learned skills, session SQLite databases and response data across restarts.
5. Every `ai_chats`, `ai_messages`, `ai_runs` and `ai_actions` row must contain the exact existing `company_id` and `user_id`.
6. Every AI relationship must include its company/user scope and must grant no business-resource access.
7. A chat must represent the whole exchange and may be saved empty without invoking Hermes.
8. A message must preserve its native integer ID, original timestamp and visible text, using only `user` or `ai` as its stored and public role.
9. Native message IDs must provide insertion order without a separate position column or a guess based on matching text.
10. Message imports must reject changes to an existing native identity and leave the optional run link empty unless the source proves it.
11. Complete native display snapshots must remove obsolete copied message representations only after their full message import succeeds.
12. A run must have one local UUID before admission and an optional native execution ID after acceptance.
13. One company/user pair must have only one nonterminal run; the first submission under a run ID must win, including its original chat and text.
14. Uncertain retries must reuse the saved submission; an unbound submission older than 23 hours must close without another native admission.
15. One status must describe pending, running, stopping, completed, failed, cancelled or interrupted execution; late responses must never reopen a stopping or terminal run.
16. Pending input must clear when the native execution is bound or the run reaches a terminal status.
17. Lifecycle changes and committed actions must append durable run history in the same transaction as their state change.
18. Supported Hermes hooks must capture model, tool and reply observations through a durable FIFO callback queue independently of browser streaming.
19. Repeated history event IDs must preserve their immutable payload, append no duplicate event and repeat no transcript effects; delivery must acknowledge only after those effects complete.
20. Run history and visible messages must exclude raw provider reasoning, credentials, hidden instructions and raw tool payloads.
21. A session-end callback must confirm native terminal status before acknowledgement, using durable delivery retries when execution is still finishing.
22. Each browser request and private callback must recheck current company membership; model arguments must never choose actor, company, credentials or endpoints.
23. Mango must reject unconfigured scopes, multiple gateway origins and native services without durable admission deduplication.
24. Only explicit Send may submit a draft; Enter and dictation must never invoke Hermes.
25. Account or company changes must clear visible drafts and history, cancel dictation and reject late results from the previous scope.
26. Saved chats must read Mango's durable visible messages, while interrupted streams must recover using the same saved local run without resubmitting work.
27. Only one browser may consume a native run stream at a time; all public run IDs must be Mango's local UUIDs.
28. Mango action handlers must require a currently running native execution bound to the exact local admission key; a shared chat alone must never establish that association.
29. Process and Node tools must use current permissions and existing canonical business commands, identities, relationships and committed events.
30. `ai_actions` must be the single table for every committed AI mutation, keyed by scope, local run, action name and normalized argument key, with the command result stored as JSON.
31. Identical Node creation arguments within one run must return one durable result regardless of UUID case or tool-call ID, with no duplicate Node or committed event.
32. An action result, business change and action history event must commit atomically or all roll back.
33. Replaying an action must never recreate a subsequently deleted business resource.
34. Stop must close Mango action admission before native cancellation and preserve already committed actions.
35. Membership removal must deny access while retaining historical retry protection; permanent company or user deletion must cascade through Mango AI records.
36. Runtime provider credentials must remain in server memory, OAuth authorization must use native profile storage, and no credential may enter browser responses, tools, logs or plaintext configuration.
37. Native memory, skills and web tools must remain enabled, while general shell, filesystem, delegation and scheduled execution tools remain unavailable; private integrations require their own profile authorization and exact discovered tool selection.
38. Missing Hermes configuration must preserve ordinary Mango behavior, typed drafts and independent Deepgram dictation.
39. The application runtime must require PostgreSQL AI storage before enabling Hermes; in-memory AI storage must remain a test fixture.
40. Scheduled jobs and scheduled runs must remain outside this implementation.
41. History callbacks with an unknown native execution must wait for exact admission binding and must never bind themselves by chat alone.
42. Definitively rejected history must remain in the scoped durable queue for inspection, while later runs may proceed and no rejected run may apply a partial snapshot marker.
43. A completed visible reply must remain displayed while its durable transcript delivery is pending; explicit Resume must refresh it without resubmitting work.
44. Active-run conflicts must identify and open that run's exact scoped chat.
45. Full visible transcript snapshots must occur at initial input and run completion, and `run.finished` must be queued only after the final complete snapshot is durably queued.
46. Tool callbacks must append tool observations without copying the full transcript.
47. Unchanged run state and acknowledged identical events must not rewrite saved history.
48. A message import must validate each distinct chat/run reference once and load existing message IDs together.
49. Configured local startup must start one pinned shared Hermes container and supply exact profile routes for current memberships before starting the existing Go API.
50. Local Hermes must receive runtime provider, service, callback and optional exact-profile integration credentials through private stdin, with no AWS credentials, database credentials or host credential directories.
51. Local Hermes must publish only on loopback and retain the shared volume and every original private volume when the launcher stops or restarts it.
52. Local startup must check Docker prerequisites and successfully build the current checkout's Hermes image with Docker's normal cache before retrieving application credentials or stopping the backend, and must never install Docker or apply database changes.
53. The Hermes image must start as user 10001 with all Mango plugin modules, the pinned MCP dependency and an accessible Python interpreter installed.
54. Local startup must resolve an account email to one existing Mango user and company through a read-only membership lookup without guessing or creating identities.
55. Duplicate users for one email must stop local startup, and multiple companies must require an explicit selection.
56. Local startup must remember only the selected company UUID and must recheck the user's membership on every launch.
57. Local startup must find Docker Desktop in its standard install folders when the current PowerShell PATH is stale and make its credential helpers available in that process.
58. A native profile name must encode its exact company UUID and user UUID without hyphens, and its home must retain the immutable exact UUID binding.
59. API and callback keys must be derived separately for each exact profile from stable injected gateway secrets; a sibling key must never authorize another profile.
60. Local service secrets must persist encrypted with Windows CurrentUser DPAPI, and an existing shared volume must never silently receive replacement secrets.
61. Native history databases, outboxes and transient hook state must be selected by the active profile; delivery workers must capture that profile's callback credentials before crossing threads.
62. Original owned volumes must mount at their exact native profile directories without copying or reassigning data, and a persisted volume binding must reject later remapping.
63. The first cutover to the shared gateway must refuse while Mango has nonterminal runs; completed chats and native data must remain intact.
64. Integration discovery must distinguish installed instructions, configured connections, authorized callable tools and actually successful execution.
65. A private integration connection name and OAuth state must belong to one exact profile, and shared native MCP connection caches must never reuse another profile's connection.
66. Native compression must keep the admitted session identity in place.
67. Only explicit operator repair may select admitted terminal runs missing both `run.finished` and `history.recovered`, using a read-only lookup of their exact company, user, native run and session IDs.
68. Startup repair must keep the shared home unchanged, select each exact bound native profile and queue its complete native display snapshot before gateway execution, without executing a model or contacting a provider.
69. Repair must read native history without modifying it, preserve literal session and integer message IDs, include compacted display history and exclude rewound, hidden, tool and reasoning content.
70. Each repair capture must use fresh event identities and queue `history.recovered` only after its complete snapshot succeeds; missing sessions and previously rejected runs must not claim repaired history or replay rejected events.
71. Mango must accept a recovery marker only for the exact admitted terminal run, and explicit Resume must reload its saved messages without synthesizing original execution events or submitting another run.
72. Every saved private integration must specify a boolean `enabled`; a missing flag must never inherit native default-on behavior or bypass exact tool selection.
73. Internal Mango tools must resolve typed or transcribed partial resource names through the existing universal picker search and keep its exact canonical IDs inside tool calls.
74. Process creation, naming, folder placement, Step creation, Node chat creation and editor work must reuse canonical business commands and the existing atomic AI receipt contract.
73. Integration setup must use native `oauth.redirect_port` so the native callback listener matches the configured redirect URI.
74. Early local container exits must report the Docker exit code and the last 30 log lines from that launch's verified container before removing it.
75. After successful local startup, stopping Go must leave Hermes running and preserve its connection environment in the same PowerShell terminal for subsequent `go run` commands.

## Process story

The user creates an empty chat or sends a message. Mango reserves a local run and sends its original input to that pair's named profile in the shared Hermes gateway with a durable idempotency key. Hermes assigns its own run ID and executes its native agent. Supported hooks persist observations and visible transcript snapshots in a local SQLite delivery queue, then send them to the authenticated Mango callback. Mango saves visible messages and appends run history. The final callback confirms native completion before acknowledgement, so the same durable delivery worker settles run status without a browser. Reopening the panel reads those saved records without depending on a still-retained native stream.

When Hermes requests a business change, Go checks native execution state, local admission and current permissions. The existing business command commits its change together with the shared action result and history event. Stop closes local action admission before asking Hermes to cancel. Neither closing a panel nor retrying delivery creates another run or action.

Native memory, learned skills, full transcripts and provider execution remain in the exact scoped Hermes home. One native gateway multiplexes the configured profiles; there is no container scheduler or dedicated user container. Operations must retire permanently deleted identity volumes under their retention policy and must never reassign a home. The legacy AI inspection archive and its resource relationships remain removed.

## Verification and operation

Frontend tests cover explicit sending, dictation, stream recovery, scope changes, empty saved chats, local run IDs and pending retries. Go HTTP tests cover private routing, membership checks, durable admission, filtered streams, independently captured history and existing Node commands. Memory and disposable PostgreSQL tests cover immutable IDs, scoped links, run state, rollback, deduplication, permissions and deletion. Native Hermes tests use loopback fake providers and fresh temporary homes without live credentials or databases.

See [data structure](../ai-data-structure-proposal.md), [runtime setup](../../hermes/README.md), [STT laws](STT.md) and [STT setup](../setup/stt.md). Source changes do not apply a live schema or deploy a service.

Pinned upstream: [Hermes 693641aa8b4359c602283bdbbc14041e03bc47bc](https://github.com/NousResearch/hermes-agent/tree/693641aa8b4359c602283bdbbc14041e03bc47bc). Its `hermes_state.py`, native compaction display projection, plugin hooks and Runs API are the storage and execution reference.
