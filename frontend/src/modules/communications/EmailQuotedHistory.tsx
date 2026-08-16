import { useMemo, useState, type ReactNode } from "react";
import { splitEmailQuotedHistory } from "./emailQuotedContent.js";

export function EmailQuotedHistory({ body, children }: {
  body: string;
  children: (visibleBody: string) => ReactNode;
}) {
  const split = useMemo(() => splitEmailQuotedHistory(body), [body]);
  const [expandedBody, setExpandedBody] = useState<string | null>(null);
  const expanded = split.hasQuotedHistory && expandedBody === body;

  return (
    <>
      {children(expanded ? body : split.authoredBody)}
      {split.hasQuotedHistory && (
        <button
          type="button"
          data-email-quoted-history-control={expanded ? "hide" : "show"}
          aria-expanded={expanded}
          onClick={() => setExpandedBody(expanded ? null : body)}
          style={{
            justifySelf: "start",
            alignSelf: "start",
            minHeight: 28,
            marginTop: 6,
            padding: "4px 10px",
            border: "1px solid rgba(148,163,184,0.34)",
            borderRadius: 8,
            background: "rgba(248,250,252,0.96)",
            color: "#475569",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          {expanded ? "Hide subthread" : "Show subthread"}
        </button>
      )}
    </>
  );
}
