# AI & MCP Business Logic Laws

1. Mango keeps the existing chat panel and composer visible with an unavailable message and disabled input and Send controls.
2. Opening, expanding, or closing the chat panel must make no assistant, provider, Process, or transcription request.
3. The app must expose no legacy assistant chat, status, trace, result, or transcription endpoint.
4. The app must neither load AI provider credentials nor start the Pi runtime.
5. The app must not run AI tools, record audio, retain AI conversations, or save AI inspection archives.
6. Ordinary Process, Node, editor, chat, permission, and relationship commands must retain their existing app behavior.
7. The ai/ instructions, skills, and MCP guidance remain source documents and must not be loaded by the app.
8. Hermes and its memory behavior remain unimplemented.

## Process story

The user can open the existing Mango chat panel and see that chat is unavailable. The composer cannot send or record anything. The old provider, tool execution, runtime, and inspection storage paths have been removed, while the reusable ai/ guidance remains for future work.
