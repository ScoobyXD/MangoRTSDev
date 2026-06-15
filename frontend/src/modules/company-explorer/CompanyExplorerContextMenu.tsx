import React, { useEffect, useState } from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import type { CompanyExplorerFolderKind, CompanyExplorerFolderScopeType } from "../folders/companyExplorerFolders";
import { KANBAN_NODE_PRIORITY_STYLE_OPTIONS } from "../kanban/shared";
import type {
  CompanyExplorerContextMenuState,
  CompanyExplorerFolderPermissionsTarget,
  CompanyExplorerShareTarget,
  ExplorerDeleteTargetWithLabel,
  ExplorerFindTarget,
  ExplorerPinTarget,
  ExplorerRenameTarget,
} from "./companyExplorerTypes";

type CompanyExplorerContextMenuProps = {
  menu: CompanyExplorerContextMenuState | null;
  buttonStyle: React.CSSProperties;
  onClose: () => void;
  onCreateFolder: (folderKind: CompanyExplorerFolderKind, parentFolderID: string, position?: number, scopeType?: CompanyExplorerFolderScopeType, scopeID?: string) => void;
  onCreateNode: (parentFolderID: string, position?: number, logicGateID?: string, logicGateTreeID?: string, priority?: number) => void;
  onCreateLogicGate: (parentFolderID: string, position?: number, raciRole?: string) => void;
  onFindTarget: (target: ExplorerFindTarget) => void;
  onPinTarget: (target: ExplorerPinTarget) => void;
  onShareFolder: (target: CompanyExplorerShareTarget) => void;
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
  onFindTarget,
  onPinTarget,
  onShareFolder,
  onOpenFolderPermissions,
  onRenameTarget,
  onDeleteTargets,
}) => {
  const [prioritySubmenuOpen, setPrioritySubmenuOpen] = useState(false);
  useEffect(() => {
    setPrioritySubmenuOpen(false);
  }, [menu]);
  if (!menu) return null;
  const hasCreateAction = menu.canCreateFolder || menu.canCreateNode || menu.canCreateLogicGate;
  const hasDeleteAction = menu.deleteTargets.length > 0 || Boolean(menu.deleteTarget);
  if (!hasCreateAction && !menu.findTarget && !menu.pinTarget && !menu.shareTarget && !menu.permissionsTarget && !menu.renameTarget && !hasDeleteAction) return null;
  const createNodeNeedsPriority = menu.canCreateNode && Boolean(menu.createNodeLogicGateID);
  const priorityOptions = KANBAN_NODE_PRIORITY_STYLE_OPTIONS.filter((option) => option.value !== "0");
  const submenuSide = menu.x + 420 > window.innerWidth ? "left" : "right";
  const createNodeButton = (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => {
        if (createNodeNeedsPriority) setPrioritySubmenuOpen(true);
      }}
    >
      <button
        type="button"
        style={{ ...buttonStyle, color: "#111111", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18 }}
        onClick={() => {
          if (createNodeNeedsPriority) {
            setPrioritySubmenuOpen(true);
            return;
          }
          onCreateNode(menu.targets.nodeParentFolderID, menu.createPosition, menu.createNodeLogicGateID, menu.createNodeLogicGateTreeID);
        }}
      >
        <span>Create Node</span>
        {createNodeNeedsPriority ? <span aria-hidden="true" style={{ color: "#64748b" }}>{submenuSide === "right" ? ">" : "<"}</span> : null}
      </button>
      {createNodeNeedsPriority && prioritySubmenuOpen && (
        <div
          role="menu"
          aria-label="Node priority"
          style={{
            position: "absolute",
            top: -5,
            left: submenuSide === "right" ? "calc(100% + 6px)" : undefined,
            right: submenuSide === "left" ? "calc(100% + 6px)" : undefined,
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
                style={{
                  ...buttonStyle,
                  color: option.color,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                onClick={() => onCreateNode(menu.targets.nodeParentFolderID, menu.createPosition, menu.createNodeLogicGateID, menu.createNodeLogicGateTreeID, priority)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: option.color,
                    boxShadow: `0 0 0 3px ${option.glow}`,
                    flex: "0 0 auto",
                  }}
                />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose} overflow="visible">
      {menu.canCreateBothFolderTypes ? (
        <>
          {menu.canCreateFolder && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateFolder(menu.targets.preferredFolderKind, menu.targets.preferredFolderParentID, menu.createPosition, menu.createFolderScopeType ?? menu.targets.folderScopeType, menu.createFolderScopeID ?? menu.targets.folderScopeID)}>
              Create New Folder
            </button>
          )}
          {menu.canCreateNode && (
            createNodeButton
          )}
          {menu.canCreateLogicGate && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateLogicGate(menu.targets.logicGateParentFolderID, menu.createPosition, menu.createLogicGateRaciRole)}>
              Create Logic Gate
            </button>
          )}
        </>
      ) : (
        <>
          {menu.canCreateFolder && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateFolder(menu.targets.preferredFolderKind, menu.targets.preferredFolderParentID, menu.createPosition, menu.createFolderScopeType ?? menu.targets.folderScopeType, menu.createFolderScopeID ?? menu.targets.folderScopeID)}>
              Create New Folder
            </button>
          )}
          {menu.canCreateNode && (
            createNodeButton
          )}
          {menu.canCreateLogicGate && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateLogicGate(menu.targets.logicGateParentFolderID, menu.createPosition, menu.createLogicGateRaciRole)}>
              Create Logic Gate
            </button>
          )}
        </>
      )}
      {menu.findTarget && (
        <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onFindTarget(menu.findTarget!)}>
          {menu.findTarget.kind === "logic_gate" ? "Find Logic Gate" : "Find Node"}
        </button>
      )}
      {menu.pinTarget && (
        <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onPinTarget(menu.pinTarget!)}>
          {menu.pinTarget.kind === "logic_gate" ? "Pin Logic Gate" : "Pin Node"}
        </button>
      )}
      {menu.shareTarget && (
        <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onShareFolder(menu.shareTarget!)}>
          Share Folder
        </button>
      )}
      {menu.permissionsTarget && (
        <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onOpenFolderPermissions(menu.permissionsTarget!)}>
          Folder Permissions
        </button>
      )}
      {menu.renameTarget && (
        <button
          style={{ ...buttonStyle, color: "#111111" }}
          onClick={() => {
            if (!menu.renameTarget || !menu.renameTreeID) return;
            onRenameTarget(menu.renameTreeID, menu.renameTarget, menu.renameLabel);
          }}
        >
          Rename
        </button>
      )}
      {(menu.deleteTargets.length > 0 || menu.deleteTarget) && (
        <button style={{ ...buttonStyle, color: "#334155" }} onClick={() => onDeleteTargets(menu.deleteTargets.length > 0 ? menu.deleteTargets : [menu.deleteTarget!])}>
          Delete
        </button>
      )}
    </FrameRightClickMenu>
  );
};
