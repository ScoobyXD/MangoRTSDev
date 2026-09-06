export function AssistantComposer() {
  return <div className="mango-assistant-composer">
    <div className="mango-assistant-editor">
      <textarea className="mango-assistant-input" aria-label="Message Mango" placeholder="Message Mango" rows={1} disabled />
    </div>
    <button type="button" className="mango-assistant-send" disabled>Send</button>
  </div>;
}
