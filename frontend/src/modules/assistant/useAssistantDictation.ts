import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { AssistantComposerHandle } from "./AssistantComposer.js";
import { transcribeAssistantAudio } from "./assistantApi.js";

const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
const MAX_RECORDING_MS = 120_000;
type Phase = "idle" | "permission" | "recording" | "transcribing";
type Recording = {
  controller: AbortController; stream?: MediaStream; recorder?: MediaRecorder;
  chunks: Blob[]; bytes: number; timer?: ReturnType<typeof setTimeout>; stopping: boolean;
};

function releaseMicrophone(recording: Recording) {
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
  const current = useRef<Recording | null>(null);

  const cancel = (notice = "Dictation canceled. Your draft was kept.") => {
    const recording = current.current;
    current.current = null;
    if (recording) dispose(recording);
    composer.current?.finishDictation();
    setPhase("idle");
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
    // Also bound authentication refresh, which happens before requestJSON's fetch timeout.
    recording.timer = setTimeout(() => fail(recording, "Transcription timed out. Please try a shorter recording."), 40_000);
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

  const stop = (recording: Recording, atLimit = false) => {
    if (current.current !== recording || recording.stopping) return;
    recording.stopping = true;
    clearTimeout(recording.timer);
    setPhase("transcribing");
    setMessage(atLimit ? "Two-minute limit reached. Transcribing…" : "Transcribing…");
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
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current.current !== recording) { stream.getTracks().forEach((track) => track.stop()); return; }
      recording.stream = stream;
      clearTimeout(recording.timer);
      if (!stream.getAudioTracks().some((track) => track.readyState === "live")) throw new Error("No microphone is available.");
      stream.getTracks().forEach((track) => { track.onended = () => fail(recording, "The microphone disconnected. Please record again."); });
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
      recording.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (current.current !== recording || !event.data.size) return;
        recording.bytes += event.data.size;
        if (recording.bytes > MAX_RECORDING_BYTES) { fail(recording, "The recording exceeded 8 MiB. Please record a shorter message."); return; }
        recording.chunks.push(event.data);
      };
      recorder.onerror = () => fail(recording, "Recording failed. Check your microphone and try again.");
      recorder.onstop = () => { void transcribe(recording); };
      recorder.start(1_000);
      setPhase("recording");
      setMessage("Recording · Click the microphone to stop (2 minutes maximum). Editing and Send are paused.");
      recording.timer = setTimeout(() => stop(recording, true), MAX_RECORDING_MS);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      fail(recording, name === "NotAllowedError" || name === "SecurityError"
        ? "Microphone access was denied. Allow it in your browser settings and try again."
        : "The microphone could not start. Check that it is connected and available.");
    }
  };

  return { phase, message, busy: phase !== "idle", isBusy: () => current.current !== null, toggle, cancel };
}
