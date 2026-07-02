import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { NodeInlineCommentThread } from "./nodeInlineComments";
import { getEditorLinkHrefForText } from "../editor/richTextEditing";

type NodeInlineCommentPanelProps = {
  thread: NodeInlineCommentThread;
  left: number;
  top: number;
  accent: string;
  panelSurface: string;
  panelSubtleSurface: string;
  panelText: string;
  panelMutedText: string;
  onAddMessage: (threadID: string, body: string) => void;
  onResolve: (threadID: string) => void;
  onClose: () => void;
};

const iconButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 5,
  border: "1px solid rgba(120,130,145,0.32)",
  background: "transparent",
  color: "inherit",
  display: "grid",
  placeItems: "center",
  padding: 0,
  cursor: "pointer",
};

function SendIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M5 12.5l4.2 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none">
      <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

function renderLinkedCommentText(value: string): React.ReactNode {
  const urlPattern = /\b((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of value.matchAll(urlPattern)) {
    const text = match[0] ?? "";
    const start = match.index ?? 0;
    const trailing = text.match(/[),.;:!?]+$/)?.[0] ?? "";
    const label = trailing ? text.slice(0, -trailing.length) : text;
    const href = getEditorLinkHrefForText(label);
    if (start > cursor) nodes.push(value.slice(cursor, start));
    if (href) {
      nodes.push(
        <a
          key={`link:${index}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#0369a1", textDecoration: "underline", textUnderlineOffset: 2, fontWeight: 750 }}
          onClick={(event) => event.stopPropagation()}
        >
          {label}
        </a>,
      );
    } else {
      nodes.push(label);
    }
    if (trailing) nodes.push(trailing);
    cursor = start + text.length;
    index += 1;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

export const NodeInlineCommentPanel: React.FC<NodeInlineCommentPanelProps> = ({
  thread,
  left,
  top,
  accent,
  panelSurface,
  panelSubtleSurface,
  panelText,
  panelMutedText,
  onAddMessage,
  onResolve,
  onClose,
}) => {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [thread.id]);

  const submit = () => {
    const value = draft.trim();
    if (!value) return;
    onAddMessage(thread.id, value);
    setDraft("");
  };

  return (
    <div
      data-node-inline-comment-panel="true"
      style={{
        position: "absolute",
        left,
        top,
        width: 286,
        maxHeight: 340,
        minHeight: 166,
        borderRadius: 8,
        border: `1px solid ${accent}`,
        background: panelSurface,
        color: panelText,
        boxShadow: "0 14px 34px rgba(0,0,0,0.24)",
        zIndex: 36,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr) auto",
        overflow: "hidden",
        pointerEvents: "auto",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div style={{ display: "grid", gap: 8, padding: "9px 10px 8px", borderBottom: "1px solid rgba(120,130,145,0.22)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", alignItems: "center", gap: 6 }}>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 800 }}>
            {thread.quote}
          </div>
          <button type="button" title="Resolve thread" aria-label="Resolve thread" style={iconButtonStyle} onClick={() => onResolve(thread.id)}>
            <CheckIcon />
          </button>
          <button type="button" title="Close thread" aria-label="Close thread" style={iconButtonStyle} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div
          style={{
            borderLeft: `3px solid ${accent}`,
            background: panelSubtleSurface,
            color: panelMutedText,
            padding: "6px 7px",
            fontSize: 10,
            lineHeight: 1.35,
            maxHeight: 54,
            overflow: "hidden",
          }}
        >
          {thread.quote}
        </div>
      </div>

      <div style={{ overflowY: "auto", padding: "8px 10px", display: "grid", alignContent: "start", gap: 8 }}>
        {thread.messages.map((message) => (
          <div key={message.id} style={{ display: "grid", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: accent,
                  color: "#101010",
                  fontSize: 9,
                  fontWeight: 900,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}
              >
                {message.authorLabel.slice(0, 2).toUpperCase()}
              </span>
              <span style={{ fontSize: 10, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {message.authorLabel}
              </span>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.35, whiteSpace: "pre-wrap", overflowWrap: "anywhere", paddingLeft: 24 }}>
              {renderLinkedCommentText(message.body)}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        style={{
          borderTop: "1px solid rgba(120,130,145,0.22)",
          padding: 8,
          display: "grid",
          gridTemplateColumns: "1fr 28px",
          gap: 6,
          alignItems: "end",
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          placeholder="Reply..."
          rows={2}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          style={{
            resize: "none",
            minHeight: 38,
            maxHeight: 78,
            borderRadius: 6,
            border: "1px solid rgba(120,130,145,0.32)",
            background: panelSubtleSurface,
            color: panelText,
            padding: "6px 7px",
            fontSize: 11,
            lineHeight: 1.3,
            outline: "none",
            fontFamily: "var(--mango-font-family)",
          }}
        />
        <button
          type="submit"
          title="Send reply"
          aria-label="Send reply"
          disabled={!draft.trim()}
          style={{
            ...iconButtonStyle,
            width: 28,
            height: 28,
            background: draft.trim() ? accent : "transparent",
            color: draft.trim() ? "#101010" : panelMutedText,
            opacity: draft.trim() ? 1 : 0.6,
            cursor: draft.trim() ? "pointer" : "default",
          }}
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
};
