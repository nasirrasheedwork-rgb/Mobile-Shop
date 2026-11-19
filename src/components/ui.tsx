"use client";
import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge as BadgePrimitive } from "@/components/ui/badge";
import { label, pkr, showDate } from "@/lib/format";

export { Button } from '@/components/ui/button';
export function Field({ name, children, wide = false }: { name: string; children: ReactNode; wide?: boolean }) {
  const id = useId();
  const control = Children.map(children, child =>
    isValidElement<{ id?: string }>(child) && typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type)
      ? cloneElement(child, { id })
      : child
  );
  return <div className={wide ? "field wide" : "field"}><label htmlFor={id}>{name}</label>{control}</div>;
}
export function Badge({ value }: { value: string | null }) {
  return <BadgePrimitive className={value?.toLowerCase()}>{label(value)}</BadgePrimitive>;
}
export function Empty({ children = "No records to show." }: { children?: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export const ActionErrorContext = createContext("");

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const error = useContext(ActionErrorContext);
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.querySelector<HTMLElement>("[data-dialog-focus]")?.focus();
  }, []);
  return <dialog ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); close(); }}>
    <div className="dialog-head"><h2>{title}</h2><Button className="icon-btn" aria-label="Close" onClick={close}><X size={19} /></Button></div>
    {error && <p className="form-error dialog-alert" role="alert">{error}</p>}
    {children}
  </dialog>;
}
export const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
export const errorText = (error: unknown) => error instanceof Error ? ("issues" in error ? (error.issues as {message: string}[])[0]?.message ?? error.message : error.message) : "Something went wrong.";
export type Run = (action: () => Promise<void>) => Promise<void>;

export function Stat({ label, amount, children, icon }: { label: string; amount: number; children?: ReactNode; icon?: ReactNode }) {
  return <article className="stat"><div className="stat-head">{label}{icon && <span className="stat-icon">{icon}</span>}</div><strong>{pkr(amount)}</strong>{children && <div className="stat-caption">{children}</div>}</article>;
}
export function Period({ start, end, onChange }: { start: string; end: string; onChange: (start: string, end: string) => void }) {
  return <div className="period"><label>From <input type="date" aria-label="Start date" value={start} onChange={e => onChange(e.target.value, end)} /></label><label>To <input type="date" aria-label="End date" value={end} onChange={e => onChange(start, e.target.value)} /></label></div>;
}
export function DisplayDate({ value }: { value?: string | null }) {
  return <time dateTime={value ?? undefined}>{showDate(value)}</time>;
}
