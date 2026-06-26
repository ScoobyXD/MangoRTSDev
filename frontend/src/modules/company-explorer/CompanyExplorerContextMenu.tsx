import React from "react";
import { confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { hoverHandlers, menuBtnBase } from "../../app/frameLayoutTypes";
import type { CompanyExplorerFolderKind, CompanyExplorerFolderScopeType } from "../folders/companyExplorerFolders";
import type {
  CompanyExplorerContextMenuState,
  CompanyExplorerFolderPermissionsTarget,
  CompanyExplorerOpenInNewTabTarget,
  CompanyExplorerPinTarget,
  ExplorerDeleteTargetWithLabel,
  ExplorerRenameTarget,
} from "./companyExplorerTypes";
import { buildCompanyExplorerContextMenuSections, type CompanyExplorerContextMenuAction } from "./CompanyExplorerContentModel";

type CompanyExplorerContextMenuProps = {
  menu: CompanyExplorerContextMenuState | null;
  onClose: () => void;
  onCreateFolder: (folderKind: CompanyExplorerFolderKind, parentFolderID: string, position?: number, scopeType?: CompanyExplorerFolderScopeType, scopeID?: string) => void;
  onCreateLogicGate: (parentFolderID: string, position?: number, GVICRole?: string) => void;
  onCreateProject: (parentFolderID: string, position?: number) => void;
  onOpenFolderPermissions: (target: CompanyExplorerFolderPermissionsTarget) => void;
  onOpenInNewTab: (target: CompanyExplorerOpenInNewTabTarget) => void;
  onPinTarget: (target: CompanyExplorerPinTarget) => void;
  onRenameTarget: (treeID: string, target: ExplorerRenameTarget, value: string) => void;
  onDeleteTargets: (targets: ExplorerDeleteTargetWithLabel[], position?: ConfirmActionMenuPosition) => void;
};

export const CompanyExplorerContextMenu: React.FC<CompanyExplorerContextMenuProps> = ({
  menu,
  onClose,
  onCreateFolder,
  onCreateLogicGate,
  onCreateProject,
  onOpenFolderPermissions,
  onOpenInNewTab,
  onPinTarget,
  onRenameTarget,
  onDeleteTargets,
}) => {
  if (!menu) return null;
  const hasDeleteAction = menu.deleteTargets.length > 0 || Boolean(menu.deleteTarget);
  const menuSections = buildCompanyExplorerContextMenuSections({
    openInNewTabEnabled: Boolean(menu.openInNewTabTarget),
    pinEnabled: Boolean(menu.pinTarget),
    permissionsEnabled: Boolean(menu.permissionsTarget),
    createFolderEnabled: menu.canCreateFolder,
    createLogicGateEnabled: menu.canCreateLogicGate,
    createProjectEnabled: menu.canCreateProject,
    renameEnabled: Boolean(menu.renameTarget && menu.renameTreeID),
    deleteEnabled: hasDeleteAction,
  });
  const disabledButtonStyle: React.CSSProperties = {
    color: "#94a3b8",
    cursor: "default",
    opacity: 0.72,
  };
  const menuItemEvents = (enabled: boolean, onEnter?: () => void): React.ButtonHTMLAttributes<HTMLButtonElement> => (
    enabled
      ? {
        onMouseEnter: (event) => {
          onEnter?.();
          hoverHandlers.onMouseEnter(event);
        },
        onMouseLeave: hoverHandlers.onMouseLeave,
        onFocus: () => onEnter?.(),
      }
      : {}
  );
  const menuButtonStyle = (enabled: boolean, extra?: React.CSSProperties): React.CSSProperties => ({
    ...menuBtnBase,
    ...(enabled ? {} : disabledButtonStyle),
    ...extra,
  });
  const dividerStyle: React.CSSProperties = {
    height: 1,
    margin: "4px 8px",
    background: "rgba(148, 163, 184, 0.28)",
  };
  const renderMenuAction = (action: CompanyExplorerContextMenuAction): React.ReactElement => {
    if (action.id === "open_in_new_tab") {
      return (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          style={menuButtonStyle(action.enabled)}
          {...menuItemEvents(action.enabled)}
          onClick={() => {
            if (!menu.openInNewTabTarget) return;
            onOpenInNewTab(menu.openInNewTabTarget);
          }}
        >
          {action.label}
        </button>
      );
    }
    if (action.id === "pin") {
      return (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          style={menuButtonStyle(action.enabled)}
          {...menuItemEvents(action.enabled)}
          onClick={() => {
            if (!menu.pinTarget) return;
            onPinTarget(menu.pinTarget);
          }}
        >
          {action.label}
        </button>
      );
    }
    if (action.id === "folder_permissions") {
      return (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          style={menuButtonStyle(action.enabled)}
          {...menuItemEvents(action.enabled)}
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
          style={menuButtonStyle(action.enabled)}
          {...menuItemEvents(action.enabled)}
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
          style={menuButtonStyle(action.enabled)}
          {...menuItemEvents(action.enabled)}
          onClick={() => {
            if (!menu.canCreateLogicGate) return;
            onCreateLogicGate(menu.targets.logicGateParentFolderID, menu.createPosition, menu.createLogicGateGVICRole);
          }}
        >
          {action.label}
        </button>
      );
    }
    if (action.id === "create_project") {
      return (
        <button
          key={action.id}
          type="button"
          disabled={!action.enabled}
          style={menuButtonStyle(action.enabled)}
          {...menuItemEvents(action.enabled)}
          onClick={() => {
            if (!menu.canCreateProject) return;
            onCreateProject(menu.targets.projectParentFolderID, menu.createPosition);
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
          style={menuButtonStyle(action.enabled)}
          {...menuItemEvents(action.enabled)}
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
          { color: action.enabled ? "#dc2626" : disabledButtonStyle.color },
        )}
        {...menuItemEvents(action.enabled)}
        onClick={(event) => {
          if (!hasDeleteAction) return;
          onDeleteTargets(menu.deleteTargets.length > 0 ? menu.deleteTargets : [menu.deleteTarget!], confirmMenuPositionFromElement(event.currentTarget));
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
