# Speech to Text Business Logic Laws

1. The authenticated transcription API must remain independent of any agent runtime.
2. The app must expose no chat composer or microphone UI for the retained transcription service.
3. Transcription must use Deepgram Nova-3 with English and smart formatting, without automatic retries.
4. The transcription endpoint must require the authenticated user's current access to the selected company.
5. Transcription must use the shared authenticated API transport.
6. Audio must be forwarded without creating a Mango file, attachment, database record, or application log of its contents.
7. Deepgram credentials must remain on the server and never enter browser code, responses, or logs.
8. Missing Deepgram configuration must return a transcription-unavailable error while leaving the rest of the API usable.
9. The API may resolve only the configured `DEEPGRAM_API_KEY_SECRET_ARN` at startup when no injected `DEEPGRAM_API_KEY` is present.
10. A failed runtime secret read must expose neither provider error details nor secret contents.
11. Retained browser dictation utilities must release microphone tracks on stop or cancellation and reject late transcription results.
12. Retained browser dictation utilities must preserve existing draft text when inserting a transcript or reporting an error.

The service, API, and reusable browser dictation utilities remain available. They have no mounted application composer after AI removal. Their tests cover reusable behavior; they do not establish a current end-user microphone flow.
