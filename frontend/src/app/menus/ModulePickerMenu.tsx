import React from "react";

export interface ModulePickerMenuProps {
  children: React.ReactNode;
}

const ModulePickerMenu: React.FC<ModulePickerMenuProps> = ({ children }) => {
  return <>{children}</>;
};

export default ModulePickerMenu;
