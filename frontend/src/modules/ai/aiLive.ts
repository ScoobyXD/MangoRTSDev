export type AILiveTranscript = { role: "user" | "ai"; delta: string; start_ms: number; end_ms: number };
export type AILiveStatus = "connecting" | "listening" | "closing" | "closed";

type LiveOptions = {
  createSession: (sdp: string, signal: AbortSignal) => Promise<{ session_id: string; sdp: string }>;
  onStatus: (status: AILiveStatus) => void;
  onTranscript: (fragment: AILiveTranscript) => void;
  onDelegation: (context: string) => Promise<string>;
  onError: (message: string) => void;
};

/** Keep original transcript fragments; a fragment is not a completed user turn. */
export function liveDelegationContext(fragments: AILiveTranscript[], offset: number): string {
  return fragments.filter((part) => part.start_ms <= offset)
    .map((part) => `${part.role} [${part.start_ms}-${part.end_ms}ms]: ${part.delta}`).join("\n");
}

/** A UTF-8 byte limit also stays below Live's 500-token append limit. */
export function liveSpokenResult(text: string): string {
  const encoder = new TextEncoder();
  let result = "";
  for (const character of text) {
    if (encoder.encode(result + character).length > 380) return `${result}… See the full result in Mango AI.`;
    result += character;
  }
  return result || "The task has finished. See Mango AI for its current status.";
}

function waitForICE(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", changed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve();
    };
    const changed = () => { if (pc.iceGatheringState === "complete") finish(); };
    const aborted = () => finish(new DOMException("Voice connection canceled", "AbortError"));
    const timer = setTimeout(() => finish(new Error("Voice connection timed out while gathering network information.")), 15000);
    pc.addEventListener("icegatheringstatechange", changed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

export class AILiveConnection {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private abort = new AbortController();
  private running = true;
  private started = false;
  private disposed = false;
  private fragments: AILiveTranscript[] = [];
  private transcriptLength = 0;
  private delegations = new Set<string>();
  private queue = Promise.resolve();
  private closed: (() => void) | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private options: LiveOptions) {}

  async start(): Promise<void> {
    this.options.onStatus("connecting");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Voice needs a microphone and HTTPS or localhost.");
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!this.running) { microphone.getTracks().forEach((track) => track.stop()); return; }
      this.microphone = microphone;
      const pc = new RTCPeerConnection();
      this.pc = pc;
      this.audio = new Audio();
      this.audio.autoplay = true;
      pc.ontrack = (event) => {
        if (!this.audio || !this.running) return;
        this.audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void this.audio.play().catch(() => this.options.onError("Your browser blocked voice playback. Allow audio playback and start voice again."));
      };
      microphone.getTracks().forEach((track) => pc.addTrack(track, microphone));
      this.channel = pc.createDataChannel("oai-events");
      this.channel.onmessage = (event) => this.receive(event.data);
      this.channel.onclose = () => {
        if (this.running) {
          this.options.onError("Voice connection ended before final confirmation. You can review or cancel the task in Mango AI.");
          this.dispose();
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" && this.running) {
          this.options.onError("Voice connection failed. You can review or cancel the task in Mango AI.");
          this.dispose();
        }
      };
      await pc.setLocalDescription(await pc.createOffer());
      await waitForICE(pc, this.abort.signal);
      const result = await this.options.createSession(pc.localDescription?.sdp ?? "", this.abort.signal);
      if (!this.running) return;
      await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
      // HTTP creation already starts Live. Do not send session.start over WebRTC.
      this.startupTimer = setTimeout(() => {
        if (!this.started && this.running) {
          this.options.onError("Voice did not start. Check OpenAI access and try again.");
          void this.close();
        }
      }, 20000);
    } catch (cause) {
      if (this.running) this.options.onError(cause instanceof Error ? cause.message : "Voice connection failed.");
      this.dispose();
    }
  }

  private send(event: Record<string, unknown>): void {
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event));
  }

  private receive(data: unknown): void {
    if (typeof data !== "string") return;
    let event: Record<string, any>;
    try { event = JSON.parse(data); } catch { return; }
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    if (event.type === "session.closed") { this.closed?.(); this.dispose(); return; }
    if (!this.running) return;
    if (event.type === "session.started") {
      this.started = true;
      clearTimeout(this.startupTimer);
      this.options.onStatus("listening");
    } else if (event.type === "error") {
      this.options.onError(typeof event.error?.message === "string" ? event.error.message : "The voice service rejected a request.");
    } else if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      if (typeof event.delta !== "string" || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms)) return;
      const part: AILiveTranscript = { role: event.type === "session.input_transcript.delta" ? "user" : "ai", delta: event.delta, start_ms: event.start_ms, end_ms: event.end_ms };
      this.fragments.push(part);
      this.transcriptLength += part.delta.length;
      this.options.onTranscript(part);
      if (this.transcriptLength > 64000) {
        this.options.onError("This voice conversation is full. Start a new voice conversation to continue; your task stays in Mango AI.");
        void this.close();
      }
    } else if (event.type === "session.delegation.created" && event.delegation?.target === "client") {
      const id = event.delegation.id;
      const offset = event.offset_ms;
      if (typeof id !== "string" || !Number.isFinite(offset) || this.delegations.has(id)) return;
      this.delegations.add(id);
      // One task submission at a time; spoken interruptions cannot authorize or cancel tools.
      this.queue = this.queue.then(async () => {
        if (!this.running || !this.started) return;
        const context = liveDelegationContext(this.fragments, offset);
        const result = context && this.fragments.some((part) => part.role === "user" && part.start_ms <= offset)
          ? await this.options.onDelegation(context)
          : "I did not receive the request clearly. Please repeat it.";
        if (this.running) this.send({ type: "session.commentary.append", delegation_id: id, content: liveSpokenResult(result) });
      }).catch((cause) => {
        if (!this.running) return;
        this.options.onError(cause instanceof Error ? cause.message : "The delegated task failed.");
        this.send({ type: "session.commentary.append", delegation_id: id, content: "The task could not continue. Review the error in Mango AI." });
      });
    }
  }

  async close(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.abort.abort();
    this.options.onStatus("closing");
    this.microphone?.getTracks().forEach((track) => { track.enabled = false; });
    if (this.channel?.readyState === "open") {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.options.onError("Voice stopped; the service did not confirm final usage before the connection closed.");
          resolve();
        }, 4000);
        this.closed = () => { clearTimeout(timer); resolve(); };
        this.send({ type: "session.close" });
      });
    }
    this.dispose();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.abort.abort();
    clearTimeout(this.startupTimer);
    this.microphone?.getTracks().forEach((track) => track.stop());
    this.microphone = null;
    this.channel?.close();
    this.pc?.close();
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    this.options.onStatus("closed");
  }
}
