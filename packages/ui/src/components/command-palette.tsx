import type { ReactNode } from "react";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
  children?: ReactNode;
}

/**
 * Same `open`/`onOpenChange` contract as `Dialog`: clicking the overlay
 * calls `onOpenChange(false)`. Keyboard shortcuts (Ctrl/Cmd-K to open,
 * Escape to close) are the call site's responsibility (see
 * `components/shell/command-palette.tsx` in the app) since they're
 * global/document-level, not scoped to this component's own DOM.
 */
export function CommandPalette({ open, onOpenChange, placeholder, children }: CommandPaletteProps) {
  if (!open) return null;
  return (
    <div className="ui-command-overlay" onClick={() => onOpenChange(false)}>
      <div className="ui-command-dialog" role="dialog" aria-modal onClick={(event) => event.stopPropagation()}>
        <input className="ui-command-input" placeholder={placeholder} autoFocus />
        <div className="ui-command-list">{children}</div>
      </div>
    </div>
  );
}

export interface CommandGroupProps {
  heading?: string;
  children?: ReactNode;
}

export function CommandGroup({ heading, children }: CommandGroupProps) {
  return (
    <div className="ui-command-group">
      {heading && <div className="ui-command-group-heading">{heading}</div>}
      {children}
    </div>
  );
}

export interface CommandItemProps {
  onSelect?: () => void;
  children?: ReactNode;
}

export function CommandItem({ onSelect, children }: CommandItemProps) {
  return (
    <button type="button" className="ui-command-item" onClick={onSelect}>
      {children}
    </button>
  );
}
