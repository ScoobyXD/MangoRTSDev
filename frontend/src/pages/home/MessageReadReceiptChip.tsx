import React from "react";
import type { EmailMessage, EmailReadSignal } from "../../modules/communications/communicationsApi";
import { formatMessageReadSignalTimestamp, messageReadStatusSignalTimestamps, messageReadStatusTitle } from "./homeUtils";

function signalPersonLabel(signal: EmailReadSignal | undefined): string {
  if (signal?.identity_available) {
    return signal.person_name?.trim() || signal.person_email?.trim() || "Identified recipient";
  }
  return "Recipient identity unavailable";
}

export function MessageReadReceiptChip({ message }: { message: EmailMessage }) {
  const status = message.read_status;
  const [open, setOpen] = React.useState(false);
  if (!status) return null;
  const timestamps = messageReadStatusSignalTimestamps(status);
  const signalsByTimestamp = new Map((status.signals ?? []).map((signal) => [signal.timestamp?.trim(), signal]));
  const title = messageReadStatusTitle(status);
  const tooltipID = `email-read-receipt-${message.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <span
      tabIndex={0}
      aria-describedby={open ? tooltipID : undefined}
      title={open ? undefined : title}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={{ position: "relative", display: "inline-flex", minWidth: 0, outline: "none" }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 19,
          padding: "1px 7px",
          border: "1px solid rgba(13,148,136,0.32)",
          borderRadius: 5,
          background: "linear-gradient(145deg, rgba(240,253,250,0.98), rgba(204,251,241,0.72))",
          color: "#0f766e",
          boxShadow: "1px 1px 3px rgba(15,118,110,0.12), inset 0 1px 0 rgba(255,255,255,0.92)",
          fontSize: 10.5,
          fontWeight: 850,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        Seen
      </span>
      {open && (
        <span
          id={tooltipID}
          role="tooltip"
          style={{
            position: "absolute",
            zIndex: 40,
            right: 0,
            bottom: "calc(100% + 7px)",
            width: 290,
            maxHeight: 260,
            overflowY: "auto",
            display: "grid",
            gap: 6,
            padding: 9,
            border: "1px solid rgba(71,85,105,0.28)",
            borderRadius: 7,
            background: "rgba(255,255,255,0.99)",
            color: "#1e293b",
            boxShadow: "0 12px 28px rgba(15,23,42,0.2)",
            fontSize: 10.5,
            lineHeight: 1.35,
            whiteSpace: "normal",
            textAlign: "left",
          }}
        >
          <strong>Observed open signals</strong>
          {timestamps.length > 0 ? timestamps.map((timestamp) => (
            <span key={timestamp} style={{ display: "grid", gap: 1 }}>
              <span style={{ fontWeight: 800 }}>{signalPersonLabel(signalsByTimestamp.get(timestamp))}</span>
              <span>{formatMessageReadSignalTimestamp(timestamp)}</span>
            </span>
          )) : <span>Open time unavailable</span>}
          <span style={{ color: "#64748b" }}>Nylas reports tracking-pixel loads, not a verified human read, and does not identify which recipient opened the message.</span>
        </span>
      )}
    </span>
  );
}
