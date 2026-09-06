import { APIHTTPError, isTerminalAuthFailureError, requestJSON } from "../api/requestJSON.js";

export async function transcribeAudio(apiBase: string, companyID: string, audio: Blob, signal: AbortSignal): Promise<string> {
  try {
    return await requestJSON<string>(apiBase, `/v1/transcriptions?company_id=${encodeURIComponent(companyID)}`, {
      method: "POST", body: audio, signal, timeoutMs: 0, allowDuringRealtimeDegraded: true,
      headers: { "Content-Type": audio.type, Accept: "application/x-ndjson" },
      consumeResponse: consumeTranscriptionStream,
    });
  } catch (error) {
    if (isTerminalAuthFailureError(error)) throw error;
    if (signal.aborted) throw error;
    if (error instanceof APIHTTPError) {
      if (error.status === 403) throw new Error("Dictation is unavailable for this company or account.");
      if (error.status === 503) throw new Error("Dictation is unavailable. Ask your administrator to configure Deepgram.");
      if (error.status === 413 || error.bodyText.includes("transcription_audio_too_large")) throw new Error("The recording exceeds the 2 GB maximum. Please record again.");
      if (error.status === 415) throw new Error("This recording format is unsupported. Try another browser.");
      if (error.status === 422 || error.bodyText.includes("transcription_no_speech")) throw new Error("No speech was heard. Please try recording again.");
      if (error.status === 408 || error.status === 504 || error.bodyText.includes("transcription_timed_out")) throw new Error("Deepgram could not finish processing the recording in time. Please try again.");
    }
    throw new Error("The recording could not be transcribed. Check your connection and try again.");
  }
}

export async function consumeTranscriptionStream(response: Response): Promise<string> {
  if (!response.body || response.headers.get("Content-Type")?.split(";")[0].trim() !== "application/x-ndjson") {
    throw new Error("Invalid transcription response.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let fragments: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("The transcription was interrupted.");
      const lines = decoder.decode(value, { stream: true }).split("\n");
      for (let index = 0; index < lines.length; index++) {
        fragments.push(lines[index]);
        if (index === lines.length - 1) continue;
        const line = fragments.join("");
        fragments = [];
        const event: unknown = JSON.parse(line);
        if (!event || typeof event !== "object" || !("type" in event)) throw new Error("Invalid transcription event.");
        if (event.type === "progress") continue;
        if (event.type === "error" && "code" in event && typeof event.code === "string") {
          throw new APIHTTPError(502, "Transcription failed", event.code);
        }
        if (event.type !== "result" || !("text" in event) || typeof event.text !== "string") throw new Error("Invalid transcription result.");
        const text = event.text.trim();
        if (!text) throw new APIHTTPError(422, "No speech", "transcription_no_speech");
        return text;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
