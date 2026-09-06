# Speech to Text Business Logic Laws

1. The composer microphone starts recording on the first click and stops on the next click.
2. A recording may contain at most 2 GB, defined as 2,000,000,000 audio bytes, with no total recording-duration cap.
3. Recording must stop automatically after 60 seconds without detected microphone activity, including silence immediately after recording starts.
4. Each detected microphone activity must restart the silence countdown.
5. Waves around the red recording icon must respond to microphone activity and remain inactive during silence.
6. Reduced-motion preferences must replace wave motion with a static activity indicator.
7. A normal stop must release microphone tracks immediately and transcribe only after the recorder delivers its final audio chunk.
8. A recording exceeding 2 GB must fail without uploading or slicing compressed audio.
9. Transcription must use Deepgram recorded-audio Nova-3 with English and smart formatting, without paid add-ons or automatic retries.
10. Transcription must require the authenticated user's current access to the selected company.
11. The complete transcript must enter the saved draft position as plain text through one undoable insertion, preserving surrounding text and the selected Process.
12. Stopping with the microphone button, silence timer, or size boundary must only insert the transcript for review.
13. Pending microphone permission, recording, and transcription must freeze editing.
14. Cancellation, closing, collapsing, clearing, unmounting, and account or company changes must release recording resources and prevent stale results from changing a draft.
15. Permission, device, upload, provider, empty-speech, and size failures must preserve the existing draft and display an understandable message.
16. Mango must stream audio to Deepgram without retaining the whole recording in backend memory or writing it to files, attachments, databases, S3, or application logs.
17. Deepgram credentials must remain on the server and must never enter browser code or responses.
18. Mango must not truncate or reject user chat text because of a character or input-byte limit.
19. Send must remain available during active recording, including an empty draft, whenever the normal chat availability and request guards allow sending.
20. Send or Enter during active recording must stop capture, wait for successful final transcription, and submit the complete draft and selected Process exactly once.
21. Pending permission, recorder finalization, and transcription must reject additional submission attempts.
22. Failure or cancellation must discard the queued Send intent without sending the old draft or carrying that intent into a later recording.

## Process story

The user records into the existing browser MediaRecorder and stops with the microphone button, Send, the byte boundary, or one minute of silence. One Web Audio analyser reads the same microphone stream every 100 ms; an RMS sound level of at least 0.012 counts as activity and controls the waves. Browser echo cancellation and noise suppression are requested. This measures microphone sound, rather than recognizing words, so sufficiently loud background sound can reset the countdown. The timer samples current audio before checking elapsed silence, including when a background tab resumes. Stop clears sampling, disconnects audio nodes, closes the AudioContext, and releases microphone tracks. Once final recorder data arrives, the browser uploads the original audio Blob to the authenticated transcription endpoint. Mango forwards the bytes directly to Deepgram and returns progress lines every 15 seconds until a complete transcript or a safe error arrives. The composer inserts the transcript into the saved draft and returns its complete text and Process. If Send or Enter stopped the recording, that fresh draft is submitted once; other stop methods leave it for review. Failures and cancellation never submit a draft.

## Main scenarios

1. **Ongoing speech and Send:** Continue speaking beyond two minutes. Recording and activity waves continue; each detected sound restarts the one-minute silence countdown. Clicking the microphone transcribes for review. Clicking Send or pressing Enter stops recording, waits for every audio chunk and the complete transcript, and sends that transcript together with the existing draft once.
2. **Silence:** After 59 seconds of silence, new activity restarts the countdown. After 60 seconds without activity, recording stops and transcribes automatically. An entirely silent recording produces the normal no-speech message and keeps the draft.
3. **Large recording and cancellation:** Audio up to exactly 2,000,000,000 bytes is accepted. A recorder's final chunk that exceeds that boundary is rejected without corrupting or truncating it. Canceling any pending upload or transcription preserves the draft and discards late results.

## Transport and operational behavior

`POST /v1/assistant/transcriptions?company_id=...` accepts raw WebM, Ogg, or MP4 audio with its original `Content-Type`. The response is `application/x-ndjson`: `{"type":"progress"}` lines followed by `{"type":"result","text":"..."}` or `{"type":"error","code":"..."}`. Authentication, declared-size, empty-body, and format errors can return ordinary HTTP errors before streaming starts. Unknown-length uploads are checked while streaming. The backend reads Deepgram's response incrementally and discards word metadata instead of buffering the entire response.

Microphone permission/startup has a 30-second timeout and recorder finalization has a 5-second timeout. Upload and browser transcription requests have no fixed total timeout. Deepgram's response-header wait is ten minutes after the upload finishes, matching its published Nova processing limit. Connection failures, device capacity, provider account/concurrency limits, and provider processing failures can still interrupt a request; Mango cannot guarantee success solely from file size. See [Deepgram's recording limits](https://developers.deepgram.com/docs/pre-recorded-audio) and [project concurrency limits](https://developers.deepgram.com/reference/api-rate-limits).

Chat accepts the full transcript without the former 8,000-character message cap, 48,000-character history cap, or input-byte caps. Its existing message-count, execution, output, inspection, tool, and provider constraints still apply as documented in [AI & MCP](AI&MCP.md); removing a text-length check does not make model processing unlimited. Audio has no durable Mango storage; provider retention is controlled separately by the Deepgram account.
