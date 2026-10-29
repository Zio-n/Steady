import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

type DialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
};

export function Dialog({ open, title, onClose, closeDisabled = false, className = '', style, children }: DialogProps) {
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
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} className={`app-dialog ${className}`} style={style} aria-labelledby={titleId} tabIndex={-1} onKeyDown={keepTabFocusInside} onCancel={(event) => { if (closeDisabled) event.preventDefault(); }} onClose={() => { if (!closeDisabled) onClose(); }}>
      <header className="dialog-header"><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" aria-label="Close dialog" disabled={closeDisabled} onClick={() => dialogRef.current?.close()}><X size={18} /></button></header>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}
