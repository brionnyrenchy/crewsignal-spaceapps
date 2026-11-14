import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface ModalDialogProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: number;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalDialog({
  title,
  subtitle,
  onClose,
  children,
  actions,
  maxWidth = 520,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = dialogRef.current;

    const focusTimer = window.setTimeout(() => {
      if (!container) return;
      const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusables[0];
      if (first) {
        first.focus();
      } else {
        container.focus();
      }
    }, 10);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !container) return;

      const focusables = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (el) => el.offsetParent !== null,
      );
      if (focusables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ maxWidth }}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: 18, fontWeight: "var(--weight-heading)" }}>
              {title}
            </h2>
            {subtitle ? (
              <p className="page-subtitle" style={{ marginTop: 4, fontSize: 13 }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            aria-label={`Close ${title}`}
            style={{ minWidth: 44, padding: "0 10px" }}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="stack-md" style={{ marginTop: 16 }}>
          {children}
        </div>

        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
