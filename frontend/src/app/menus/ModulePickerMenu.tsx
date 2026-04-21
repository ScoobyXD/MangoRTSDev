import React from "react";
import FrameRightClickMenu from "../framerightclickmenu";

interface ModuleItem {
  kind: string;
  label: string;
}

export interface ModulePickerMenuProps {
  x: number;
  y: number;
  moduleTypeMenuId: string;
  moduleLibrary: ModuleItem[];
  nodeSubmodules: readonly ModuleItem[];
  showNodesSubmenu: boolean;
  setShowNodesSubmenu: React.Dispatch<React.SetStateAction<boolean>>;
  menuBtnBase: React.CSSProperties;
  hoverHandlers: {
    onMouseEnter: (e: React.MouseEvent) => void;
    onMouseLeave: (e: React.MouseEvent) => void;
  };
  onClose: () => void;
  onChangeModuleKind: (moduleTypeMenuId: string, kind: string, label: string) => void;
}

const ModulePickerMenu: React.FC<ModulePickerMenuProps> = ({
  x,
  y,
  moduleTypeMenuId,
  moduleLibrary,
  nodeSubmodules,
  showNodesSubmenu,
  setShowNodesSubmenu,
  menuBtnBase,
  hoverHandlers,
  onClose,
  onChangeModuleKind,
}) => {
  return (
    <FrameRightClickMenu x={x} y={y} onClose={onClose}>
      {moduleLibrary.filter((item) => item.kind !== "nodes-canvas").map((item) => (
        <button
          key={item.kind}
          style={menuBtnBase}
          onClick={() => {
            onChangeModuleKind(moduleTypeMenuId, item.kind, item.label);
            onClose();
          }}
          {...hoverHandlers}
        >
          {item.label}
        </button>
      ))}
      <div style={{ position: "relative" }} onMouseLeave={() => setShowNodesSubmenu(false)}>
        <button
          style={{ ...menuBtnBase, justifyContent: "space-between", width: "100%" }}
          onMouseMove={() => setShowNodesSubmenu(true)}
          onFocus={() => setShowNodesSubmenu(true)}
          onClick={() => setShowNodesSubmenu((value) => !value)}
          {...hoverHandlers}
        >
          <span>Node</span>
          <span style={{ fontSize: 10, opacity: 0.72 }}>▶</span>
        </button>
        {showNodesSubmenu && (
          <div
            style={{
              position: "absolute",
              left: "100%",
              top: -4,
              marginLeft: 4,
              background: "#fff",
              border: "1px solid #e0e0e0",
              borderRadius: 10,
              boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
              padding: "4px 0",
              minWidth: 180,
              zIndex: 1001,
            }}
          >
            {nodeSubmodules.map((item) => (
              <button
                key={item.kind}
                style={menuBtnBase}
                onClick={() => {
                  onChangeModuleKind(moduleTypeMenuId, item.kind, item.label);
                  onClose();
                }}
                {...hoverHandlers}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </FrameRightClickMenu>
  );
};

export default ModulePickerMenu;
