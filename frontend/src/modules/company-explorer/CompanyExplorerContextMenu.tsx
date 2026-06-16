import React, { useEffect, useState } from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import type { CompanyExplorerFolderKind, CompanyExplorerFolderScopeType } from "../folders/companyExplorerFolders";
import { KANBAN_NODE_PRIORITY_STYLE_OPTIONS } from "../kanban/shared";
import type {
  CompanyExplorerContextMenuState,
  CompanyExplorerFolderPermissionsTarget,
  ExplorerDeleteTargetWithLabel,
  ExplorerRenameTarget,
} from "./companyExplorerTypes";
import { buildCompanyExplorerContextMenuSections, type CompanyExplorerContextMenuAction } from "./CompanyExplorerContentModel";

type CompanyExplorerContextMenuProps = {
  menu: CompanyExplorerContextMenuState | null;
  buttonStyle: React.CSSProperties;
  onClose: () => void;
  onCreateFolder: (folderKind: CompanyExplorerFolderKind, parentFolderID: string, position?: number, scopeType?: CompanyExplorerFolderScopeType, scopeID?: string) => void;
  onCreateNode: (parentFolderID: string, position?: number, logicGateID?: string, logicGateTreeID?: string, priority?: number) => void;
  onCreateLogicGate: (parentFolderID: string, position?: number, raciRole?: string) => void;
  onOpenFolderPermissions: (target: CompanyExplorerFolderPermissionsTarget) => void;
  onRenameTarget: (treeID: string, target: ExplorerRenameTarget, value: string) => void;
  onDeleteTargets: (targets: ExplorerDeleteTargetWithLabel[]) => void;
};

export const CompanyExplorerContextMenu: React.FC<CompanyExplorerContextMenuProps> = ({
  menu,
  buttonStyle,
  onClose,
  onCreateFolder,
  onCreateNode,
  onCreateLogicGate,
  onOpenFolderPermissions,
  onRenameTarget,
  onDeleteTargets,
}) => {
  const [prioritySubmenuOpen, setPrioritySubmenuOpen] = useState(false);
  const [hoveredActionID, setHoveredActionID] = useState("");
  const [hoveredPriorityValue, setHoveredPriorityValue] = useState("");
  useEffect(() => {
    setPrioritySubmenuOpen(false);
    setHoveredActionID("");
    setHoveredPriorityValue("");
  }, [menu]);
  if (!menu) return null;
  const hasDeleteAction = menu.deleteTargets.length > 0 || Boolean(menu.deleteTarget);
  const createNodeNeedsPriority = menu.canCreateNode && Boolean(menu.createNodeLogicGateID);
  const priorityOptions = KANBAN_NODE_PRIORITY_STYLE_OPTIONS.filter((option) => option.value !== "0");
  const menuSections = buildCompanyExplorerContextMenuSections({
    permissionsEnabled: Boolean(menu.permissionsTarget),
    createFolderEnabled: menu.canCreateFolder,
    createNodeEnabled: menu.canCreateNode,
    createLogicGateEnabled: menu.canCreateLogicGate,
    renameEnabled: Boolean(menu.renameTarget && menu.renameTreeID),
    deleteEnabled: hasDeleteAction,
  });
  const disabledButtonStyle: React.CSSProperties = {
    color: "#94a3b8",
    cursor: "default",
    opacity: 0.72,
  };
  const enabledButtonStyle: React.CSSProperties = { color: "#111827" };
  const highlightedMenuBackground = "linear-gradient(100deg, rgba(103, 232, 249, 0.2), rgba(216, 180, 254, 0.32))";
  const menuItemEvents = (id: string, enabled: boolean, onEnter?: () => void) => ({
    onMouseEnter: () => {
      if (!enabled) return;
      setHoveredActionID(id);
      onEnter?.();
    },
    onMouseLeave: () => {
      setHoveredActionID((current) => (current === id ? "" : current));
    },
    onFocus: () => {
      if (!enabled) return;
      setHoveredActionID(id);
      onEnter?.();
    },
    onBlur: () => {
      setHoveredActionID((current) => (current === id ? "" : current));
    },
  });
  const menuButtonStyle = (enabled: boolean, extra?: React.CSSProperties, active = false): React.CSSProperties => ({
    ...buttonStyle,
    width: "calc(100% - 12px)",
    minHeight: 31,
    padding: "0 12px",
    margin: "0 6px",
    borderRadius: 9,
    font: "inherit",
    fontSize: 12,
    fontWeight: 600,
    background: enabled && active ? highlightedMenuBackground : "transparent",
    boxShadow: enabled && active ? "inset 0 0 0 1px rgba(168, 85, 247, 0.13)" : undefined,
    ...(enabled ? enabledButtonStyle : disabledButtonStyle),
    ...extra,
  });
  const dividerStyle: React.CSSProperties = {
    height: 1,
    margin: "4px 8px",
    background: "rgba(148, 163, 184, 0.28)",
  };
  const createNodeButton = (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        disabled={!menu.canCreateNode}
        style={menuButtonStyle(menu.canCreateNode, undefined, hoveredActionID === "create_node" || prioritySubmenuOpen)}
        {...menuItemEvents("create_node", menu.canCreateNode, () => {
          if (createNodeNeedsPriority) {
            setPrioritySubmenuOpen(true);
          }
        })}
        onClick={() => {
          if (!menu.canCreateNode) return;
          if (createNodeNeedsPriority) {
            setPrioritySubmenuOpen(true);
            return;
          }
          onCreateNode(menu.targets.nodeParentFolderID, menu.createPosition, menu.createNodeLogicGateID, menu.createNodeLogicGateTreeID);
        }}
      >
        Create Node
      </button>
      {createNodeNeedsPriority && prioritySubmenuOpen && (
        <div
          role="menu"
          aria-label="Node priority"
          style={{
            position: "absolute",
            top: 0,
            left: "calc(100% + 6px)",
            minWidth: 214,
            padding: "5px 0",
            borderRadius: 14,
            background: "linear-gradient(145deg, rgba(255,255,255,0.76), rgba(245,248,252,0.58))",
            border: "1px solid rgba(255,255,255,0.66)",
            boxShadow: "0 18px 44px rgba(15, 23, 42, 0.18), inset 1px 1px 0 rgba(255,255,255,0.72), inset -1px -1px 0 rgba(148,163,184,0.12)",
            backdropFilter: "blur(18px) saturate(1.3)",
            WebkitBackdropFilter: "blur(18px) saturate(1.3)",
            overflow: "hidden",
          }}
        >
          {priorityOptions.map((option) => {
            const priority = Number(option.value);
            return (
              <button
                key={option.value}
                type="button"
                style={menuButtonStyle(
                  true,
                  {
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  },
                  hoveredPriorityValue === option.value,
                )}
                onMouseEnter={() => setHoveredPriorityValue(option.value)}
                onMouseLeave={() => {
                  setHoveredPriorityValue((current) => (current === option.value ? "" : current));
                }}
                onFocus={() => setHoveredPriorityValue(option.value)}
                onBlur={() => {
                  setHoveredPriorityValue((current) => (current === option.value ? "" : current));
                }}
                onClick={() => onCreateNode(menu.targets.nodeParentFolderID, menu.createPosition, menu.createNodeLogicGateID, menu.createNodeLogicGateTreeID, priority)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
  const renderMenuAction = (action: CompanyExplorerContextMenuAction): React.ReactElement => {
    if (action.id === "create_node") return <React.Fragment key={action.id}>{createNodeButton}</React.Fragment>;
    if (action.id === "folder_permissions") {
      return (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          style={menuButtonStyle(action.enabled, undefined, hoveredActionID === action.id)}
          {...menuItemEvents(action.id, action.enabled, () => setPrioritySubmenuOpen(false))}
          onClick={() => {
            if (!menu.permissionsTarget) return;
            onOpenFolderPermissions(menu.permissionsTarget);
          }}
        >
          {action.label}
        </button>
      );
    }
    if (action.id === "create_folder") {
      return (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          style={menuButtonStyle(action.enabled, undefined, hoveredActionID === action.id)}
          {...menuItemEvents(action.id, action.enabled, () => setPrioritySubmenuOpen(false))}
          onClick={() => {
            if (!menu.canCreateFolder) return;
            onCreateFolder(menu.targets.preferredFolderKind, menu.targets.preferredFolderParentID, menu.createPosition, menu.createFolderScopeType ?? menu.targets.folderScopeType, menu.createFolderScopeID ?? menu.targets.folderScopeID);
          }}
        >
          {action.label}
        </button>
      );
    }
    if (action.id === "create_logic_gate") {
      return (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          style={menuButtonStyle(action.enabled, undefined, hoveredActionID === action.id)}
          {...menuItemEvents(action.id, action.enabled, () => setPrioritySubmenuOpen(false))}
          onClick={() => {
            if (!menu.canCreateLogicGate) return;
            onCreateLogicGate(menu.targets.logicGateParentFolderID, menu.createPosition, menu.createLogicGateRaciRole);
          }}
        >
          {action.label}
        </button>
      );
    }
    if (action.id === "rename") {
      return (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          style={menuButtonStyle(action.enabled, undefined, hoveredActionID === action.id)}
          {...menuItemEvents(action.id, action.enabled, () => setPrioritySubmenuOpen(false))}
          onClick={() => {
            if (!menu.renameTarget || !menu.renameTreeID) return;
            onRenameTarget(menu.renameTreeID, menu.renameTarget, menu.renameLabel);
          }}
        >
          {action.label}
        </button>
      );
    }
    return (
      <button
        key={action.id}
        type="button"
        disabled={!action.enabled}
        style={menuButtonStyle(
          action.enabled,
          { color: action.enabled ? "#334155" : disabledButtonStyle.color },
          hoveredActionID === action.id,
        )}
        {...menuItemEvents(action.id, action.enabled, () => setPrioritySubmenuOpen(false))}
        onClick={() => {
          if (!hasDeleteAction) return;
          onDeleteTargets(menu.deleteTargets.length > 0 ? menu.deleteTargets : [menu.deleteTarget!]);
        }}
      >
        {action.label}
      </button>
    );
  };

  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose} overflow="visible">
      {menuSections.map((section, index) => (
        <React.Fragment key={section.map((action) => action.id).join(":")}>
          {index > 0 ? <div aria-hidden="true" style={dividerStyle} /> : null}
          {section.map(renderMenuAction)}
        </React.Fragment>
      ))}
    </FrameRightClickMenu>
  );
};
