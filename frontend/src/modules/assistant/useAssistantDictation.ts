import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AssistantComposerHandle } from "./AssistantComposer.js";
import { transcribeAssistantAudio } from "./assistantApi.js";

const MAX_RECORDING_BYTES = 2_000_000_000;
const SILENCE_STOP_MS = 60_000;
const VOICE_THRESHOLD = 0.012;
type Phase = "idle" | "permission" | "recording" | "transcribing";
type Recording = {
  controller: AbortController; stream?: MediaStream; recorder?: MediaRecorder;
  chunks: Blob[]; bytes: number; timer?: ReturnType<typeof setTimeout>; stopping: boolean;
  audioContext?: AudioContext; source?: MediaStreamAudioSourceNode; analyser?: AnalyserNode;
  activityTimer?: ReturnType<typeof setInterval>;
};

function releaseMicrophone(recording: Recording) {
  clearInterval(recording.activityTimer);
  recording.source?.disconnect();
  recording.analyser?.disconnect();
  recording.source = undefined;
  recording.analyser = undefined;
  if (recording.audioContext && recording.audioContext.state !== "closed") void recording.audioContext.close().catch(() => {});
  recording.audioContext = undefined;
  recording.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
  recording.stream = undefined;
}

function dispose(recording: Recording) {
  clearTimeout(recording.timer);
  recording.controller.abort();
  if (recording.recorder) {
    recording.recorder.ondataavailable = null;
    recording.recorder.onstop = null;
    recording.recorder.onerror = null;
    try { if (recording.recorder.state !== "inactive") recording.recorder.stop(); } catch { /* Still release tracks. */ }
  }
  releaseMicrophone(recording);
  recording.chunks = [];
}

export function useAssistantDictation(apiBase: string, companyID: string, composer: RefObject<AssistantComposerHandle>) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [audioLevel, setAudioLevel] = useState(0);
  const current = useRef<Recording | null>(null);

  const cancel = (notice = "Dictation canceled. Your draft was kept.") => {
    const recording = current.current;
    current.current = null;
    if (recording) dispose(recording);
    composer.current?.finishDictation();
    setPhase("idle");
    setAudioLevel(0);
    setMessage(recording ? notice : "");
  };

  useLayoutEffect(() => () => {
    const recording = current.current;
    current.current = null;
    if (recording) dispose(recording);
    composer.current?.finishDictation();
  }, [apiBase, companyID, composer]);

  const fail = (recording: Recording, notice: string) => {
    if (current.current === recording) cancel(notice);
  };

  const transcribe = async (recording: Recording) => {
    if (current.current !== recording) return;
    clearTimeout(recording.timer);
    if (!recording.stopping) { fail(recording, "Recording stopped unexpectedly. Please record again."); return; }
    const audio = new Blob(recording.chunks, { type: recording.recorder!.mimeType });
    recording.chunks = [];
    if (!audio.size) { fail(recording, "No audio was recorded. Check your microphone and try again."); return; }
    try {
      const text = await transcribeAssistantAudio(apiBase, companyID, audio, recording.controller.signal);
      if (current.current !== recording) return;
      composer.current?.finishDictation(text);
      current.current = null;
      dispose(recording);
      setPhase("idle");
      setMessage("Transcript added. Review your draft, then press Send.");
    } catch (error) {
      fail(recording, error instanceof Error ? error.message : "Transcription failed. Please try again.");
    }
  };

  const stop = (recording: Recording, reason: "manual" | "silence" | "size" = "manual") => {
    if (current.current !== recording || recording.stopping) return;
    recording.stopping = true;
    clearTimeout(recording.timer);
    setPhase("transcribing");
    setAudioLevel(0);
    setMessage(reason === "silence" ? "Stopped after one minute of silence. Transcribing…" : reason === "size" ? "2 GB limit reached. Transcribing…" : "Transcribing…");
    // Wait for MediaRecorder's final dataavailable event and then its stop event.
    recording.timer = setTimeout(() => fail(recording, "The recording could not finish. Please try again."), 5_000);
    try { recording.recorder!.stop(); }
    catch { fail(recording, "The recording could not finish. Please try again."); }
    finally { releaseMicrophone(recording); }
  };

  const toggle = async () => {
    if (current.current) {
      if (!current.current.recorder) cancel();
      else if (!current.current.stopping) stop(current.current);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") {
      setMessage("Microphone recording is unavailable. Use a supported browser on HTTPS or localhost.");
      return;
    }
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { setMessage("This browser cannot record supported audio. Try another browser."); return; }
    if (!composer.current?.beginDictation()) return;
    const recording: Recording = { controller: new AbortController(), chunks: [], bytes: 0, stopping: false };
    current.current = recording;
    setPhase("permission");
    setMessage("Allow microphone access to record. Editing and Send are paused.");
    recording.timer = setTimeout(() => fail(recording, "Microphone permission timed out. Click the microphone to try again."), 30_000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (current.current !== recording) { stream.getTracks().forEach((track) => track.stop()); return; }
      recording.stream = stream;
      if (!stream.getAudioTracks().some((track) => track.readyState === "live")) throw new Error("No microphone is available.");
      stream.getTracks().forEach((track) => { track.onended = () => fail(recording, "The microphone disconnected. Please record again."); });
      const audioContext = new AudioContext();
      recording.audioContext = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      recording.source = source;
      const analyser = audioContext.createAnalyser();
      recording.analyser = analyser;
      analyser.fftSize = 2048;
      source.connect(analyser);
      await audioContext.resume();
      if (current.current !== recording) return;
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
      recording.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (current.current !== recording || !event.data.size) return;
        recording.bytes += event.data.size;
        if (recording.bytes > MAX_RECORDING_BYTES) { fail(recording, "The recording exceeded Deepgram’s 2 GB maximum. Your draft was kept. Please record again."); return; }
        recording.chunks.push(event.data);
        if (recording.bytes === MAX_RECORDING_BYTES) stop(recording, "size");
      };
      recorder.onerror = () => fail(recording, "Recording failed. Check your microphone and try again.");
      recorder.onstop = () => { void transcribe(recording); };
      recorder.start(1_000);
      clearTimeout(recording.timer);
      setPhase("recording");
      setMessage("Recording · Click to stop. Stops after one minute of silence or at 2 GB. Editing and Send are paused.");
      const samples = new Float32Array(analyser.fftSize);
      let lastVoiceAt = performance.now();
      // A timer keeps silence detection working when background tabs pause animation frames.
      recording.activityTimer = setInterval(() => {
        if (current.current !== recording || recording.stopping) return;
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const rms = Math.sqrt(energy / samples.length);
        const now = performance.now();
        if (rms >= VOICE_THRESHOLD) lastVoiceAt = now;
        setAudioLevel(rms >= VOICE_THRESHOLD ? Math.min(1, Math.round(rms * 1_000) / 100) : 0);
        if (now - lastVoiceAt >= SILENCE_STOP_MS) stop(recording, "silence");
      }, 100);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      fail(recording, name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access was denied. Allow it in your browser settings and try again."
        : "The microphone could not start. Check that it is connected and available.");
    }
  };

  return { phase, message, audioLevel, busy: phase !== "idle", isBusy: () => current.current !== null, toggle, cancel };
}
