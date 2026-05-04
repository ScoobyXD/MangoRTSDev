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
  onCreateFolder: (folderKind: CompanyExplorerFolderKind, parentFolderID: string) => void;
  onCreateNode: (parentFolderID: string) => void;
  onCreateLogicGate: (parentFolderID: string) => void;
  onCreateKanban: (parentFolderID: string) => void;
  onFindTarget: (target: ExplorerFindTarget) => void;
  onRenameTarget: (treeID: string, target: ExplorerRenameTarget, value: string) => void;
  onDeleteTarget: (target: ExplorerDeleteTarget) => void;
};

export const CompanyExplorerContextMenu: React.FC<CompanyExplorerContextMenuProps> = ({
  menu,
  buttonStyle,
  onClose,
  onCreateFolder,
  onCreateNode,
  onCreateLogicGate,
  onCreateKanban,
  onFindTarget,
  onRenameTarget,
  onDeleteTarget,
}) => {
  if (!menu) return null;

  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose}>
      {menu.canCreateBothFolderTypes ? (
        <>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateFolder("node", menu.targets.nodeFolderParentID)}>
            Create node folder
          </button>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateNode(menu.targets.nodeParentFolderID)}>
            Create node
          </button>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateFolder("logic_gate", menu.targets.logicGateFolderParentID)}>
            Create logic gate folder
          </button>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateLogicGate(menu.targets.logicGateParentFolderID)}>
            Create logic gate
          </button>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateKanban("")}>
            Create new kanban
          </button>
        </>
      ) : (
        <>
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateFolder(menu.targets.preferredFolderKind, menu.targets.preferredFolderParentID)}>
            Create folder
          </button>
          {menu.contextKind !== "logic_gate" && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateNode(menu.targets.nodeParentFolderID)}>
              Create node
            </button>
          )}
          {menu.contextKind !== "node" && (
            <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateLogicGate(menu.targets.logicGateParentFolderID)}>
              Create logic gate
            </button>
          )}
          <button style={{ ...buttonStyle, color: "#111111" }} onClick={() => onCreateKanban(menu.kanbanParentFolderID)}>
            Create new kanban
          </button>
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
      {menu.deleteTarget && (
        <button style={{ ...buttonStyle, color: "#c62828" }} onClick={() => onDeleteTarget(menu.deleteTarget!)}>
          Delete
        </button>
      )}
    </FrameRightClickMenu>
  );
};
