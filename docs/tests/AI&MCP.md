# AI & MCP Business Logic Laws

1. Mango keeps the existing chat panel with an editable draft, microphone dictation, and a permanently disabled Send control.
2. Opening, expanding, or closing the chat panel must make no assistant, provider, Process, or transcription request.
3. The app must expose no legacy assistant chat, status, trace, result, or transcription endpoint.
4. The app must neither load agent provider credentials nor start the Pi runtime.
5. The app must not run AI tools, retain AI conversations, or save AI inspection archives.
6. Ordinary Process, Node, editor, chat, permission, and relationship commands must retain their existing app behavior.
7. The ai/ instructions, skills, and MCP guidance remain source documents and must not be loaded by the app.
8. Hermes and its memory behavior remain unimplemented.
9. Standalone Deepgram transcription must follow [STT.md](STT.md) and must never submit the draft or execute an agent action.

## Process story

The user can open Mango chat, type, and dictate into a local draft. Send remains disabled. Dictation uses its own authenticated transcription endpoint and never creates an agent interaction. The old agent provider, tool execution, runtime, and inspection storage paths remain removed, while the reusable ai/ guidance remains for future work.
