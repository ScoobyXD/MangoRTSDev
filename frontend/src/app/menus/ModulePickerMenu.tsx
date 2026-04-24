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
  menuBtnBase: React.CSSProperties;
  hoverHandlers: {
    onMouseEnter: (e: React.MouseEvent) => void;
    onMouseLeave: (e: React.MouseEvent) => void;
  };
  onClose: () => void;
  onChangeModuleKind: (moduleTypeMenuId: string, kind: string, label: string) => void;
}

// Module switcher menu: lets users swap a frame's feature module in-place.
const ModulePickerMenu: React.FC<ModulePickerMenuProps> = ({
  x,
  y,
  moduleTypeMenuId,
  moduleLibrary,
  menuBtnBase,
  hoverHandlers,
  onClose,
  onChangeModuleKind,
}) => {
  return (
    <FrameRightClickMenu x={x} y={y} onClose={onClose}>
      {moduleLibrary.map((item) => (
        <button
          key={item.kind}
          style={menuBtnBase}
          onClick={() => {
            // Bridge to AppLayout module registry update path.
            onChangeModuleKind(moduleTypeMenuId, item.kind, item.label);
            onClose();
          }}
          {...hoverHandlers}
        >
          {item.label}
        </button>
      ))}
    </FrameRightClickMenu>
  );
};

export default ModulePickerMenu;
