import { useCallback, useEffect, useRef, useState } from "react";
import type { NoticeKind } from "../types";

export interface AppNotice {
  text: string;
  kind: NoticeKind;
}

/** Centralises transient app notices and their single auto-dismiss timer. */
export function useAppNotice() {
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const timer = useRef<number | null>(null);

  const showNotice = useCallback((text: string, kind: NoticeKind = "info") => {
    setNotice({ text, kind });
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setNotice(null);
    }, 5000);
  }, []);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  return { notice, showNotice };
}
