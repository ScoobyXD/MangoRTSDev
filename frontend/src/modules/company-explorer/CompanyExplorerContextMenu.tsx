import type React from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import type { CompanyExplorerFolderKind } from "../folders/companyExplorerFolders";
import type {
  CompanyExplorerContextMenuState,
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
  onCreateFolder: (folderKind: CompanyExplorerFolderKind, parentFolderID: string, position?: number) => void;
  onCreateNode: (parentFolderID: string, position?: number) => void;
  onCreateLogicGate: (parentFolderID: string, position?: number) => void;
  onFindTarget: (target: ExplorerFindTarget) => void;
  onPinTarget: (target: ExplorerPinTarget) => void;
  onShareFolder: (target: CompanyExplorerShareTarget) => void;
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
  onRenameTarget,
  onDeleteTargets,
}) => {
  if (!menu) return null;
  const hasCreateAction = menu.canCreateFolder || menu.canCreateNode || menu.canCreateLogicGate;
  const hasDeleteAction = menu.deleteTargets.length > 0 || Boolean(menu.deleteTarget);
  if (!hasCreateAction && !menu.findTarget && !menu.pinTarget && !menu.shareTarget && !menu.renameTarget && !hasDeleteAction) return null;

  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose}>
      {menu.canCreateBothFolderTypes ? (
        <>
          {menu.canCreateFolder && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateFolder(menu.targets.preferredFolderKind, menu.targets.preferredFolderParentID, menu.createPosition)}>
              Create New Folder
            </button>
          )}
          {menu.canCreateNode && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateNode(menu.targets.nodeParentFolderID, menu.createPosition)}>
              Create Node
            </button>
          )}
          {menu.canCreateLogicGate && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateLogicGate(menu.targets.logicGateParentFolderID, menu.createPosition)}>
              Create Logic Gate
            </button>
          )}
        </>
      ) : (
        <>
          {menu.canCreateFolder && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateFolder(menu.targets.preferredFolderKind, menu.targets.preferredFolderParentID, menu.createPosition)}>
              Create New Folder
            </button>
          )}
          {menu.canCreateNode && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateNode(menu.targets.nodeParentFolderID, menu.createPosition)}>
              Create Node
            </button>
          )}
          {menu.canCreateLogicGate && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateLogicGate(menu.targets.logicGateParentFolderID, menu.createPosition)}>
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
        <button style={{ ...buttonStyle, color: "#c62828" }} onClick={() => onDeleteTargets(menu.deleteTargets.length > 0 ? menu.deleteTargets : [menu.deleteTarget!])}>
          Delete
        </button>
      )}
    </FrameRightClickMenu>
  );
};
