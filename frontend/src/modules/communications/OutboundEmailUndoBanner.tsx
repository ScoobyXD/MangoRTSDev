import React from "react";
import {
  getPendingOutboundEmailSends,
  subscribePendingOutboundEmailSends,
  undoOutboundEmailSend,
} from "./outboundEmailUndo.js";

export function OutboundEmailUndoBanner() {
  const pendingSends = React.useSyncExternalStore(
    subscribePendingOutboundEmailSends,
    getPendingOutboundEmailSends,
    getPendingOutboundEmailSends,
  );
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (pendingSends.length === 0) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 50);
    return () => window.clearInterval(timer);
  }, [pendingSends.length]);

  if (pendingSends.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Emails waiting to send"
      style={{
        display: "grid",
        gap: 6,
        padding: "7px 9px",
        border: "1px solid rgba(100,116,139,0.28)",
        borderRadius: 7,
        background: "rgba(248,250,252,0.98)",
        color: "#0f172a",
        boxShadow: "0 8px 22px rgba(15,23,42,0.14), inset 0 1px 0 rgba(255,255,255,0.94)",
      }}
    >
      {pendingSends.map((pending) => {
        const total = Math.max(1, pending.deadlineAt - pending.queuedAt);
        const remaining = Math.max(0, pending.deadlineAt - now);
        const progress = Math.max(0, Math.min(1, remaining / total));
        const seconds = Math.max(1, Math.ceil(remaining / 1000));
        return (
          <div key={pending.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 94px auto", alignItems: "center", gap: 9 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 750 }}>
              Sending {pending.label} in {seconds}s
            </span>
            <span
              aria-label={`${seconds} seconds remaining`}
              style={{ position: "relative", width: 94, height: 9, overflow: "hidden", border: "1px solid rgba(71,85,105,0.34)", borderRadius: 3, background: "rgba(226,232,240,0.9)" }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${progress * 100}%`,
                  background: "linear-gradient(90deg, #0ea5e9, #8b5cf6)",
                  transition: "width 50ms linear",
                }}
              />
            </span>
            <button
              type="button"
              className="mango-elevated-action"
              onClick={() => undoOutboundEmailSend(pending.id)}
              style={{
                minHeight: 26,
                padding: "3px 11px",
                border: "1px solid rgba(71,85,105,0.3)",
                borderRadius: 6,
                background: "#ffffff",
                color: "#1e293b",
                boxShadow: "3px 3px 8px rgba(148,163,184,0.26), -2px -2px 7px rgba(255,255,255,0.96)",
                font: "inherit",
                fontSize: 11,
                fontWeight: 850,
                cursor: "pointer",
              }}
            >
              Undo
            </button>
          </div>
        );
      })}
    </div>
  );
}
