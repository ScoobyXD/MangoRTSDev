import React from "react";
import {
  getCalendarInviteEvent,
  respondToCalendarInvite,
  type CalendarInviteEvent,
  type CalendarInviteRSVPStatus,
} from "./communicationsApi.js";

function safeExternalURL(value: string | undefined): string {
  const clean = value?.trim() ?? "";
  if (!clean) return "";
  try {
    const parsed = new URL(clean);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function eventTimeLabel(event: CalendarInviteEvent | null): string {
  const when = event?.when;
  if (!when) return "";
  const formatTimestamp = (value: number | undefined) => (
    Number.isFinite(value) ? new Date(Math.max(0, Math.trunc(value ?? 0)) * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""
  );
  if (when.start_time || when.time) {
    const start = formatTimestamp(when.start_time || when.time);
    const end = formatTimestamp(when.end_time);
    const timezone = when.start_timezone?.trim() || when.end_timezone?.trim() || "";
    return [end && end !== start ? `${start} – ${end}` : start, timezone].filter(Boolean).join(" · ");
  }
  if (when.start_date || when.date) {
    const start = when.start_date || when.date || "";
    const end = when.end_date && when.end_date !== start ? ` – ${when.end_date}` : "";
    return `${start}${end}`;
  }
  return "";
}

function responseLabel(status: CalendarInviteRSVPStatus): string {
  if (status === "yes") return "Accepted";
  if (status === "maybe") return "Tentative";
  return "Declined";
}

export function CalendarInviteCard({
  messageID,
  companyID,
  sharedInboxID,
  accountEmail,
  disabled = false,
  compact = false,
  accent = "#0f766e",
  onError,
}: {
  messageID: string;
  companyID?: string;
  sharedInboxID?: string;
  accountEmail?: string;
  disabled?: boolean;
  compact?: boolean;
  accent?: string;
  onError?: (message: string) => void;
}) {
  const [event, setEvent] = React.useState<CalendarInviteEvent | null>(null);
  const [response, setResponse] = React.useState<CalendarInviteRSVPStatus | "">("");
  const [loading, setLoading] = React.useState(true);
  const [responding, setResponding] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void getCalendarInviteEvent({ messageID, companyID, sharedInboxID, accountEmail })
      .then((nextEvent) => {
        if (cancelled) return;
        setEvent(nextEvent);
        setResponse(nextEvent.rsvp_status ?? "");
      })
      .catch((cause) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : "Calendar details are unavailable.";
        setLoadError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [accountEmail, companyID, messageID, sharedInboxID]);

  const respond = (status: CalendarInviteRSVPStatus) => {
    if (disabled || responding) return;
    setResponding(true);
    void respondToCalendarInvite({ messageID, status, companyID, sharedInboxID, accountEmail })
      .then(() => setResponse(status))
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : "Failed to respond to the calendar invitation.";
        onError?.(message);
      })
      .finally(() => setResponding(false));
  };

  const meetingURL = safeExternalURL(event?.conference_url);
  const calendarURL = safeExternalURL(event?.html_link);
  const organizer = event?.organizer?.name?.trim() || event?.organizer?.email?.trim() || "";
  const participants = (event?.participants ?? [])
    .map((participant) => participant.name?.trim() || participant.email?.trim() || "")
    .filter(Boolean);
  const timeLabel = eventTimeLabel(event);

  return (
    <section
      aria-label="Calendar invitation"
      style={{ minWidth: 0, display: "grid", gap: compact ? 6 : 9, border: "1px solid rgba(45,212,191,0.28)", borderRadius: 10, background: "rgba(240,253,250,0.78)", padding: compact ? "8px 9px" : "11px 12px" }}
    >
      <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
          <span style={{ color: "rgba(71,85,105,0.78)", fontSize: compact ? 10 : 11, fontWeight: 850, textTransform: "uppercase", letterSpacing: "0.04em" }}>Calendar invitation</span>
          <strong style={{ color: "#0f172a", fontSize: compact ? 12 : 14, overflowWrap: "anywhere" }}>{event?.title?.trim() || "Meeting invitation"}</strong>
        </div>
        {response && <span role="status" style={{ color: accent, fontSize: 11, fontWeight: 850 }}>{responseLabel(response)}</span>}
      </div>
      {loading && <span style={{ color: "rgba(71,85,105,0.76)", fontSize: 11 }}>Loading meeting details…</span>}
      {!loading && (
        <div style={{ display: "grid", gap: 3, color: "rgba(51,65,85,0.9)", fontSize: compact ? 10.5 : 12 }}>
          {timeLabel && <span><strong>When:</strong> {timeLabel}</span>}
          {organizer && <span><strong>Organizer:</strong> {organizer}</span>}
          {event?.location?.trim() && <span><strong>Where:</strong> {event.location.trim()}</span>}
          {participants.length > 0 && <span><strong>Guests:</strong> {participants.slice(0, 4).join(", ")}{participants.length > 4 ? ` +${participants.length - 4}` : ""}</span>}
          {loadError && <span title={loadError}>Meeting details could not be loaded. You can still respond.</span>}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {([["yes", "Accept"], ["maybe", "Tentative"], ["no", "Decline"]] as const).map(([status, label]) => (
          <button
            key={status}
            type="button"
            disabled={disabled || responding}
            onClick={() => respond(status)}
            style={{ minHeight: 29, border: "1px solid rgba(148,163,184,0.34)", borderRadius: 7, background: response === status ? "rgba(204,251,241,0.96)" : "rgba(255,255,255,0.82)", color: status === "no" ? "#b91c1c" : accent, cursor: disabled ? "default" : responding ? "wait" : "pointer", padding: "4px 9px", fontSize: compact ? 10.5 : 11.5, fontWeight: 850 }}
          >
            {label}
          </button>
        ))}
        {meetingURL && <a href={meetingURL} target="_blank" rel="noopener noreferrer" style={{ color: accent, fontSize: 11, fontWeight: 850 }}>Join meeting</a>}
        {meetingURL && (
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(meetingURL); }} style={{ border: 0, background: "transparent", color: accent, cursor: "pointer", padding: 3, fontSize: 11, fontWeight: 800 }}>
            Copy link
          </button>
        )}
        {calendarURL && <a href={calendarURL} target="_blank" rel="noopener noreferrer" style={{ color: accent, fontSize: 11, fontWeight: 850 }}>Open calendar</a>}
      </div>
    </section>
  );
}
