import React from "react";
import { HeaderRecycleBinIcon } from "../../icons/index.js";
import { MinimizeToLineIcon, OpenInNewTabIcon, PinToSidebarIcon } from "../../app/nodeEditorPopupControls";
import {
  UNIFIED_NODE_SHELL_BEHAVIOR_SOURCE,
  UNIFIED_NODE_SHELL_TOP_RIGHT_ACTION_ORDER,
  type UnifiedNodeShellActionID,
  type UnifiedNodeShellSurfaceID,
} from "./unifiedNodeShellContract";

export type UnifiedNodeShellAction = {
  id: UnifiedNodeShellActionID;
  title?: string;
  ariaLabel?: string;
  disabled?: boolean;
  hidden?: boolean;
  pressed?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

type UnifiedNodeShellProps = {
  surfaceID: UnifiedNodeShellSurfaceID;
  title: string;
  actions: readonly UnifiedNodeShellAction[];
  children: React.ReactNode;
  chrome?: React.ReactNode;
  className?: string;
  role?: React.AriaRole;
  ariaModal?: boolean;
  ariaLabel?: string;
  frameInteractive?: boolean;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  actionButtonStyle?: React.CSSProperties | ((action: UnifiedNodeShellAction, index: number) => React.CSSProperties);
  closeButtonStyle?: React.CSSProperties | ((action: UnifiedNodeShellAction, index: number) => React.CSSProperties);
  actionButtonClassName?: string;
  actionTop?: number;
  actionRight?: number;
  actionStep?: number;
  onMouseDown?: React.MouseEventHandler<HTMLDivElement>;
  onTouchStart?: React.TouchEventHandler<HTMLDivElement>;
};

export const UNIFIED_NODE_SHELL_CLOSE_BUTTON_CHROME_STYLE: React.CSSProperties = {
  display: "grid",
  placeItems: "center",
  border: "1px solid transparent",
  background: "linear-gradient(135deg, #ff5a6b, #ef334e)",
  color: "#ffffff",
  padding: 0,
  fontSize: 16,
  fontWeight: 700,
  lineHeight: "20px",
  cursor: "pointer",
  boxShadow: "0 8px 18px rgba(239, 51, 78, 0.26), inset 1px 1px 0 rgba(255,255,255,0.38)",
};

export const UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE: React.CSSProperties = {
  ...UNIFIED_NODE_SHELL_CLOSE_BUTTON_CHROME_STYLE,
  width: 24,
  height: 24,
  borderRadius: 8,
  fontSize: 16,
  fontWeight: 700,
  lineHeight: "20px",
};

function UnifiedNodeShellFullscreenIcon({ active = false }: { active?: boolean }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
      {active ? (
        <>
          <path d="M6.2 2.2v3.6H2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.8 13.8v-3.6h3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M2.6 6V2.6H6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.4 10v3.4H10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

function defaultActionIcon(action: UnifiedNodeShellAction): React.ReactNode {
  if (action.id === "delete") return <HeaderRecycleBinIcon />;
  if (action.id === "fullscreen") return <UnifiedNodeShellFullscreenIcon active={action.pressed} />;
  if (action.id === "minimize") return <MinimizeToLineIcon />;
  if (action.id === "open-in-new-tab") return <OpenInNewTabIcon />;
  if (action.id === "pin") return <PinToSidebarIcon />;
  return "X";
}

function defaultActionTitle(action: UnifiedNodeShellAction): string {
  if (action.title) return action.title;
  if (action.id === "delete") return "Move node to Recycle Bin";
  if (action.id === "fullscreen") return action.pressed ? "Restore node editor" : "Fullscreen node editor";
  if (action.id === "minimize") return "Collapse node editor to app tab";
  if (action.id === "open-in-new-tab") return "Open node in new browser tab";
  if (action.id === "pin") return "Pin node to Pinned";
  return "Close node editor";
}

function resolveActionStyle(
  action: UnifiedNodeShellAction,
  index: number,
  style?: React.CSSProperties | ((action: UnifiedNodeShellAction, index: number) => React.CSSProperties),
): React.CSSProperties {
  return typeof style === "function" ? style(action, index) : (style ?? {});
}

function orderNodeShellActions(actions: readonly UnifiedNodeShellAction[]): UnifiedNodeShellAction[] {
  const visibleActions = actions.filter((action) => !action.hidden);
  const byID = new Map(visibleActions.map((action) => [action.id, action]));
  return UNIFIED_NODE_SHELL_TOP_RIGHT_ACTION_ORDER
    .map((actionID) => byID.get(actionID))
    .filter((action): action is UnifiedNodeShellAction => Boolean(action));
}

export function UnifiedNodeShell({
  surfaceID,
  title,
  actions,
  children,
  chrome,
  className,
  role = "group",
  ariaModal,
  ariaLabel,
  frameInteractive = true,
  style,
  bodyStyle,
  actionButtonStyle,
  closeButtonStyle,
  actionButtonClassName,
  actionTop = 7,
  actionRight = 8,
  actionStep = 30,
  onMouseDown,
  onTouchStart,
}: UnifiedNodeShellProps): React.ReactElement {
  const orderedActions = orderNodeShellActions(actions);
  return (
    <div
      className={className}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel ?? `${title || "Node"} node editor`}
      data-frame-interactive={frameInteractive ? "true" : undefined}
      data-mango-unified-node-shell={surfaceID}
      data-mango-node-shell-behavior-source={UNIFIED_NODE_SHELL_BEHAVIOR_SOURCE}
      data-mango-node-shell-actions={orderedActions.map((action) => action.id).join(" ")}
      style={style}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
    >
      {orderedActions.map((action, index) => {
        const titleText = defaultActionTitle(action);
        const customStyle = resolveActionStyle(action, index, action.id === "close" ? closeButtonStyle : actionButtonStyle);
        const closeChromeStyle = action.id === "close" ? UNIFIED_NODE_SHELL_CLOSE_BUTTON_CHROME_STYLE : null;
        return (
          <button
            key={action.id}
            className={actionButtonClassName}
            type="button"
            title={titleText}
            aria-label={action.ariaLabel ?? titleText}
            aria-pressed={action.id === "fullscreen" ? action.pressed : undefined}
            disabled={action.disabled}
            data-frame-interactive="true"
            data-mango-node-shell-action={action.id}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              action.onClick(event);
            }}
            style={{
              position: "absolute",
              zIndex: 80,
              ...customStyle,
              ...closeChromeStyle,
              right: actionRight + (index * actionStep),
              top: actionTop,
              color: action.danger ? "#be123c" : closeChromeStyle?.color ?? customStyle.color,
            }}
          >
            {action.icon ?? defaultActionIcon(action)}
          </button>
        );
      })}
      {chrome}
      <div data-mango-unified-node-shell-body="node-workspace" style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0, ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}
