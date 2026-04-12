import React, { useMemo, useState } from "react";

const divider = { borderBottom: "1px solid currentColor", padding: "5px 0" };

export const RevenueContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Monthly Revenue ]</div>
    <div style={{ fontSize: 28, fontWeight: 700, color: "inherit" }}>$48.2K</div>
    <div style={{ ...divider, fontSize: 12 }}>+12.3% vs last month</div>
    <div style={{ fontSize: 12 }}>Forecast status: STABLE</div>
  </div>
);

export const UsersContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Active Users ]</div>
    <div style={{ fontSize: 28, fontWeight: 700, color: "inherit" }}>3,847</div>
    <div style={{ ...divider, fontSize: 12 }}>Sessions in last 10 min</div>
    <div style={{ fontSize: 12 }}>Regions synced: 04 / 04</div>
  </div>
);

export const AlertsContent: React.FC<{ accent: string }> = ({ accent }) => {
  const items = ["CPU > 90% on app-2", "Disk full on db-3", "SSL cert expiring in 4d", "Memory spike resolved"];
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "inherit" }}>[ Alerts Feed ]</div>
      {items.map((item, i) => (
        <div key={i} style={{ ...divider, fontSize: 12 }}>{String(i + 1).padStart(2, "0")} // {item}</div>
      ))}
    </div>
  );
};

export const TasksContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Sprint Tasks ]</div>
    <div style={{ fontSize: 30, fontWeight: 700, color: "inherit" }}>18/24</div>
    <div style={{ ...divider, fontSize: 12 }}>Completion ratio: 75%</div>
    <div style={{ fontSize: 12 }}>Open blockers: 02</div>
  </div>
);

export const ChartContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Analytics ]</div>
    <div style={{ ...divider, fontSize: 12 }}>Page views (WEEK): 84,120</div>
    <div style={{ ...divider, fontSize: 12 }}>Conversion: 3.4%</div>
    <div style={{ fontSize: 12, color: "inherit" }}>Trend: POSITIVE / LOW VOLATILITY</div>
  </div>
);

export const OrdersContent: React.FC<{ accent: string }> = ({ accent }) => {
  const orders = ["#4012 // SHIPPED", "#4011 // PROCESSING", "#4010 // DELIVERED", "#4009 // REFUNDED"];
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "inherit" }}>[ Recent Orders ]</div>
      {orders.map((item, i) => (
        <div key={i} style={{ ...divider, fontSize: 12 }}>{item}</div>
      ))}
    </div>
  );
};

export const NotificationsContent: React.FC<{ accent: string }> = ({ accent }) => {
  const notifs = ["New signup: jane@acme.co", "Payment received: $120.00", "Server restart complete", "Comment on PR #482"];
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "inherit" }}>[ Notifications ]</div>
      {notifs.map((n, i) => (
        <div key={i} style={{ ...divider, fontSize: 12 }}>{n}</div>
      ))}
    </div>
  );
};

export const MapContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ height: "100%", display: "grid", alignContent: "start", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase", color: "inherit" }}>[ Geo Node ]</div>
    <div style={{ ...divider, fontSize: 12 }}>Primary: Zurich</div>
    <div style={{ ...divider, fontSize: 12 }}>Backup: Virginia</div>
    <div style={{ fontSize: 12 }}>Latency avg: 43ms</div>
  </div>
);

type CaseRecord = {
  id: string;
  title: string;
  responsible: string;
  parentId: string | null;
  notes: string[];
  links: string[];
};

const CASE_STORE_KEY = "grid-dashboard-case-widget-v1";

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function loadCases(): CaseRecord[] {
  try {
    const raw = localStorage.getItem(CASE_STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string" && typeof item.title === "string");
  } catch {
    return [];
  }
}

export const CaseHubContent: React.FC<{ accent: string }> = ({ accent }) => {
  const [records, setRecords] = useState<CaseRecord[]>(() => loadCases());
  const [selectedId, setSelectedId] = useState<string>(records[0]?.id ?? "");
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [ownerDraft, setOwnerDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [linkDraft, setLinkDraft] = useState("");
  const [quickDraft, setQuickDraft] = useState("");
  const [childDraft, setChildDraft] = useState("");

  const selected = records.find((item) => item.id === selectedId) ?? null;

  const save = (next: CaseRecord[]) => {
    setRecords(next);
    localStorage.setItem(CASE_STORE_KEY, JSON.stringify(next));
  };

  const createCase = (title: string, parentId: string | null = null) => {
    if (!title.trim()) return;
    const nextItem: CaseRecord = {
      id: makeId(),
      title: title.trim(),
      responsible: parentId ? "" : "Unassigned",
      parentId,
      notes: [],
      links: [],
    };
    const next = [nextItem, ...records];
    save(next);
    setSelectedId(nextItem.id);
  };

  const updateSelected = (updater: (item: CaseRecord) => CaseRecord) => {
    if (!selected) return;
    const next = records.map((item) => (item.id === selected.id ? updater(item) : item));
    save(next);
  };

  const deleteSelected = () => {
    if (!selected) return;
    const next = records.filter((item) => item.id !== selected.id && item.parentId !== selected.id);
    save(next);
    setSelectedId(next[0]?.id ?? "");
  };

  const childCount = useMemo(() => records.filter((item) => item.parentId === selected?.id).length, [records, selected?.id]);
  const isLikelyUrl = (value: string) => /^https?:\/\//i.test(value.trim());

  return (
    <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Case Module ]</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
        <input value={newCaseTitle} onChange={(e) => setNewCaseTitle(e.target.value)} placeholder="Create case..." />
        <button onClick={() => { createCase(newCaseTitle, null); setNewCaseTitle(""); }}>Add</button>
      </div>

      <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
        <option value="">Select case</option>
        {records.map((item) => (
          <option key={item.id} value={item.id}>{item.parentId ? "↳ " : ""}{item.title}</option>
        ))}
      </select>

      {selected ? (
        <div style={{ display: "grid", gap: 4, borderTop: `1px solid ${accent}`, paddingTop: 4 }}>
          <div style={{ ...divider }}>Owner: {selected.responsible || "Unassigned"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input value={ownerDraft} onChange={(e) => setOwnerDraft(e.target.value)} placeholder="Set responsible" />
            <button onClick={() => { updateSelected((item) => ({ ...item, responsible: ownerDraft.trim() || item.responsible })); setOwnerDraft(""); }}>Set</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add note" />
            <button onClick={() => { if (noteDraft.trim()) updateSelected((item) => ({ ...item, notes: [noteDraft.trim(), ...item.notes] })); setNoteDraft(""); }}>Note</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} placeholder="Link email/doc URL" />
            <button onClick={() => { if (linkDraft.trim()) updateSelected((item) => ({ ...item, links: [linkDraft.trim(), ...item.links] })); setLinkDraft(""); }}>Link</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input
              value={quickDraft}
              onChange={(e) => setQuickDraft(e.target.value)}
              placeholder="Quick add note or paste URL"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !quickDraft.trim()) return;
                const value = quickDraft.trim();
                updateSelected((item) => (
                  isLikelyUrl(value)
                    ? { ...item, links: [value, ...item.links] }
                    : { ...item, notes: [value, ...item.notes] }
                ));
                setQuickDraft("");
              }}
            />
            <button onClick={() => {
              if (!quickDraft.trim()) return;
              const value = quickDraft.trim();
              updateSelected((item) => (
                isLikelyUrl(value)
                  ? { ...item, links: [value, ...item.links] }
                  : { ...item, notes: [value, ...item.notes] }
              ));
              setQuickDraft("");
            }}>Quick</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input value={childDraft} onChange={(e) => setChildDraft(e.target.value)} placeholder="Create child case" />
            <button onClick={() => { createCase(childDraft, selected.id); setChildDraft(""); }}>Child</button>
          </div>

          <div style={{ ...divider }}>Children: {childCount} · Notes: {selected.notes.length} · Links: {selected.links.length}</div>
          <div style={{ display: "grid", gap: 2 }}>
            {selected.links.slice(0, 4).map((link, index) => (
              <div key={`${link}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, alignItems: "center" }}>
                <span style={{ ...divider, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🔗 {link}</span>
                <button onClick={() => updateSelected((item) => ({ ...item, links: item.links.filter((_, i) => i !== index) }))}>×</button>
              </div>
            ))}
            {selected.notes.slice(0, 4).map((note, index) => (
              <div key={`${note}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, alignItems: "center" }}>
                <span style={{ ...divider, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {note}</span>
                <button onClick={() => updateSelected((item) => ({ ...item, notes: item.notes.filter((_, i) => i !== index) }))}>×</button>
              </div>
            ))}
          </div>
          <button onClick={deleteSelected}>Delete case</button>
        </div>
      ) : (
        <div style={{ ...divider }}>No case selected.</div>
      )}
    </div>
  );
};
