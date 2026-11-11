import React, { useEffect, useRef } from 'react';
import { navigate } from '../lib/api';
import { statusLabels } from '../../../../packages/contracts/index.mjs';
const labels: Record<string, string> = statusLabels;
export function Link({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  return <a href={to} className={className} onClick={event => { if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); navigate(to); } }}>{children}</a>;
}
export function Badge({ status }: { status: string }) { return <span className={`badge badge-${status}`}>{labels[status] ?? status}</span>; }
export function Empty({ children }: { children: React.ReactNode }) { return <div className="empty">{children}</div>; }
export function Dialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]') ?? [])];
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); old?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}><section ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={close} aria-label="关闭对话框">×</button></header>{children}</section></div>;
}
