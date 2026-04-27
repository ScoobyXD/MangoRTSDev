import React, { useCallback, useEffect, useRef, useState } from "react";
import { NodeDetails, NodeDocBox, NodeInformation, NODE_DOC_MIN_H, NODE_DOC_MIN_W, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, clamp, parseDocBox } from "../node-map/shared";
import { EVENT_EXPLORER_CONTEXT_UPDATED, EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";

// Editor module: node-linked document canvas for text boxes and notes.
export const EditorContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean }> = ({ accent, widgetId }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [linkedMapWidgetID, setLinkedMapWidgetID] = useState("");
  const [linkedNodeID, setLinkedNodeID] = useState("");
  const [linkedNodeHeader, setLinkedNodeHeader] = useState("");
  const [linkedNodeInfoPreview, setLinkedNodeInfoPreview] = useState<string[]>([]);
  const [boxes, setBoxes] = useState<NodeDocBox[]>([]);
  const [activeBoxID, setActiveBoxID] = useState<string>("");
  const [focusBoxID, setFocusBoxID] = useState<string>("");
  const [placing, setPlacing] = useState<{ id: string; pointerID: number; dx: number; dy: number } | null>(null);
  const [resizing, setResizing] = useState<{
    id: string;
    pointerID: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startBoxX: number;
    startBoxY: number;
    edges: { top?: true; right?: true; bottom?: true; left?: true };
  } | null>(null);
  const [error, setError] = useState("");
  const lastSelectionRevisionRef = useRef(0);

  // API helper for editor load/save flows tied to selected node context.
  const requestJSON = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    // Avoid setting Content-Type for body-less requests to prevent unnecessary preflights on GETs.
    if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }, [apiBase]);

  // Resolves linked map frame via graph links + frame registry metadata.
  const readLinkedMapWidgetID = useCallback((): string => {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    return resolveLinkedFrameByKindFromGraph({
      startFrameID: scope,
      targetKind: "map",
      edges,
      registry,
    });
  }, [scope]);

  // Reads currently selected node from linked node-map persisted state.
  const readSelectedNodeFromMap = useCallback((mapWidgetID: string): string => {
    if (!mapWidgetID) return "";
    try {
      const raw = localStorage.getItem(`node-map-state-v1:${companyID}:${mapWidgetID}`);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { selectedNodeID?: string };
      return typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "";
    } catch {
      return "";
    }
  }, [companyID]);

  const readSelectedNodeFromExplorerContext = useCallback((): string => {
    try {
      const raw = localStorage.getItem(`${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { selectedNodeID?: string };
      return typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "";
    } catch {
      return "";
    }
  }, [companyID, scope]);

  // Persist a single document box into node information rows (Text box type).
  const saveBox = useCallback(async (nodeID: string, box: NodeDocBox) => {
    const payload = JSON.stringify({ local_id: box.local_id, x: box.x, y: box.y, w: box.w, h: box.h, text: box.information });
    const created = await requestJSON<NodeInformation>(`/v1/nodes/${nodeID}/information`, {
      method: "POST",
      body: JSON.stringify({ company_id: companyID, type: "Text box", information: payload }),
    });
    setBoxes((prev) => prev.map((item) => (item.local_id === box.local_id ? { ...item, information_id: created.information_id } : item)));
  }, [companyID, requestJSON]);

  useEffect(() => {
    const refresh = () => setLinkedMapWidgetID(readLinkedMapWidgetID());
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FRAME_LINKS_KEY && event.key !== FRAME_REGISTRY_KEY) return;
      refresh();
    };
    const onGraphUpdated = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    };
  }, [readLinkedMapWidgetID]);

  useEffect(() => {
    const refresh = () => {
      const selectedFromMap = readSelectedNodeFromMap(linkedMapWidgetID);
      if (selectedFromMap) {
        setLinkedNodeID(selectedFromMap);
        return;
      }
      setLinkedNodeID(readSelectedNodeFromExplorerContext());
    };
    refresh();
    const onStorage = (event: StorageEvent) => {
      const mapStateKey = linkedMapWidgetID ? `node-map-state-v1:${companyID}:${linkedMapWidgetID}` : "";
      const explorerContextKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      if (event.key && event.key !== mapStateKey && event.key !== explorerContextKey) return;
      refresh();
    };
    const onMapStateUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; revision?: number }>).detail;
      if (!detail || detail.mapWidgetID !== linkedMapWidgetID) return;
      const revision = typeof detail.revision === "number" ? detail.revision : 0;
      if (revision > 0 && revision <= lastSelectionRevisionRef.current) return;
      if (revision > 0) lastSelectionRevisionRef.current = revision;
      refresh();
    };
    const onExplorerContextUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; targetID?: string }>).detail;
      if (!detail) return;
      const expectedKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      if (detail.key !== expectedKey && detail.targetID !== scope) return;
      refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapStateUpdated);
    window.addEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapStateUpdated);
      window.removeEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    };
  }, [companyID, linkedMapWidgetID, readSelectedNodeFromMap, readSelectedNodeFromExplorerContext, scope]);

  useEffect(() => {
    let cancelled = false;
    if (!linkedNodeID) {
      setBoxes([]);
      setActiveBoxID("");
      setLinkedNodeHeader("");
      setLinkedNodeInfoPreview([]);
      return;
    }
    (async () => {
      try {
        setError("");
        const details = await requestJSON<NodeDetails>(`/v1/nodes/${linkedNodeID}?company_id=${encodeURIComponent(companyID)}`);
        if (cancelled) return;
        setLinkedNodeHeader(details.node.header);
        const nonText = details.information.filter((item) => item.type !== "Text box");
        setLinkedNodeInfoPreview([
          `Text boxes: ${details.information.length - nonText.length}`,
          ...nonText.slice(0, 2).map((item) => `${item.type}: ${item.information}`),
        ]);
        const latestByBox = new Map<string, NodeDocBox>();
        const orderedInfo = [...details.information].sort((a, b) => new Date(a.updated_timestamp).getTime() - new Date(b.updated_timestamp).getTime());
        for (const info of orderedInfo) {
          const parsed = parseDocBox(info);
          if (!parsed) continue;
          latestByBox.set(parsed.local_id, parsed);
        }
        const nextBoxes = Array.from(latestByBox.values());
        setBoxes(nextBoxes);
        if (nextBoxes.length > 0) setActiveBoxID(nextBoxes[nextBoxes.length - 1].local_id);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load linked node information");
      }
    })();
    return () => { cancelled = true; };
  }, [companyID, linkedNodeID, requestJSON]);

  useEffect(() => {
    if (!placing || !canvasRef.current) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== placing.pointerID || !canvasRef.current) return;
      const bounds = canvasRef.current.getBoundingClientRect();
      const x = clamp(event.clientX - bounds.left - placing.dx, 8, Math.max(8, bounds.width - 140));
      const y = clamp(event.clientY - bounds.top - placing.dy, 34, Math.max(34, bounds.height - 40));
      setBoxes((prev) => prev.map((item) => (item.local_id === placing.id ? { ...item, x, y } : item)));
    };
    const onUp = () => {
      const moved = boxes.find((item) => item.local_id === placing.id);
      if (linkedNodeID && moved) void saveBox(linkedNodeID, moved);
      setPlacing(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [boxes, linkedNodeID, placing, saveBox]);

  useEffect(() => {
    if (!resizing || !canvasRef.current) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== resizing.pointerID || !canvasRef.current) return;
      const bounds = canvasRef.current.getBoundingClientRect();
      const dx = event.clientX - resizing.startX;
      const dy = event.clientY - resizing.startY;
      setBoxes((prev) => prev.map((item) => {
        if (item.local_id !== resizing.id) return item;
        let nextX = resizing.startBoxX;
        let nextY = resizing.startBoxY;
        let nextW = resizing.startW;
        let nextH = resizing.startH;
        if (resizing.edges.right) nextW = resizing.startW + dx;
        if (resizing.edges.bottom) nextH = resizing.startH + dy;
        if (resizing.edges.left) {
          nextX = resizing.startBoxX + dx;
          nextW = resizing.startW - dx;
        }
        if (resizing.edges.top) {
          nextY = resizing.startBoxY + dy;
          nextH = resizing.startH - dy;
        }
        nextW = clamp(nextW, NODE_DOC_MIN_W, Math.max(NODE_DOC_MIN_W, bounds.width - 12));
        nextH = clamp(nextH, NODE_DOC_MIN_H, Math.max(NODE_DOC_MIN_H, bounds.height - 12));
        nextX = clamp(nextX, 8, Math.max(8, bounds.width - nextW - 8));
        nextY = clamp(nextY, 34, Math.max(34, bounds.height - nextH - 8));
        return { ...item, x: nextX, y: nextY, w: nextW, h: nextH };
      }));
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== resizing.pointerID) return;
      const next = boxes.find((item) => item.local_id === resizing.id);
      if (linkedNodeID && next) void saveBox(linkedNodeID, next);
      setResizing(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [boxes, linkedNodeID, resizing, saveBox]);


  useEffect(() => {
    if (!focusBoxID) return;
    const textarea = canvasRef.current?.querySelector<HTMLTextAreaElement>(`textarea[data-box-id="${focusBoxID}"]`);
    if (!textarea) return;
    textarea.focus();
    const length = textarea.value.length;
    textarea.setSelectionRange(length, length);
    setFocusBoxID("");
  }, [boxes, focusBoxID]);

  const createBox = useCallback((initialText: string, x?: number, y?: number) => {
    const baseX = typeof x === "number" ? x : 24 + (boxes.length % 6) * 18;
    const baseY = typeof y === "number" ? y : 56 + (boxes.length % 6) * 14;
    const localID = `docbox-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    const next: NodeDocBox = { local_id: localID, x: baseX, y: baseY, w: 320, h: 52, information: initialText };
    setBoxes((prev) => [...prev, next]);
    setActiveBoxID(localID);
    setFocusBoxID(localID);
    if (linkedNodeID && initialText.trim().length > 0) void saveBox(linkedNodeID, next);
  }, [boxes.length, linkedNodeID, saveBox]);

  return (
    <div
      ref={canvasRef}
      style={{ position: "relative", width: "100%", height: "100%", background: "#ffffff", color: "#0d1a1e", overflow: "hidden" }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
        const current = boxes.find((item) => item.local_id === activeBoxID);
        if (current) return;
        createBox(event.key);
        event.preventDefault();
      }}
      onDoubleClick={(event) => {
        if (!canvasRef.current) return;
        const bounds = canvasRef.current.getBoundingClientRect();
        const x = clamp(event.clientX - bounds.left, 12, Math.max(12, bounds.width - 340));
        const y = clamp(event.clientY - bounds.top, 40, Math.max(40, bounds.height - 90));
        createBox("", x, y);
      }}
    >
      {linkedNodeHeader && (
        <div style={{ position: "absolute", top: 8, left: 10, right: 12, display: "grid", gap: 2, pointerEvents: "none" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: accent }}>
            Node: {linkedNodeHeader}
          </div>
          <div style={{ fontSize: 10, opacity: 0.7 }}>
            {linkedNodeInfoPreview.length > 0 ? linkedNodeInfoPreview.join(" • ") : "No non-text node information yet"}
          </div>
        </div>
      )}
      {boxes.map((box) => (
        <div key={box.local_id} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, minWidth: NODE_DOC_MIN_W, minHeight: NODE_DOC_MIN_H }}>
          <textarea
            data-box-id={box.local_id}
            value={box.information}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onFocus={() => setActiveBoxID(box.local_id)}
            onChange={(event) => {
              const value = event.target.value;
              setBoxes((prev) => prev.map((item) => (item.local_id === box.local_id ? { ...item, information: value } : item)));
            }}
            onBlur={(event) => {
              if (!linkedNodeID) return;
              const latest = boxes.find((item) => item.local_id === box.local_id);
              const nextValue = event.currentTarget.value;
              if (latest) void saveBox(linkedNodeID, { ...latest, information: nextValue });
            }}
            style={{
              width: "100%",
              height: "100%",
              border: "1px solid rgba(0,0,0,0.38)",
              outline: box.local_id === activeBoxID ? `1px solid ${accent}` : "none",
              background: "rgba(255,255,255,0.42)",
              resize: "none",
              color: "#111",
              fontSize: 15,
              lineHeight: 1.45,
              fontFamily: "'Manrope', 'Helvetica Neue', sans-serif",
              padding: "6px 8px",
            }}
          />
          {([
            [{ top: true, left: true }, { top: -5, left: -5, cursor: "nwse-resize" }],
            [{ top: true }, { top: -5, left: 10, right: 10, height: 8, cursor: "ns-resize" }],
            [{ top: true, right: true }, { top: -5, right: -5, cursor: "nesw-resize" }],
            [{ right: true }, { top: 10, right: -5, bottom: 10, width: 8, cursor: "ew-resize" }],
            [{ bottom: true, right: true }, { bottom: -5, right: -5, cursor: "nwse-resize" }],
            [{ bottom: true }, { bottom: -5, left: 10, right: 10, height: 8, cursor: "ns-resize" }],
            [{ bottom: true, left: true }, { bottom: -5, left: -5, cursor: "nesw-resize" }],
            [{ left: true }, { top: 10, left: -5, bottom: 10, width: 8, cursor: "ew-resize" }],
          ] as const).map(([edges, style], index) => (
            <div
              key={`${box.local_id}-resize-${index}`}
              style={{ position: "absolute", ...style }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setActiveBoxID(box.local_id);
                setResizing({
                  id: box.local_id,
                  pointerID: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  startW: box.w,
                  startH: box.h,
                  startBoxX: box.x,
                  startBoxY: box.y,
                  edges,
                });
              }}
            />
          ))}
        </div>
      ))}
      {boxes.map((box) => (
        <div
          key={`${box.local_id}-handle`}
          style={{ position: "absolute", left: box.x - 12, top: box.y + 6, width: 8, height: 22, borderRadius: 999, background: "rgba(0,0,0,0.16)", cursor: "grab" }}
          onPointerDown={(event) => {
            event.preventDefault();
            setActiveBoxID(box.local_id);
            setPlacing({ id: box.local_id, pointerID: event.pointerId, dx: event.clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0) - box.x, dy: event.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0) - box.y });
          }}
        />
      ))}
      {error && <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 10, color: "#b00020" }}>{error}</div>}
      {!linkedMapWidgetID && <div style={{ position: "absolute", top: 12, left: 10, fontSize: 11, opacity: 0.72 }}>Right-click selected modules and use “Link modules”.</div>}
      {linkedMapWidgetID && !linkedNodeID && <div style={{ position: "absolute", top: 12, left: 10, fontSize: 11, opacity: 0.72 }}>Select a node in Node Map (Shift/Ctrl-click modules to multi-select and link).</div>}
    </div>
  );
};
