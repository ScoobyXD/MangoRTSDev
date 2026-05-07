import type React from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import type { CompanyExplorerFolderKind } from "../folders/companyExplorerFolders";
import type {
  CompanyExplorerContextMenuState,
  ExplorerDeleteTarget,
  ExplorerFindTarget,
  ExplorerRenameTarget,
} from "./companyExplorerTypes";

type CompanyExplorerContextMenuProps = {
  menu: CompanyExplorerContextMenuState | null;
  buttonStyle: React.CSSProperties;
  onClose: () => void;
  onCreateFolder: (folderKind: CompanyExplorerFolderKind, parentFolderID: string, position?: number) => void;
  onCreateNode: (parentFolderID: string) => void;
  onCreateLogicGate: (parentFolderID: string) => void;
  onFindTarget: (target: ExplorerFindTarget) => void;
  onRenameTarget: (treeID: string, target: ExplorerRenameTarget, value: string) => void;
  onDeleteTargets: (targets: ExplorerDeleteTarget[]) => void;
};

export const CompanyExplorerContextMenu: React.FC<CompanyExplorerContextMenuProps> = ({
  menu,
  buttonStyle,
  onClose,
  onCreateFolder,
  onCreateNode,
  onCreateLogicGate,
  onFindTarget,
  onRenameTarget,
  onDeleteTargets,
}) => {
  if (!menu) return null;

  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose}>
      {menu.canCreateBothFolderTypes ? (
        <>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateFolder(menu.targets.preferredFolderKind, menu.targets.preferredFolderParentID, menu.createFolderPosition)}>
            Create New Folder
          </button>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateNode(menu.targets.nodeParentFolderID)}>
            Create Node
          </button>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateLogicGate(menu.targets.logicGateParentFolderID)}>
            Create Logic Gate
          </button>
        </>
      ) : (
        <>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateFolder(menu.targets.preferredFolderKind, menu.targets.preferredFolderParentID, menu.createFolderPosition)}>
            Create New Folder
          </button>
          {menu.contextKind !== "logic_gate" && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateNode(menu.targets.nodeParentFolderID)}>
              Create Node
            </button>
          )}
          {menu.contextKind !== "node" && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateLogicGate(menu.targets.logicGateParentFolderID)}>
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
