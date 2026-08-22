import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: ReactNode;
  heading: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
}

/** For "no clients yet" / "no assets yet" type screens. All slots optional
 * except `heading`. */
export function EmptyState({ icon, heading, text, action }: EmptyStateProps) {
  return (
    <div className="ui-empty-state">
      {icon && <div className="ui-empty-state-icon">{icon}</div>}
      {heading && <div className="ui-empty-state-heading">{heading}</div>}
      {text && <div className="ui-empty-state-text">{text}</div>}
      {action && <div className="ui-empty-state-action">{action}</div>}
    </div>
  );
}
