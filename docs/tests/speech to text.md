# Speech to Text Business Logic Laws

1. The Mango chat panel must not request microphone access or record audio.
2. The app must expose no assistant transcription endpoint or contact Deepgram.
3. The backend and deployment configuration must not load dictation provider credentials.

## Process story

The retained chat panel has no dictation control. Removing the old assistant also removes its recording, upload, transcription, and credential paths.
