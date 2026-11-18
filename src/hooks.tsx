import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onValue } from 'firebase/database';
import { r } from './firebase';

/** Live value at a database path. Re-renders whenever it changes. `null` path = not subscribed. */
export function useLive<T>(path: string | null, fallback: T): T {
  const fb = useRef(fallback);
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    if (!path) { setValue(fb.current); return; }
    return onValue(r(path), s => setValue((s.val() ?? fb.current) as T), () => setValue(fb.current));
  }, [path]);
  return value;
}

/** Server clock offset, so countdowns line up across devices. */
export function useServerNow() {
  const offset = useLive<number>('.info/serverTimeOffset', 0);
  return useCallback(() => Date.now() + offset, [offset]);
}

// ---------- toast ----------
type ToastFn = (msg: string, err?: boolean) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err: boolean; show: boolean }>({ msg: '', err: false, show: false });
  const timer = useRef<number>(undefined);
  const toast = useCallback<ToastFn>((msg, err = false) => {
    setT({ msg, err, show: true });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(x => ({ ...x, show: false })), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={`toast${t.show ? ' show' : ''}${t.err ? ' err' : ''}`} role="status">{t.msg}</div>
    </ToastCtx.Provider>
  );
}
