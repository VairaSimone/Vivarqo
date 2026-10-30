import React, { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { Dialog } from "./Dialog";

export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
type ConfirmAction = (options?: ConfirmOptions) => Promise<boolean>;
type PendingConfirmation = Required<ConfirmOptions>;
const ConfirmContext = createContext<ConfirmAction | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const resolveRef = useRef<((accepted: boolean) => void) | null>(null);
  const confirm = useCallback((options?: ConfirmOptions): Promise<boolean> => new Promise<boolean>(resolve => {
    if (resolveRef.current) resolveRef.current(false);
    resolveRef.current = resolve;
    setPending({
      title: options?.title || "Confermare l'operazione?",
      message: options?.message || "Questa operazione potrebbe non essere reversibile.",
      confirmLabel: options?.confirmLabel || "Conferma",
      cancelLabel: options?.cancelLabel || "Annulla",
      danger: options?.danger !== false
    });
  }), []);
  const settle = useCallback((accepted: boolean) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setPending(null);
    resolve?.(accepted);
  }, []);
  return <ConfirmContext.Provider value={confirm}>
    {children}
    {pending && <Dialog title={pending.title} description={pending.message} onClose={() => settle(false)} onSubmit={() => settle(true)} submitLabel={pending.confirmLabel} cancelLabel={pending.cancelLabel} danger={pending.danger}>
      <div className="confirm-dialog-mark"><Icon name="warning" size={22}/></div>
    </Dialog>}
  </ConfirmContext.Provider>;
}

export function useConfirmDialog(): ConfirmAction {
  const confirm = useContext(ConfirmContext);
  return confirm || (options => Promise.resolve(window.confirm((options?.title ? options.title + "\n\n" : "") + (options?.message || "Confermare l'operazione?"))));
}
