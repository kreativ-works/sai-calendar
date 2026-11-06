"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { bindDialogViewport, lockDialogScroll } from "@/lib/client/dialog-viewport";

export default function Dialog({ title, eyebrow, onClose, children, className = "" }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stopViewport = bindDialogViewport(dialog);
    const releaseScroll = lockDialogScroll(dialog);
    // create() commits with flushSync, so showModal and focus remain inside the
    // date tap's trusted gesture rather than a deferred effect/frame on iOS.
    dialog.showModal();
    const target = dialog.querySelector<HTMLElement>('[autofocus]') ?? dialog.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled])');
    target?.focus({ preventScroll: true });
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      dialog.removeEventListener("close", closed);
      stopViewport();
      if (dialog.open) dialog.close();
      releaseScroll();
      const remaining = document.querySelector("dialog[open]");
      if (previous?.isConnected && (!remaining || remaining.contains(previous))) previous.focus({ preventScroll: true });
    };
    // Strict Mode can enqueue a close event before immediately reopening this
    // same element. Such an old event must not release the new modal's lock.
    const closed = () => { if (!dialog.open) cleanup(); };
    dialog.addEventListener("close", closed);
    return cleanup;
  }, []);
  return <dialog ref={ref} className={`sai-dialog ${className}`} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-interior">
      <header className="dialog-header"><div>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h2 id={id}>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><X size={20} /></button></header>
      {children}
    </div>
  </dialog>;
}
