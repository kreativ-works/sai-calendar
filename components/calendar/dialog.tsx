"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export default function Dialog({ title, eyebrow, onClose, children, className = "" }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('input:not([type="checkbox"]):not([disabled]):not([readonly]), textarea:not([disabled]), select:not([disabled])')?.focus();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`sai-dialog ${className}`} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="dialog-interior">
      <header className="dialog-header"><div>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h2 id={id}>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><X size={20} /></button></header>
      {children}
    </div>
  </dialog>;
}
