import assert from "node:assert/strict";
import test from "node:test";
import { consumeTranscriptionStream, transcribeAudio } from "../../../../frontend/src/modules/stt/sttApi.js";
test("transcription consumes progress and complete long UTF-8 results across network fragments", async () => {
  const transcript = "Mango 🥭 ".repeat(10_000);
  const body = new TextEncoder().encode(`${JSON.stringify({ type: "progress" })}\n${JSON.stringify({ type: "result", text: transcript })}\n`);
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < body.length; index += 37) chunks.push(body.subarray(index, index + 37));
  const response = new Response(new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(chunk)); controller.close(); } }), {
    headers: { "Content-Type": "application/x-ndjson" },
  });
  assert.equal(await consumeTranscriptionStream(response), transcript.trim());
});

test("transcription sends the original audio body and rejects failed or unfinished streams", async () => {
  const originalFetch = globalThis.fetch;
  const audio = new Blob(["audio"], { type: "audio/webm;codecs=opus" });
  let content = '{"type":"progress"}\n{"type":"result","text":"Full transcript"}\n';
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.example.test/v1/transcriptions?company_id=company-a");
    assert.equal(init?.body, audio);
    assert.equal(new Headers(init?.headers).get("Content-Type"), audio.type);
    return new Response(content, { headers: { "Content-Type": "application/x-ndjson" } });
  };
  try {
    const transcribe = () => transcribeAudio("https://api.example.test", "company-a", audio, new AbortController().signal);
    assert.equal(await transcribe(), "Full transcript");
    for (const [code, expected] of [["transcription_audio_too_large", /2 GB/], ["transcription_no_speech", /No speech/], ["transcription_timed_out", /in time/], ["private-provider-details", /could not be transcribed/]] as const) {
      content = `${JSON.stringify({ type: "error", code })}\n`;
      await assert.rejects(transcribe(), expected);
    }
    for (content of ['{"type":"progress"}\n', '{"type":"unexpected"}\n', '{"type":"result","text":1}\n', '{"type":"result","text":"incomplete"}']) {
      await assert.rejects(transcribe(), /could not be transcribed/);
    }
  } finally { globalThis.fetch = originalFetch; }
});
