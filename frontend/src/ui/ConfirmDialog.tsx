import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Icon } from "./Icon.tsx";
import { Dialog } from "./Dialog.tsx";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [pending, setPending] = useState(null);
  const resolveRef = useRef(null);
  const confirm = useCallback(options => new Promise(resolve => {
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
  const settle = useCallback(accepted => {
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

export function useConfirmDialog() {
  const confirm = useContext(ConfirmContext);
  return confirm || (options => Promise.resolve(window.confirm((options?.title ? options.title + "\n\n" : "") + (options?.message || "Confermare l'operazione?"))));
}
