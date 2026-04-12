import React from "react";

/* ── Sparkline ── */
export const Sparkline: React.FC<{ accent: string }> = ({ accent }) => {
  const points = Array.from({ length: 14 }, (_, i) => {
    const y = 28 + Math.sin(i * 0.7 + 1.2) * 18 + Math.sin(i * 1.3) * 6;
    return `${i * 16 + 4},${y}`;
  }).join(" ");

  return (
    <svg width="100%" height="55" viewBox="0 0 220 55" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${accent.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points={`${points} 220,55 4,55`} fill={`url(#sg-${accent.slice(1)})`} />
    </svg>
  );
};

/* ── Bar Chart ── */
export const BarChart: React.FC<{ accent: string }> = ({ accent }) => {
  const bars = [38, 52, 44, 70, 60, 48, 65, 55, 72];
  return (
    <svg width="100%" height="70" viewBox="0 0 200 70" preserveAspectRatio="none">
      {bars.map((h, i) => (
        <rect key={i} x={i * 22 + 4} y={70 - h} width="16" rx="4" height={h} fill={accent} opacity={0.2 + (i / bars.length) * 0.7} />
      ))}
    </svg>
  );
};

/* ── Donut ── */
export const DonutChart: React.FC<{ accent: string; pct?: number }> = ({ accent, pct = 0.75 }) => {
  const r = 28, cx = 40, cy = 40, stroke = 7;
  const circ = 2 * Math.PI * r;
  return (
    <svg width="80" height="80" viewBox="0 0 80 80">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e0e0e0" strokeWidth={stroke} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={accent} strokeWidth={stroke}
        strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`} strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={accent}>
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
};

/* ── Per-widget content ── */

export const RevenueContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div>
    <div style={{ fontSize: 28, fontWeight: 800, color: accent }}>$48.2k</div>
    <div style={{ fontSize: 12, color: "#888", margin: "2px 0 6px" }}>+12.3% vs last month</div>
    <Sparkline accent={accent} />
  </div>
);

export const UsersContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div>
    <div style={{ fontSize: 28, fontWeight: 800, color: accent }}>3,847</div>
    <div style={{ fontSize: 12, color: "#888", margin: "2px 0 6px" }}>Online right now</div>
    <BarChart accent={accent} />
  </div>
);

export const AlertsContent: React.FC<{ accent: string }> = ({ accent }) => {
  const items = [
    { text: "CPU > 90% on app-2", dot: "#d32f2f" },
    { text: "Disk full on db-3", dot: "#f57c00" },
    { text: "SSL cert expiring in 4d", dot: "#f57c00" },
    { text: "Memory spike resolved", dot: "#66bb6a" },
    { text: "Deploy v2.4.1 complete", dot: "#66bb6a" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.dot, flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "#444" }}>{item.text}</span>
        </div>
      ))}
    </div>
  );
};

export const TasksContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
    <DonutChart accent={accent} pct={0.75} />
    <div>
      <div style={{ fontSize: 13, color: "#777" }}>Completed</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent }}>18/24</div>
      <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>6 remaining</div>
    </div>
  </div>
);

export const ChartContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div>
    <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>Weekly page views</div>
    <BarChart accent={accent} />
  </div>
);

export const OrdersContent: React.FC<{ accent: string }> = ({ accent }) => {
  const orders = [
    { id: "#4012", status: "Shipped", color: "#2E7D32" },
    { id: "#4011", status: "Processing", color: "#F57C00" },
    { id: "#4010", status: "Delivered", color: "#1565C0" },
    { id: "#4009", status: "Refunded", color: "#999" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {orders.map((o, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #eee" }}>
          <span style={{ fontSize: 13, color: "#333", fontWeight: 600 }}>{o.id}</span>
          <span style={{ fontSize: 12, color: o.color, fontWeight: 600 }}>{o.status}</span>
        </div>
      ))}
    </div>
  );
};

export const NotificationsContent: React.FC<{ accent: string }> = ({ accent }) => {
  const notifs = ["New signup: jane@acme.co", "Payment received — $120.00", "Server restart complete", "Comment on PR #482"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {notifs.map((n, i) => (
        <div key={i} style={{ fontSize: 13, color: "#444", padding: "6px 0", borderBottom: "1px solid #eee" }}>{n}</div>
      ))}
    </div>
  );
};

export const MapContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
    <div style={{ textAlign: "center", opacity: 0.45 }}>
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.5">
        <circle cx="12" cy="10" r="3" />
        <path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z" />
      </svg>
      <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>Map placeholder</div>
    </div>
  </div>
);
