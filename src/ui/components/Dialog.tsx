import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

type DialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  modal?: boolean;
  lightDismiss?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

export function Dialog({ open, title, onClose, closeDisabled = false, modal = true, lightDismiss = false, className = '', style, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  function keepTabFocusInside(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (modal) dialog.showModal();
      else dialog.show();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, modal]);

  return (
    <dialog ref={dialogRef} className={`app-dialog ${className}`} style={style} aria-labelledby={titleId} tabIndex={-1} onClick={(event) => { if (!lightDismiss || closeDisabled || event.target !== event.currentTarget) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close(); }} onKeyDown={modal ? keepTabFocusInside : undefined} onCancel={(event) => { if (closeDisabled) event.preventDefault(); }} onClose={() => { if (!closeDisabled) onClose(); }}>
      <header className="dialog-header"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" aria-label="Close dialog" disabled={closeDisabled} onClick={() => dialogRef.current?.close()}><X size={18} /></button></header>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}
