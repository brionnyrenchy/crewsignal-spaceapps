import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  role?: 'dialog' | 'alertdialog';
  children: React.ReactNode;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  initialFocusRef,
  returnFocusRef,
  role = 'dialog',
  children,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const rafId = window.requestAnimationFrame(() => {
      const target = initialFocusRef?.current;
      if (target && typeof target.focus === 'function') {
        target.focus();
        return;
      }
      if (dialogRef.current) {
        const focusables = getFocusableElements(dialogRef.current);
        if (focusables[0]) {
          focusables[0].focus();
        } else {
          dialogRef.current.focus();
        }
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = getFocusableElements(dialogRef.current);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        const active = document.activeElement;

        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', onKeyDown, true);
      const restoreTarget = returnFocusRef?.current ?? previousFocusRef.current;
      if (restoreTarget && typeof restoreTarget.focus === 'function' && restoreTarget.isConnected) {
        window.requestAnimationFrame(() => {
          restoreTarget.focus();
        });
      }
    };
  }, [open, onClose, initialFocusRef, returnFocusRef]);

  if (!open) return null;

  return (
    <div
      className="cs-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="cs-modal"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '12px',
          }}
        >
          <div>
            <h2 id={titleId} className="cs-section-title">
              {title}
            </h2>
            {description && (
              <p
                id={descId}
                style={{
                  marginTop: '6px',
                  fontSize: '0.875rem',
                  color: 'var(--text-secondary)',
                }}
              >
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="cs-btn cs-btn-ghost"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
