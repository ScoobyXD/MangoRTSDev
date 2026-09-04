# Mango Assistant Business Logic Laws

1. Chat requires a signed-in Mango user and a selected company with current access.
2. Every function rechecks the user's company role and uses only that company, the authenticated user, and fixed Mango handlers.
3. Function arguments must match their declared schema and must never select an actor, company, URL, executable code, or undeclared operation.
4. Process tools use exact `logic_gate` identities; Node, textbox, Folder, and attachment tools retain their existing canonical identities and relationships.
5. Tools use ordinary Mango permissions, validation, editor revisions, deletion rules, and events.
6. Deleting a Process, Node, or Folder requires its normal display-name confirmation and that name on its own line in the latest user message.
7. Saving a textbox submits all replacement plain text in one canonical editor operation and clears rich formatting, inline content, and annotations in the submitted document.
8. Existing editor conflict behavior remains authoritative, including PostgreSQL concurrent block merging; the assistant must read the saved textbox before claiming exact final content.
9. Preparing an attachment upload must not claim that file bytes were uploaded or that an attachment is complete.
10. Attachment completion must use Mango's existing stored-byte size and checksum verification before reporting success.
11. One Send starts one foreground request with at most eight sequential functions, nine model responses, 4,096 output tokens per response, 32,000 streamed text bytes, and a 90-second request deadline.
12. Partial, failed, incomplete, duplicated, or excessive model function calls must not be dispatched; a failed or uncertain Mango action stops the request without automatic retry.
13. Stop, disconnect, or scope change cancels provider work and prevents later functions; an action already entered may commit and must never be described as undone.
14. One user/company may have one active request per backend process; repeated request IDs are rejected for fifteen minutes by a bounded process-local receipt cache.
15. Changing account or company clears the visible session and aborts its request; chat has no saved history table or background job.
16. OpenAI credentials remain on the server, provider errors remain private, and missing key or model configuration produces an unavailable state.
17. Only completed nonempty replies enter later conversation history; interrupted or failed turns must not be silently resubmitted.
18. Moving a Node to a Process uses the canonical Process work command and checks current access to the Node, its stored source Process, and the destination Process.
19. A move with null status preserves the Node's current status and Issue flag; moving to another Process clears the previous step assignment.
20. Mango chat floats above the app canvas and must not reduce the canvas dimensions.
21. Expanded chat has one centered circular down-arrow control that collapses the entire chat surface to one centered circular up-arrow control; focus follows the replacement control, and expanding restores the same in-memory session.
22. Mango chat is centered on the browser viewport regardless of app sidebar or canvas dimensions.
23. The cloud-integrated local backend launcher loads the assistant model and OpenAI key from local environment, ignored dev tfvars, or the deployed DEV task without logging the key, and restores the caller's prior assistant environment after the backend exits; chat stays unavailable when either value is absent.
24. Each Send selects exactly one reasoning effort from low, medium, high, xhigh, or max; the backend rejects every other value and applies the selected effort to every provider step in that Send.
25. A new browser chat session starts collapsed; expanding it preserves the selected reasoning effort, which defaults to medium and remembers the last valid browser choice.

## Process story

A user sends a message from the bottom composer. Mango authenticates the request and streams a Responses API reply. If the model requests one of the 25 functions, Mango validates it and calls the same handler used by the app with fresh company permissions. The function result and model output return to the model for its next response. The request ends on completion, failure, Stop, or a fixed limit. Ordinary Mango realtime events update the working UI.

## Scenarios

1. **Create and explain:** the model calls `create_process`; Mango creates the Process through its normal handler; the returned exact identity goes back to the model before it reports success.
2. **Lost acknowledgement:** a write commits but its response fails; the request ends with a message to check Mango, and neither the SDK nor the function loop repeats the action.
3. **Change company:** a user with access to two companies switches from A to B; the prior transcript disappears, its request is aborted, and attachment lookup cannot use A's membership during a B request.

Verification: `TestAssistant*` in the existing Go HTTP suite and the assistant cases in the existing frontend relationship test runner. Provider tests use a local HTTP stub and repository/storage fixtures; they make no paid OpenAI calls or live-database writes.
