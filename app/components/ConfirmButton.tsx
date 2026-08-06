"use client";

import { useEffect, useState, type ReactNode } from "react";

type ConfirmButtonProps = {
  children: ReactNode;
  confirmLabel?: ReactNode;
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

export default function ConfirmButton({ children, confirmLabel = "再次点击确认", onConfirm, disabled = false, className = "", ariaLabel }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);

  function activate() {
    if (disabled) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void Promise.resolve(onConfirm());
  }

  return <button
    type="button"
    className={`${className} confirm-action${armed ? " armed" : ""}`.trim()}
    onClick={activate}
    disabled={disabled}
    aria-label={armed ? `确认${ariaLabel || "执行操作"}` : ariaLabel}
    aria-pressed={armed}
  >{armed ? confirmLabel : children}</button>;
}
