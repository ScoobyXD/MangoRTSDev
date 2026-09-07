# Speech to Text Business Logic Laws

1. Mango chat accepts typed plain text while dictation is idle, and explicit Send is available for a nonempty draft when dictation and the assistant are idle.
2. The microphone button starts recording on its first click and stops recording on its next click.
3. The microphone shows red while recording, and its waves respond to detected microphone audio activity.
4. Reduced-motion preferences replace moving waves with a static activity indicator.
5. Recording stops after 60 seconds without microphone activity and must never upload more than 2,000,000,000 bytes.
6. Pending permission, recording, transcription and an in-flight Send request pause draft editing to preserve the insertion point; Send admission must temporarily disable starting dictation.
7. Stopping releases microphone tracks immediately and waits for the recorder's final audio chunk before transcription.
8. Transcription uses Deepgram Nova-3 with English and smart formatting, without automatic retries.
9. The transcription endpoint requires the authenticated user's current access to the selected company.
10. A successful transcript inserts plain text at the saved caret or selection end while preserving all existing text.
11. Dictation and the Enter key must never submit the draft or invoke an agent.
12. Cancellation, closing the chat, unmounting, and account, company or selected-conversation changes release recording resources and reject late transcription results.
13. Routine token refresh must preserve the current user's draft and active dictation.
14. Recording and transcription errors preserve the existing draft and display a plain error message.
15. Audio is forwarded to Deepgram without creating a Mango file, attachment, database record, or application log of its contents.
16. Deepgram credentials remain on the server and must never enter browser code, responses, or logs.
17. Missing Deepgram configuration must return a transcription-unavailable error while leaving typed drafts usable.
18. Transcription must use the shared authenticated API transport and remain independent of agent and realtime mutation availability.
19. The API may resolve only the configured `DEEPGRAM_API_KEY_SECRET_ARN` at startup when no injected `DEEPGRAM_API_KEY` is present.
20. A failed runtime secret read must leave dictation unavailable and the rest of the API usable without exposing provider error details or secret contents.
