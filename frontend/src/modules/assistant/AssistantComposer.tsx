export function AssistantComposer() {
  return <div className="mango-assistant-composer">
    <div className="mango-assistant-editor">
      <textarea className="mango-assistant-input" aria-label="Message Mango" placeholder="Message Mango" rows={1} disabled />
    </div>
    <button type="button" className="mango-assistant-send mango-assistant-send-icon" aria-label="Send" title="Send" disabled>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  </div>;
}
