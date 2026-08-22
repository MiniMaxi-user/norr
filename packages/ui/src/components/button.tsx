import type { ButtonHTMLAttributes } from "react";
import { cx } from "../cx";

export type ButtonVariant = "primary" | "outline" | "danger";
export type ButtonSize = "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant, size, type = "button", className, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("ui-button", variant && `ui-button-${variant}`, size && `ui-button-${size}`, className)}
      {...rest}
    />
  );
}

export type IconButtonVariant = "ghost";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
}

export function IconButton({ variant, type = "button", className, ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx("ui-icon-button", variant && `ui-icon-button-${variant}`, className)}
      {...rest}
    />
  );
}
