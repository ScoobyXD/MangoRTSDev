import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { subscribeRealtimeHealth } from "./realtimeWebSocket.js";
import type { RealtimeHealthSnapshot, RealtimeHealthStatus } from "./realtimeHealth.js";

const STATUS_PRESENTATION: Record<RealtimeHealthStatus, { label: string; color: string }> = {
  connected: { label: "Connected", color: "#16a34a" },
  reconnecting: { label: "Reconnecting", color: "#f59e0b" },
  attempting: { label: "Attempting to reconnect", color: "#dc2626" },
  disconnected: { label: "Disconnected - refresh your browser", color: "#b91c1c" },
};

export function RealtimeHealthChrome({ apiBase, companyID }: { apiBase: string; companyID: string }): React.ReactElement {
  const [health, setHealth] = useState<RealtimeHealthSnapshot>({ status: "reconnecting" });

  useEffect(() => subscribeRealtimeHealth(apiBase, companyID, setHealth), [apiBase, companyID]);

  const presentation = STATUS_PRESENTATION[health.status];
  const blocksInteractions = health.status === "attempting" || health.status === "disconnected";
  return (
    <>
      <div
        aria-label={`Realtime status: ${presentation.label}`}
        aria-live="polite"
        title={presentation.label}
        style={{
          minWidth: 30,
          height: 30,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "0 8px",
          border: `1px solid ${presentation.color}33`,
          borderRadius: 6,
          background: "#ffffff",
          color: presentation.color,
          fontSize: 11,
          fontWeight: 760,
          whiteSpace: "nowrap",
        }}
      >
        <span
          key={`${health.status}:${health.lastConfirmedAt ?? 0}`}
          aria-hidden="true"
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: presentation.color,
            boxShadow: `0 0 0 3px ${presentation.color}1f`,
            animation: health.status === "connected"
              ? "mango-realtime-heartbeat-pulse 900ms ease-out"
              : health.status === "attempting"
                ? "mango-realtime-attempting-blink 800ms steps(2, start) infinite"
                : undefined,
          }}
        />
        <span>{presentation.label}</span>
      </div>
      <style>{`
        @keyframes mango-realtime-heartbeat-pulse {
          0% { transform: scale(0.7); box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.55); }
          100% { transform: scale(1); box-shadow: 0 0 0 7px rgba(22, 163, 74, 0); }
        }
        @keyframes mango-realtime-attempting-blink { 50% { opacity: 0.18; } }
      `}</style>
      {blocksInteractions && typeof document !== "undefined" ? createPortal(
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="mango-realtime-block-title"
          aria-describedby="mango-realtime-block-description"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2_147_483_000,
            display: "grid",
            placeItems: "center",
            padding: 20,
            background: "rgba(15, 23, 42, 0.42)",
            backdropFilter: "blur(3px)",
            pointerEvents: "auto",
          }}
        >
          <div style={{
            width: "min(460px, calc(100vw - 40px))",
            borderRadius: 12,
            border: "1px solid rgba(220, 38, 38, 0.28)",
            background: "#ffffff",
            padding: 22,
            color: "#111827",
            boxShadow: "0 24px 80px rgba(15, 23, 42, 0.34)",
            textAlign: "center",
          }}>
            <div
              aria-hidden="true"
              style={{
                width: 16,
                height: 16,
                margin: "0 auto 12px",
                borderRadius: "50%",
                background: presentation.color,
                animation: health.status === "attempting" ? "mango-realtime-attempting-blink 800ms steps(2, start) infinite" : undefined,
              }}
            />
            <h2 id="mango-realtime-block-title" style={{ margin: 0, fontSize: 20 }}>{presentation.label}</h2>
            <p id="mango-realtime-block-description" style={{ margin: "10px 0 0", color: "#475569", lineHeight: 1.5 }}>
              {health.status === "attempting"
                ? "Mango is restoring its authenticated connection, subscriptions, and editor snapshots. New interactions are paused while your queued editor work stays safe."
                : "Mango could not restore a healthy connection. Refresh the browser to recover; queued editor work will be reapplied automatically."}
            </p>
            {health.status === "disconnected" ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  marginTop: 16,
                  minHeight: 38,
                  border: 0,
                  borderRadius: 7,
                  padding: "0 16px",
                  background: "#b91c1c",
                  color: "#ffffff",
                  font: "inherit",
                  fontWeight: 760,
                  cursor: "pointer",
                }}
              >
                Refresh browser
              </button>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
