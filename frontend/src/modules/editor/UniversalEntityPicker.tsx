import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppOverlayPortalTarget } from "../../app/AppModalPortal.js";
import { fetchSidebarPinTreeWithRequest } from "../../app/sidebarPinsApi.js";
import { buildSidebarPinTreeRows, type SidebarPinTreeRow } from "../../app/sidebarPinTree.js";
import type { SidebarPinTree } from "../../app/sidebarPins.js";
import { ActionItemIcon, ExplorerEntityIcon, ExplorerRowIcon, HeaderTriageIcon } from "../../icons/index.js";
import { ensureEmailMessageIngested } from "../communications/communicationsApi.js";
import { getEntityDetail } from "../entities/entitiesApi.js";
import {
  createMessageQuery,
  fetchCommunicationsStatus,
  type MessagePage,
} from "../communications/communicationsApi.js";
import {
  editorEntityTypeLabel,
  editorEntityActionItemColor,
  searchEditorEntityLinks,
  type EditorEntityLink,
  type EditorEntityLinkRequest,
  type EditorEntityType,
  type EditorSearchableEntityType,
} from "./editorEntityLinks.js";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_PANEL_BACKGROUND,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
} from "./NodeWorkspaceSurfaceShared.js";
import {
  UniversalPickerEmailPane,
  type UniversalPickerEmailPaneHandle,
  type UniversalPickerEmailSelection,
} from "./UniversalPickerEmailPane.js";
import { HuddleResourceIcon } from "../huddles/HuddleResourceIcon.js";

export type UniversalEntityPickerMode = "reference" | "link";
export type UniversalEntityPickerEntityType = EditorEntityType | "huddle_logic_gate";
export type UniversalEntityPickerCategory = "all" | UniversalEntityPickerEntityType;
export type UniversalEntityPickerAnchor = { left: number; top: number };
export type UniversalEntityPickerEntity = EditorEntityLink | {
  entityType: "huddle_logic_gate";
  entityID: string;
  label: string;
};
type UniversalEntityPickerChooseHandler = {
  bivarianceHack(entity: UniversalEntityPickerEntity, mode: UniversalEntityPickerMode): Promise<void>;
}["bivarianceHack"];

export type UniversalEntityPickerProps = {
  companyID: string;
  requestJSON: EditorEntityLinkRequest;
  sourceType?: EditorEntityType;
  sourceLabel?: string;
  linkTargetTypes: readonly UniversalEntityPickerEntityType[];
  initialMode?: UniversalEntityPickerMode;
  initialCategory?: UniversalEntityPickerCategory;
  lockMode?: boolean;
  anchor: UniversalEntityPickerAnchor;
  onChoose?: UniversalEntityPickerChooseHandler;
  onEntityDragStart?: (event: React.DragEvent<HTMLButtonElement>, entity: UniversalEntityPickerEntity) => void;
  onCancel: () => void;
};

type PickerRow =
  | { kind: "folder"; key: string; depth: number; label: string }
  | { kind: "entity"; key: string; depth: number; entity: UniversalEntityPickerEntity; pinned: boolean };

const ALL_ENTITY_TYPES: readonly EditorEntityType[] = ["node", "logic_gate", "project", "entity", "email_message"];
const PICKER_ENTITY_TYPES: readonly UniversalEntityPickerEntityType[] = [...ALL_ENTITY_TYPES, "huddle_logic_gate"];
const SEARCHABLE_ENTITY_TYPES: readonly EditorSearchableEntityType[] = ["node", "logic_gate", "project", "entity"];
const EMPTY_PIN_TREE: SidebarPinTree = { folders: [], pins: [] };

export function universalPickerShortcutCategory(value: string): UniversalEntityPickerEntityType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "n") return "node";
  if (normalized === "l") return "logic_gate";
  if (normalized === "a") return "project";
  if (normalized === "e") return "email_message";
  if (normalized === "h") return "huddle_logic_gate";
  return null;
}

export function universalPickerAllowedTypes(
  mode: UniversalEntityPickerMode,
  linkTargetTypes: readonly UniversalEntityPickerEntityType[],
  category: UniversalEntityPickerCategory,
): UniversalEntityPickerEntityType[] {
  const permitted = mode === "link"
    ? new Set(linkTargetTypes.filter((type) => type !== "entity"))
    : new Set<UniversalEntityPickerEntityType>(ALL_ENTITY_TYPES);
  const ordered = PICKER_ENTITY_TYPES.filter((type) => permitted.has(type));
  return category === "all" ? ordered : ordered.includes(category) ? [category] : [];
}

function pinRowToPickerRow(row: SidebarPinTreeRow, allowedTypes: readonly UniversalEntityPickerEntityType[]): PickerRow | null {
  if (row.entryType === "folder") return { kind: "folder", key: `folder:${row.folder.folderID}`, depth: row.depth, label: row.folder.name };
  if (row.pin.kind === "huddle_node" || !allowedTypes.includes(row.pin.kind)) return null;
  return {
    kind: "entity",
    key: `${row.pin.kind}:${row.pin.id}`,
    depth: row.depth,
    pinned: true,
    entity: { entityType: row.pin.kind, entityID: row.pin.id, label: row.pin.name },
  };
}

function pinnedRows(tree: SidebarPinTree, allowedTypes: readonly UniversalEntityPickerEntityType[]): PickerRow[] {
  const expanded = new Set(tree.folders.map((folder) => folder.folderID));
  const rows = buildSidebarPinTreeRows(tree, expanded)
    .map((row) => pinRowToPickerRow(row, allowedTypes))
    .filter((row): row is PickerRow => row !== null);
  return rows.filter((row, index) => {
    if (row.kind === "entity") return true;
    for (let cursor = index + 1; cursor < rows.length; cursor += 1) {
      const child = rows[cursor];
      if (!child || child.depth <= row.depth) break;
      if (child.kind === "entity") return true;
    }
    return false;
  });
}

function pickerPanelPosition(anchor: UniversalEntityPickerAnchor, emailActive: boolean): React.CSSProperties {
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const preferredWidth = emailActive ? 720 : 460;
  const preferredHeight = emailActive ? 650 : 470;
  const width = Math.min(preferredWidth, Math.max(300, viewportWidth - 24));
  const left = Math.max(12, Math.min(anchor.left, viewportWidth - width - 12));
  const top = anchor.top + preferredHeight <= viewportHeight - 12 ? anchor.top : Math.max(12, anchor.top - preferredHeight - 18);
  return { position: "fixed", left, top, width, maxHeight: Math.max(280, viewportHeight - 24) };
}

const categoryOptions: Array<{ type: UniversalEntityPickerEntityType; label: string }> = [
  { type: "node", label: "Nodes" },
  { type: "logic_gate", label: "Processes" },
  { type: "project", label: "Projects" },
  { type: "entity", label: "Entities" },
  { type: "email_message", label: "Emails" },
  { type: "huddle_logic_gate", label: "Huddle Boards" },
];

function pickerEntityTypeLabel(type: UniversalEntityPickerEntityType): string {
  return type === "huddle_logic_gate" ? "Huddle Board" : editorEntityTypeLabel(type);
}

export const UniversalEntityPicker: React.FC<UniversalEntityPickerProps> = (props) => {
  const portalTarget = useAppOverlayPortalTarget();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const emailPaneRef = useRef<UniversalPickerEmailPaneHandle | null>(null);
  const searchSequenceRef = useRef(0);
  const emailSearchSequenceRef = useRef(0);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<UniversalEntityPickerMode>(() => (
    props.initialMode === "link" && props.linkTargetTypes.length > 0 ? "link" : "reference"
  ));
  const [category, setCategory] = useState<UniversalEntityPickerCategory>(() => props.initialCategory ?? "all");
  const [pinTree, setPinTree] = useState<SidebarPinTree>(EMPTY_PIN_TREE);
  const [searchResults, setSearchResults] = useState<EditorEntityLink[]>([]);
  const [huddleLogicGates, setHuddleLogicGates] = useState<UniversalEntityPickerEntity[]>([]);
  const [huddleLoading, setHuddleLoading] = useState(false);
  const [emailSearchResults, setEmailSearchResults] = useState<EditorEntityLink[]>([]);
  const [emailAccountEmail, setEmailAccountEmail] = useState("");
  const [emailAccountResolved, setEmailAccountResolved] = useState(false);
  const [emailSearchLoading, setEmailSearchLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState("");
  const dragOnly = Boolean(props.onEntityDragStart && !props.onChoose);

  const allowedTypes = useMemo(
    () => universalPickerAllowedTypes(mode, props.linkTargetTypes, category),
    [category, mode, props.linkTargetTypes],
  );
  const visibleCategoryOptions = useMemo(
    () => props.linkTargetTypes.includes("huddle_logic_gate") ? categoryOptions : categoryOptions.filter((option) => option.type !== "huddle_logic_gate"),
    [props.linkTargetTypes],
  );
  const searchableAllowedTypes = useMemo(
    () => allowedTypes.filter((type): type is EditorSearchableEntityType => SEARCHABLE_ENTITY_TYPES.includes(type as EditorSearchableEntityType)),
    [allowedTypes],
  );
  const allPinnedRows = useMemo(() => pinnedRows(pinTree, allowedTypes), [allowedTypes, pinTree]);
  const visibleRows = useMemo(() => {
    const cleanQuery = query.trim().toLocaleLowerCase();
    const matchingPins = cleanQuery
      ? allPinnedRows.filter((row) => row.kind === "entity" && row.entity.label.toLocaleLowerCase().includes(cleanQuery))
      : allPinnedRows;
    const seen = new Set(matchingPins.map((row) => row.key));
    const searchableResults = cleanQuery
      ? [...searchResults, ...emailSearchResults]
      : category === "entity"
        ? searchResults
        : [];
    const visibleHuddles = huddleLogicGates.filter((entity) => !cleanQuery || entity.label.toLocaleLowerCase().includes(cleanQuery));
    return [...matchingPins, ...[...searchableResults, ...visibleHuddles].flatMap<PickerRow>((entity) => {
      const key = `${entity.entityType}:${entity.entityID}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ kind: "entity", key, depth: 0, entity, pinned: false }];
    })];
  }, [allPinnedRows, category, emailSearchResults, huddleLogicGates, query, searchResults]);
  const selectableRows = useMemo(
    () => visibleRows.filter((row): row is Extract<PickerRow, { kind: "entity" }> => row.kind === "entity"),
    [visibleRows],
  );

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchSidebarPinTreeWithRequest(props.requestJSON, props.companyID)
      .then((tree) => { if (!cancelled) setPinTree(tree); })
      .catch(() => { if (!cancelled) setPinTree(EMPTY_PIN_TREE); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [props.companyID, props.requestJSON]);

  useEffect(() => {
    if (!allowedTypes.includes("huddle_logic_gate")) {
      setHuddleLogicGates([]);
      setHuddleLoading(false);
      return;
    }
    let cancelled = false;
    setHuddleLoading(true);
    void props.requestJSON<{ huddle_logic_gates?: Array<{ huddle_logic_gate_id: string; header: string }> }>(`/v1/huddle-logic-gates?company_id=${encodeURIComponent(props.companyID)}`)
      .then((payload) => {
        if (cancelled) return;
        setHuddleLogicGates((payload.huddle_logic_gates ?? []).map((item) => ({
          entityType: "huddle_logic_gate",
          entityID: item.huddle_logic_gate_id,
          label: item.header,
        })));
      })
      .catch(() => { if (!cancelled) setHuddleLogicGates([]); })
      .finally(() => { if (!cancelled) setHuddleLoading(false); });
    return () => { cancelled = true; };
  }, [allowedTypes, props.companyID, props.requestJSON]);

  useEffect(() => {
    const cleanQuery = query.trim();
    const sequence = ++searchSequenceRef.current;
    const controller = new AbortController();
    setSelectedIndex(0);
    setError("");
    const listEntities = category === "entity" && searchableAllowedTypes.includes("entity");
    if ((!cleanQuery && !listEntities) || searchableAllowedTypes.length === 0 || category === "email_message") {
      setSearchResults([]);
      return () => controller.abort();
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchEditorEntityLinks({ companyID: props.companyID, requestJSON: props.requestJSON }, cleanQuery, 30, searchableAllowedTypes, controller.signal)
        .then((results) => { if (searchSequenceRef.current === sequence) setSearchResults(results); })
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          if (searchSequenceRef.current === sequence) setError(cause instanceof Error ? cause.message : "Unable to search resources");
        })
        .finally(() => { if (searchSequenceRef.current === sequence) setLoading(false); });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [category, props.companyID, props.requestJSON, query, searchableAllowedTypes]);

  const searchEmailInAll = category === "all" && allowedTypes.includes("email_message");

  useEffect(() => {
    if (!searchEmailInAll || emailAccountResolved) return undefined;
    let cancelled = false;
    void fetchCommunicationsStatus()
      .then((status) => {
        if (cancelled) return;
        const accountEmail = status.connected && status.status === "connected"
          ? status.connection?.account_email?.trim().toLowerCase() ?? ""
          : "";
        setEmailAccountEmail(accountEmail);
      })
      .catch(() => { if (!cancelled) setEmailAccountEmail(""); })
      .finally(() => { if (!cancelled) setEmailAccountResolved(true); });
    return () => { cancelled = true; };
  }, [emailAccountResolved, searchEmailInAll]);

  useEffect(() => {
    const cleanQuery = query.trim();
    const sequence = ++emailSearchSequenceRef.current;
    const controller = new AbortController();
    if (!searchEmailInAll || !cleanQuery || !emailAccountResolved || !emailAccountEmail) {
      setEmailSearchResults([]);
      setEmailSearchLoading(false);
      return () => controller.abort();
    }
    const timer = window.setTimeout(() => {
      setEmailSearchLoading(true);
      const path = `/v1/communications/messages${createMessageQuery({
        companyID: props.companyID,
        accountEmail: emailAccountEmail,
        mailbox: "all",
        limit: 10,
        q: cleanQuery,
      })}`;
      void props.requestJSON<MessagePage>(path, { signal: controller.signal })
        .then((page) => {
          if (controller.signal.aborted || emailSearchSequenceRef.current !== sequence) return;
          const seen = new Set<string>();
          setEmailSearchResults((page.messages ?? []).flatMap((message) => {
            const providerMessageID = message.id?.trim() ?? "";
            if (!providerMessageID || seen.has(providerMessageID)) return [];
            seen.add(providerMessageID);
            return [{
              entityType: "email_message" as const,
              entityID: message.email_message_id?.trim() || providerMessageID,
              label: message.subject?.trim() || "(no subject)",
              emailMessageID: message.email_message_id?.trim() || undefined,
              emailThreadID: message.email_thread_id?.trim() || undefined,
              emailAccountEmail,
              emailMessage: message,
            }];
          }));
        })
        .catch((cause) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          if (emailSearchSequenceRef.current === sequence) setEmailSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted && emailSearchSequenceRef.current === sequence) setEmailSearchLoading(false);
        });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [category, emailAccountEmail, emailAccountResolved, props.companyID, props.requestJSON, query, searchEmailInAll]);

  useEffect(() => {
    if (mode === "link" && category !== "all" && !props.linkTargetTypes.includes(category)) setCategory("all");
  }, [category, mode, props.linkTargetTypes]);

  const choose = async (entity: UniversalEntityPickerEntity) => {
    if (!props.onChoose || busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "link" && entity.entityType === "entity") throw new Error("Entities can be referenced with #, but cannot be linked with ##.");
      let selectedEntity: UniversalEntityPickerEntity = entity;
      if (entity.entityType === "entity" && entity.isActionItem === true) {
        const detail = await getEntityDetail(props.requestJSON, {
          companyID: props.companyID,
          entityID: entity.entityID,
        });
        const actionItemColor = editorEntityActionItemColor(detail);
        selectedEntity = {
          ...entity,
          isActionItem: true,
          ...(actionItemColor ? { actionItemColor } : {}),
        };
      } else if (entity.entityType === "email_message") {
        if (!entity.emailMessage) throw new Error("The selected email is no longer available. Search for it again.");
        let storedMessage = entity.emailMessage;
        if (!storedMessage.email_message_id?.trim() || !storedMessage.email_thread_id?.trim()) {
          storedMessage = await ensureEmailMessageIngested(storedMessage.id, {
            companyID: props.companyID,
            sharedInboxID: entity.emailSharedInboxID,
            accountEmail: entity.emailAccountEmail,
          });
        }
        const emailMessageID = storedMessage.email_message_id?.trim() ?? "";
        const emailThreadID = storedMessage.email_thread_id?.trim() ?? "";
        if (!emailMessageID || !emailThreadID) throw new Error("stored_email_reference_id_missing");
        const sharedInboxID = entity.emailSharedInboxID?.trim() || undefined;
        const accountEmail = sharedInboxID ? undefined : entity.emailAccountEmail?.trim().toLowerCase() || undefined;
        if (!sharedInboxID && !accountEmail) throw new Error("stored_email_reference_scope_missing");
        selectedEntity = {
          entityType: "email_message",
          entityID: emailMessageID,
          label: entity.label,
          emailMessageID,
          emailThreadID,
          ...(sharedInboxID
            ? { emailSharedInboxID: sharedInboxID }
            : { emailAccountEmail: accountEmail }),
          emailMessage: storedMessage,
        };
      }
      await props.onChoose(selectedEntity, mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete this action");
      setBusy(false);
      inputRef.current?.focus({ preventScroll: true });
    }
  };
  const chooseEmail = (selection: UniversalPickerEmailSelection) => {
    const { message, accountEmail } = selection;
    void choose({
      entityType: "email_message",
      entityID: message.email_message_id?.trim() || message.id,
      label: message.subject?.trim() || "(no subject)",
      emailMessageID: message.email_message_id?.trim() || undefined,
      emailThreadID: message.email_thread_id?.trim() || undefined,
      emailAccountEmail: accountEmail,
      emailMessage: message,
    });
  };
  const setPickerMode = (nextMode: UniversalEntityPickerMode) => {
	if (props.lockMode && nextMode !== mode) return;
    if (nextMode === "link" && props.linkTargetTypes.length === 0) return;
    setMode(nextMode);
    setCategory("all");
    setQuery("");
    setSearchResults([]);
    setEmailSearchResults([]);
  };
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { event.preventDefault(); props.onCancel(); return; }
    if (!props.lockMode && event.key === "#" && !query && mode === "reference" && props.linkTargetTypes.length > 0) {
      event.preventDefault();
      setPickerMode("link");
      return;
    }
    if (!props.lockMode && event.key === "Backspace" && !query && mode === "link") {
      event.preventDefault();
      setPickerMode("reference");
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      const shortcutCategory = universalPickerShortcutCategory(query);
      if (shortcutCategory && universalPickerAllowedTypes(mode, props.linkTargetTypes, shortcutCategory).length > 0) {
        event.preventDefault(); setCategory(shortcutCategory); setQuery(""); return;
      }
      if (props.onChoose && category === "email_message" && emailPaneRef.current?.chooseSelection()) {
        event.preventDefault();
        return;
      }
      const selected = selectableRows[selectedIndex];
      if (props.onChoose && selected) { event.preventDefault(); void choose(selected.entity); }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (category === "email_message") {
        emailPaneRef.current?.moveSelection(direction);
        return;
      }
      setSelectedIndex((current) => (current + direction + selectableRows.length) % Math.max(1, selectableRows.length));
      return;
    }
    if (event.key === "Enter") {
      if (props.onChoose && category === "email_message" && emailPaneRef.current?.chooseSelection()) {
        event.preventDefault();
        return;
      }
      const selected = selectableRows[selectedIndex];
      if (props.onChoose && selected) { event.preventDefault(); void choose(selected.entity); }
    }
  };

  if (!portalTarget) return null;
  return createPortal(
    <>
      <div
        aria-hidden="true"
        data-mango-universal-picker-dismiss-layer="true"
        onPointerDown={props.onCancel}
        style={{ position: "fixed", inset: 0, zIndex: 10069, background: "transparent", pointerEvents: dragActive ? "none" : "auto" }}
      />
      <div ref={rootRef} role="dialog" aria-label="Universal picker" data-mango-universal-picker="true" data-mango-universal-picker-mode={mode} data-mango-universal-picker-drag-active={dragActive ? "true" : "false"} style={{
        ...pickerPanelPosition(props.anchor, category === "email_message"), zIndex: 10070, display: "grid", gridTemplateRows: "auto auto minmax(120px,1fr) auto", overflow: "hidden",
        border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 18, background: EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW,
        color: "#172033", fontFamily: "inherit",
      }}>
      <div style={{ padding: "14px 14px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
          <strong style={{ fontSize: 13 }}>Universal picker</strong>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#64748b" }}>{props.sourceLabel?.trim() || (props.sourceType ? `${editorEntityTypeLabel(props.sourceType)} editor` : "Mango resource")}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", alignItems: "center", gap: 8, padding: "8px 11px", borderRadius: 13, background: EDITOR_NEU_ACTIVE_SURFACE, boxShadow: "inset 3px 3px 8px rgba(174,174,192,.18), inset -3px -3px 8px rgba(255,255,255,.92)" }}>
          <span aria-hidden="true" style={{ fontSize: 17, fontWeight: 900, color: mode === "link" ? "#7c3aed" : "#0891b2" }}>{mode === "link" ? "##" : "#"}</span>
          <input ref={inputRef} value={query} disabled={busy} aria-label={dragOnly ? "Search Processes to drag" : mode === "link" ? "Search resources to link" : "Search resources to reference"} placeholder={dragOnly ? "Search Processes to place…" : category === "email_message" ? "Search Inbox, Starred, Sent, All, or Spam…" : category === "entity" ? "Search Entities…" : mode === "link" ? "Search what to link…" : "Search pins or workspace…"} onChange={(event) => setQuery(event.target.value)} onKeyDown={onInputKeyDown} style={{ width: "100%", minWidth: 0, padding: 0, border: 0, outline: 0, background: "transparent", color: "#172033", font: "inherit", fontSize: 14 }} />
        </div>
      </div>
      <div data-mango-universal-picker-categories="true" style={{ width: "calc(100% - 28px)", maxWidth: 430, display: "grid", gridTemplateColumns: `repeat(${visibleCategoryOptions.length},minmax(0,1fr))`, gap: 6, margin: "0 auto 10px" }}>
        {visibleCategoryOptions.map((option) => {
          const enabled = mode === "reference" || (option.type !== "entity" && props.linkTargetTypes.includes(option.type));
          const active = category === option.type;
          return <button key={option.type} type="button" disabled={!enabled || busy} aria-pressed={active} onClick={() => { setCategory(props.lockMode ? option.type : active ? "all" : option.type); setQuery(""); }} style={{ width: "100%", minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 6px", border: active ? "1px solid rgba(8,145,178,.30)" : "1px solid rgba(255,255,255,.72)", borderRadius: 11, background: active ? "linear-gradient(145deg,#e8fbff,#f5efff)" : EDITOR_NEU_ACTIVE_SURFACE, boxShadow: active ? "inset 2px 2px 5px rgba(174,174,192,.18)" : EDITOR_NEU_SHADOW, color: enabled ? "#263247" : "#94a3b8", cursor: enabled ? "pointer" : "not-allowed", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>{option.type === "email_message" ? <HeaderTriageIcon color={enabled ? "#0ea5e9" : "#94a3b8"} /> : option.type === "huddle_logic_gate" ? <HuddleResourceIcon type="huddle_logic_gate" /> : <ExplorerRowIcon kind={option.type} />}{option.label}</button>;
        })}
      </div>
      {category === "email_message" ? (
        <UniversalPickerEmailPane ref={emailPaneRef} active busy={busy} companyID={props.companyID} query={query} requestJSON={props.requestJSON} onChoose={chooseEmail} />
      ) : <div role="listbox" aria-label={query.trim() || category === "entity" ? "Resource search results" : "Pinned resources"} style={{ minHeight: 150, maxHeight: 310, overflowY: "auto", padding: "3px 9px 10px" }}>
        <div style={{ padding: "2px 7px 7px", fontSize: 10, fontWeight: 900, letterSpacing: .7, textTransform: "uppercase", color: "#64748b" }}>{query.trim() || category === "entity" ? "Results" : "Pinned"}</div>
        {visibleRows.map((row) => {
          if (row.kind === "folder") return <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px 4px", paddingLeft: 8 + row.depth * 14, color: "#64748b", fontSize: 11, fontWeight: 900 }}><ExplorerRowIcon kind="folder" />{row.label}</div>;
          const index = selectableRows.findIndex((item) => item.key === row.key);
          const active = index === selectedIndex;
          const actionItem = row.entity.entityType === "entity" && row.entity.isActionItem === true;
          return <button key={row.key} type="button" role="option" aria-selected={active} disabled={busy} draggable={Boolean(props.onEntityDragStart) && !busy} onMouseEnter={() => setSelectedIndex(index)} onClick={() => props.onChoose ? void choose(row.entity) : setSelectedIndex(index)} onDragStart={(event) => { if (!props.onEntityDragStart) return; props.onEntityDragStart(event, row.entity); setDragActive(true); }} onDragEnd={() => setDragActive(false)} style={{ width: "100%", display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", alignItems: "center", gap: 9, padding: "9px 10px", paddingLeft: 10 + row.depth * 14, border: active ? "1px solid rgba(8,145,178,.24)" : "1px solid transparent", borderRadius: 11, background: active ? "linear-gradient(145deg,rgba(232,251,255,.94),rgba(245,239,255,.92))" : "transparent", color: "#172033", cursor: busy ? "wait" : props.onEntityDragStart ? "grab" : "pointer", textAlign: "left" }}>{row.entity.entityType === "huddle_logic_gate" ? <HuddleResourceIcon type="huddle_logic_gate" /> : actionItem ? <ActionItemIcon size={15} /> : <ExplorerEntityIcon kind={row.entity.entityType} />}<span style={{ minWidth: 0 }}><span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 800 }}>{row.entity.label}</span><span style={{ display: "block", marginTop: 1, color: "#64748b", fontSize: 10 }}>{actionItem ? "Action Item" : pickerEntityTypeLabel(row.entity.entityType)}</span></span>{row.pinned && <span aria-label="Pinned" title="Pinned" style={{ color: "#f59e0b", fontSize: 12 }}>◆</span>}</button>;
        })}
        {!loading && !emailSearchLoading && visibleRows.length === 0 && <div style={{ padding: "28px 14px", textAlign: "center", color: "#64748b", fontSize: 12 }}>{query.trim() || category === "entity" ? "No matching resources." : "Your Pinned section is empty."}</div>}
        {(loading || emailSearchLoading || huddleLoading) && <div style={{ padding: 12, color: "#64748b", fontSize: 11 }}>Loading…</div>}
      </div>}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 42, padding: "8px 14px", borderTop: "1px solid rgba(255,255,255,.72)", color: "#64748b", fontSize: 10 }}>
        {props.linkTargetTypes.length > 0 && !props.lockMode ? <button type="button" disabled={busy} onClick={() => setPickerMode(mode === "reference" ? "link" : "reference")} style={{ padding: "5px 8px", border: 0, borderRadius: 8, background: mode === "link" ? "rgba(124,58,237,.12)" : "rgba(8,145,178,.10)", color: mode === "link" ? "#6d28d9" : "#0e7490", cursor: "pointer", fontSize: 10, fontWeight: 900 }}>{mode === "link" ? "## Link" : "# Reference"}</button> : <span>{mode === "link" ? "## Link" : "# Reference"}</span>}
        <span>{dragOnly ? `${props.linkTargetTypes.map(pickerEntityTypeLabel).join(", ")} only · Drag a result onto the map · Esc close` : `${props.lockMode ? `${props.linkTargetTypes.map(pickerEntityTypeLabel).join(", ")} only` : mode === "link" ? "Backspace for # reference" : "# for ## link"} · ↑↓ choose · Enter/Tab select · Esc close`}</span>
        {error && <span role="alert" style={{ marginLeft: "auto", color: "#b91c1c", fontWeight: 800 }}>{error}</span>}
      </div>
      </div>
    </>, portalTarget,
  );
};
