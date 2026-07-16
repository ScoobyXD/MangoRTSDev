import React from "react";
import type { EmailAddress, EmailMessage, EmailReadSignal } from "../../modules/communications/communicationsApi";
import { formatMessageReadSignalTimestamp, messageReadStatusSignalTimestamps, messageReadStatusTitle } from "./homeUtils";

type ReadSignalGroup = {
  label: string;
  inferred: boolean;
  timestamps: string[];
  count: number;
};

function uniqueRecipients(message: EmailMessage): EmailAddress[] {
  const byEmail = new Map<string, EmailAddress>();
  for (const recipient of [...(message.to ?? []), ...(message.cc ?? []), ...(message.bcc ?? [])]) {
    const email = recipient.email?.trim().toLowerCase() ?? "";
    if (email && !byEmail.has(email)) byEmail.set(email, recipient);
  }
  return Array.from(byEmail.values());
}

function signalPerson(signal: EmailReadSignal | undefined, message: EmailMessage): { label: string; inferred: boolean } {
  if (signal?.identity_available) {
    return {
      label: signal.person_name?.trim() || signal.person_email?.trim() || "Identified recipient",
      inferred: false,
    };
  }
  const recipients = uniqueRecipients(message);
  if (recipients.length === 1) {
    return {
      label: recipients[0]?.name?.trim() || recipients[0]?.email?.trim() || "Only recipient",
      inferred: true,
    };
  }
  return { label: "Recipient identity unavailable", inferred: false };
}

function readSignalGroups(message: EmailMessage): ReadSignalGroup[] {
  const status = message.read_status;
  if (!status) return [];
  const timestamps = messageReadStatusSignalTimestamps(status);
  const signalsByTimestamp = new Map((status.signals ?? []).map((signal) => [signal.timestamp?.trim(), signal]));
  const groups = new Map<string, ReadSignalGroup>();
  for (const timestamp of timestamps) {
    const person = signalPerson(signalsByTimestamp.get(timestamp), message);
    const key = `${person.inferred ? "inferred" : "reported"}:${person.label.toLowerCase()}`;
    const group = groups.get(key) ?? { ...person, timestamps: [], count: 0 };
    group.timestamps.push(timestamp);
    group.count += 1;
    groups.set(key, group);
  }
  if (groups.size === 0) {
    const person = signalPerson(undefined, message);
    groups.set("fallback", { ...person, timestamps: [], count: Math.max(1, status.signal_count ?? 1) });
  } else if (groups.size === 1) {
    const onlyGroup = Array.from(groups.values())[0];
    if (onlyGroup) onlyGroup.count = Math.max(onlyGroup.count, status.signal_count ?? 0);
  }
  return Array.from(groups.values());
}

export function MessageReadReceiptChip({ message }: { message: EmailMessage }) {
  const status = message.read_status;
  const [open, setOpen] = React.useState(false);
  if (!status) return null;
  const groups = readSignalGroups(message);
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
        Likely opened
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
            width: 310,
            maxHeight: 280,
            overflowY: "auto",
            display: "grid",
            gap: 8,
            padding: 10,
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
          <strong>Likely open activity</strong>
          {groups.map((group) => (
            <span key={`${group.label}:${group.inferred}`} style={{ display: "grid", gap: 3 }}>
              <span style={{ fontWeight: 800 }}>
                {group.label}{group.inferred ? " (inferred)" : ""} · {group.count} open signal{group.count === 1 ? "" : "s"}
              </span>
              {group.timestamps.length > 0 ? group.timestamps.map((timestamp) => (
                <span key={timestamp}>{formatMessageReadSignalTimestamp(timestamp)}</span>
              )) : <span>Open time unavailable</span>}
            </span>
          ))}
          <span style={{ color: "#64748b" }}>These are tracking-pixel loads, not verified human reads. Recipient identity is only shown when reported by the provider; with one recipient, Mango labels the likely recipient as inferred.</span>
        </span>
      )}
    </span>
  );
}
