import { useLayoutEffect, useRef, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { useDictation } from "../stt/useDictation.js";

type Props = {
  apiBase: string;
  companyID: string;
  visible: boolean;
  sending: boolean;
  submitting: boolean;
  onDictationBusyChange: (busy: boolean) => void;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  onSend: (message: string) => Promise<boolean>;
};

export function AssistantComposer({ apiBase, companyID, visible, sending, submitting, onDictationBusyChange, draft, setDraft, onSend }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const insertionPoint = useRef(0);
  const pendingCaret = useRef<number | null>(null);
  const submission = useRef(false);
  const dictation = useDictation(apiBase, companyID, (text) => {
    const position = insertionPoint.current;
    setDraft((current) => current.slice(0, position) + text + current.slice(position));
    pendingCaret.current = position + text.length;
  });

  useLayoutEffect(() => {
    if (!visible) dictation.cancel();
  }, [visible]);

  useLayoutEffect(() => {
    onDictationBusyChange(dictation.busy);
    return () => onDictationBusyChange(false);
  }, [dictation.busy, onDictationBusyChange]);

  useLayoutEffect(() => {
    if (dictation.busy || pendingCaret.current === null) return;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [draft, dictation.busy]);

  return <><div className="mango-assistant-composer">
    <div className="mango-assistant-editor">
      <textarea ref={inputRef} className="mango-assistant-input" aria-label="Message Mango" placeholder="Message Mango" rows={1}
        value={draft} readOnly={dictation.busy || submitting} onChange={(event) => setDraft(event.currentTarget.value)} />
    </div>
    <button type="button" className="mango-assistant-microphone"
      aria-label={dictation.phase === "recording" ? "Stop recording" : dictation.phase === "permission" ? "Cancel microphone request" : dictation.phase === "transcribing" ? "Transcribing speech" : "Start dictation"}
      title={dictation.phase === "recording" ? "Stop recording" : "Dictate in English"}
      aria-pressed={dictation.phase === "recording"} disabled={dictation.phase === "transcribing" || submitting}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (!visible) return;
        if (!dictation.busy) insertionPoint.current = inputRef.current?.selectionEnd ?? draft.length;
        void dictation.toggle();
      }}>
      {dictation.phase === "recording" && <span className="mango-assistant-sound-waves" data-active={dictation.audioLevel > 0}
        style={{ "--voice-level": dictation.audioLevel } as CSSProperties} aria-hidden="true">
        <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" focusable="false">
          <path d="M13 13Q8 20 13 27M27 13Q32 20 27 27" />
          <path d="M8 8Q0 20 8 32M32 8Q40 20 32 32" />
        </svg>
      </span>}
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {dictation.phase === "recording" ? <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /> : <>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
        </>}
      </svg>
    </button>
    <button type="button" className="mango-assistant-send mango-assistant-send-icon" aria-label="Send" title="Send"
      disabled={!visible || !draft.trim() || dictation.busy || sending || submitting}
      onClick={async () => {
        if (submission.current || dictation.busy || sending || !draft.trim()) return;
        submission.current = true;
        try {
          await onSend(draft.trim());
        } finally {
          submission.current = false;
        }
      }}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  </div>
    <p className="mango-assistant-availability" role="status">{dictation.message || "Type or dictate, then click Send. Enter adds a new line."}</p>
  </>;
}
