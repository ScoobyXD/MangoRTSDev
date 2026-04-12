import { useState, useRef, useCallback, useEffect } from "react";

const GRID_COLS = 12;
const CELL_SIZE = 64;
const GAP = 8;

const INITIAL_WIDGETS = [
  { id: "w1", x: 0, y: 0, w: 4, h: 3, title: "Revenue", color: "#E8F5E9", accent: "#2E7D32" },
  { id: "w2", x: 4, y: 0, w: 5, h: 3, title: "Active Users", color: "#E3F2FD", accent: "#1565C0" },
  { id: "w3", x: 9, y: 0, w: 3, h: 5, title: "Alerts", color: "#FFF3E0", accent: "#E65100" },
  { id: "w4", x: 0, y: 3, w: 3, h: 4, title: "Tasks", color: "#F3E5F5", accent: "#6A1B9A" },
  { id: "w5", x: 3, y: 3, w: 6, h: 4, title: "Analytics Chart", color: "#ECEFF1", accent: "#37474F" },
  { id: "w6", x: 0, y: 7, w: 4, h: 3, title: "Recent Orders", color: "#E0F7FA", accent: "#00695C" },
  { id: "w7", x: 4, y: 7, w: 4, h: 3, title: "Notifications", color: "#FCE4EC", accent: "#AD1457" },
  { id: "w8", x: 8, y: 5, w: 4, h: 5, title: "Map View", color: "#F1F8E9", accent: "#558B2F" },
];

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function checkCollision(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function resolveCollisions(widgets, movedId) {
  const moved = widgets.find((w) => w.id === movedId);
  if (!moved) return widgets;
  let result = widgets.map((w) => ({ ...w }));
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 50) {
    changed = false;
    iterations++;
    for (let w of result) {
      if (w.id === movedId) continue;
      if (checkCollision(moved, w)) {
        w.y = moved.y + moved.h;
        changed = true;
      }
    }
  }
  return result;
}

// Mini sparkline
function Sparkline({ accent }) {
  const points = Array.from({ length: 12 }, (_, i) => {
    const y = 30 + Math.sin(i * 0.8 + Math.random()) * 20 + Math.random() * 10;
    return `${i * 18 + 10},${y}`;
  }).join(" ");
  return (
    <svg width="100%" height="60" viewBox="0 0 220 60" style={{ opacity: 0.7 }}>
      <polyline
        points={points}
        fill="none"
        stroke={accent}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BarChart({ accent }) {
  const bars = Array.from({ length: 7 }, () => 15 + Math.random() * 60);
  return (
    <svg width="100%" height="70" viewBox="0 0 180 70">
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 25 + 5}
          y={70 - h}
          width="18"
          rx="3"
          height={h}
          fill={accent}
          opacity={0.25 + (i / bars.length) * 0.65}
        />
      ))}
    </svg>
  );
}

function DonutChart({ accent }) {
  const pct = 0.4 + Math.random() * 0.4;
  const r = 28, cx = 40, cy = 40, stroke = 7;
  const circ = 2 * Math.PI * r;
  return (
    <svg width="80" height="80" viewBox="0 0 80 80">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e0e0e0" strokeWidth={stroke} />
      <circle
        cx={cx} cy={cy} r={r} fill="none" stroke={accent} strokeWidth={stroke}
        strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill={accent}>
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

const WIDGET_CONTENT = {
  w1: (a) => (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, color: a, fontFamily: "'DM Sans', sans-serif" }}>$48.2k</div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>+12.3% vs last month</div>
      <Sparkline accent={a} />
    </div>
  ),
  w2: (a) => (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, color: a, fontFamily: "'DM Sans', sans-serif" }}>3,847</div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Online right now</div>
      <BarChart accent={a} />
    </div>
  ),
  w3: (a) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {["CPU > 90%", "Disk full on db-3", "SSL cert expiring", "Memory spike"].map((t, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: i === 0 ? "#d32f2f" : i === 1 ? "#f57c00" : "#bbb", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "#444" }}>{t}</span>
        </div>
      ))}
    </div>
  ),
  w4: (a) => (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <DonutChart accent={a} />
      <div>
        <div style={{ fontSize: 13, color: "#666" }}>Completed</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: a }}>18/24</div>
      </div>
    </div>
  ),
  w5: (a) => <BarChart accent={a} />,
  w6: (a) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {["#4012 — Shipped", "#4011 — Processing", "#4010 — Delivered"].map((t, i) => (
        <div key={i} style={{ fontSize: 13, color: "#444", padding: "4px 0", borderBottom: "1px solid #eee" }}>{t}</div>
      ))}
    </div>
  ),
  w7: (a) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {["New signup: jane@acme.co", "Payment received $120", "Server restart complete"].map((t, i) => (
        <div key={i} style={{ fontSize: 13, color: "#444", padding: "4px 0", borderBottom: "1px solid #eee" }}>{t}</div>
      ))}
    </div>
  ),
  w8: (a) => (
    <div style={{ height: "100%", display: "grid", placeItems: "center", opacity: 0.5 }}>
      <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke={a} strokeWidth="1.5">
        <circle cx="12" cy="10" r="3" /><path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z" />
      </svg>
    </div>
  ),
};

function Widget({ widget, onDragStart, onResizeStart, isEditing }) {
  const { title, color, accent, w, h } = widget;
  const width = w * CELL_SIZE + (w - 1) * GAP;
  const height = h * CELL_SIZE + (h - 1) * GAP;

  return (
    <div
      style={{
        position: "absolute",
        left: widget.x * (CELL_SIZE + GAP),
        top: widget.y * (CELL_SIZE + GAP),
        width,
        height,
        background: color,
        borderRadius: 14,
        border: `1.5px solid ${accent}22`,
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: isEditing ? "none" : "left 0.3s cubic-bezier(.4,0,.2,1), top 0.3s cubic-bezier(.4,0,.2,1), width 0.3s, height 0.3s",
        cursor: "grab",
        userSelect: "none",
        zIndex: isEditing ? 100 : 1,
      }}
      onMouseDown={(e) => {
        if (e.target.dataset.resize) return;
        onDragStart(e, widget.id);
      }}
      onTouchStart={(e) => {
        if (e.target.dataset.resize) return;
        onDragStart(e, widget.id);
      }}
    >
      {/* Header */}
      <div style={{
        padding: "12px 14px 6px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span style={{
          fontSize: 13,
          fontWeight: 700,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily: "'DM Sans', sans-serif",
        }}>{title}</span>
        <span style={{ fontSize: 11, color: "#aaa" }}>{w}×{h}</span>
      </div>
      {/* Content */}
      <div style={{ flex: 1, padding: "4px 14px 10px", overflow: "hidden" }}>
        {WIDGET_CONTENT[widget.id]?.(accent) ?? null}
      </div>
      {/* Resize handle */}
      <div
        data-resize="true"
        onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, widget.id); }}
        onTouchStart={(e) => { e.stopPropagation(); onResizeStart(e, widget.id); }}
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 22,
          height: 22,
          cursor: "nwse-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: 0.35,
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10">
          <path d="M9 1v8H1" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
          <path d="M9 5v4H5" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

export default function GridDashboard() {
  const [widgets, setWidgets] = useState(INITIAL_WIDGETS);
  const [editingId, setEditingId] = useState(null);
  const dragRef = useRef(null);
  const containerRef = useRef(null);

  const getPointer = (e) => {
    if (e.touches) return { px: e.touches[0].clientX, py: e.touches[0].clientY };
    return { px: e.clientX, py: e.clientY };
  };

  const onDragStart = useCallback((e, id) => {
    e.preventDefault();
    const { px, py } = getPointer(e);
    const widget = widgets.find((w) => w.id === id);
    const rect = containerRef.current.getBoundingClientRect();
    dragRef.current = {
      id,
      mode: "drag",
      startX: px,
      startY: py,
      origX: widget.x,
      origY: widget.y,
      offsetLeft: rect.left,
      offsetTop: rect.top,
    };
    setEditingId(id);
  }, [widgets]);

  const onResizeStart = useCallback((e, id) => {
    e.preventDefault();
    const { px, py } = getPointer(e);
    const widget = widgets.find((w) => w.id === id);
    dragRef.current = {
      id,
      mode: "resize",
      startX: px,
      startY: py,
      origW: widget.w,
      origH: widget.h,
    };
    setEditingId(id);
  }, [widgets]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const { px, py } = getPointer(e);
      const d = dragRef.current;
      const dx = px - d.startX;
      const dy = py - d.startY;

      setWidgets((prev) => {
        return prev.map((w) => {
          if (w.id !== d.id) return w;
          if (d.mode === "drag") {
            const newX = clamp(d.origX + Math.round(dx / (CELL_SIZE + GAP)), 0, GRID_COLS - w.w);
            const newY = clamp(d.origY + Math.round(dy / (CELL_SIZE + GAP)), 0, 50);
            return { ...w, x: newX, y: newY };
          } else {
            const newW = clamp(d.origW + Math.round(dx / (CELL_SIZE + GAP)), 2, GRID_COLS);
            const newH = clamp(d.origH + Math.round(dy / (CELL_SIZE + GAP)), 2, 12);
            return { ...w, w: newW, h: newH };
          }
        });
      });
    };

    const onEnd = () => {
      if (dragRef.current) {
        const id = dragRef.current.id;
        setWidgets((prev) => resolveCollisions(prev, id));
        dragRef.current = null;
        setEditingId(null);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, []);

  const maxY = widgets.reduce((m, w) => Math.max(m, w.y + w.h), 0);
  const gridH = (maxY + 2) * (CELL_SIZE + GAP);
  const gridW = GRID_COLS * (CELL_SIZE + GAP) - GAP;

  return (
    <div style={{
      minHeight: "100vh",
      background: "#F5F5F0",
      fontFamily: "'DM Sans', 'Helvetica Neue', sans-serif",
      overflow: "auto",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        padding: "24px 32px 16px",
        display: "flex",
        alignItems: "baseline",
        gap: 16,
        maxWidth: gridW + 64,
        margin: "0 auto",
      }}>
        <h1 style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 800,
          color: "#222",
          letterSpacing: "-0.02em",
        }}>
          Dashboard
        </h1>
        <span style={{ fontSize: 13, color: "#999" }}>
          Drag to move · Drag corner to resize · Snaps to 64px grid
        </span>
      </div>

      {/* Grid */}
      <div style={{
        maxWidth: gridW + 64,
        margin: "0 auto",
        padding: "0 32px 48px",
      }}>
        <div
          ref={containerRef}
          style={{
            position: "relative",
            width: gridW,
            height: gridH,
          }}
        >
          {/* Background grid dots */}
          <svg
            width={gridW}
            height={gridH}
            style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", opacity: 0.25 }}
          >
            {Array.from({ length: GRID_COLS + 1 }).map((_, col) =>
              Array.from({ length: maxY + 3 }).map((_, row) => (
                <circle
                  key={`${col}-${row}`}
                  cx={col * (CELL_SIZE + GAP)}
                  cy={row * (CELL_SIZE + GAP)}
                  r="2"
                  fill="#999"
                />
              ))
            )}
          </svg>

          {/* Widgets */}
          {widgets.map((w) => (
            <Widget
              key={w.id}
              widget={w}
              onDragStart={onDragStart}
              onResizeStart={onResizeStart}
              isEditing={editingId === w.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
