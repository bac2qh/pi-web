"use client";

import {
  GlobalStatusClient,
  type GlobalSessionsChangedDelivery,
  type GlobalStatusSnapshot,
} from "@/lib/global-status-client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type GlobalStatusController = Pick<
  GlobalStatusClient,
  "getSnapshot" | "start" | "stop" | "subscribe" | "subscribeSessionsChanged"
>;

type GlobalStatusContextValue = GlobalStatusSnapshot & {
  getCurrentSnapshot(): GlobalStatusSnapshot;
  subscribeSessionsChanged(listener: (event: GlobalSessionsChangedDelivery) => void): () => void;
};

const GlobalStatusContext = createContext<GlobalStatusContextValue | null>(null);

export function GlobalStatusProvider({
  children,
  createController = () => new GlobalStatusClient(),
}: {
  children: ReactNode;
  createController?: () => GlobalStatusController;
}) {
  const controllerRef = useRef<GlobalStatusController | null>(null);
  if (controllerRef.current === null) controllerRef.current = createController();
  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState<GlobalStatusSnapshot>(() => controller.getSnapshot());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setSnapshot);
    controller.start();
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [controller]);

  // This synchronous read closes the gap between controller delivery and the
  // React render/effect that publishes the same snapshot to consumers. Callers
  // arbitrating a late async fallback can consult controller authority at the
  // exact commit point rather than waiting for a passive effect.
  const getCurrentSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  const subscribeSessionsChanged = useCallback(
    (listener: (event: GlobalSessionsChangedDelivery) => void) => (
      controller.subscribeSessionsChanged(listener)
    ),
    [controller],
  );

  const value = useMemo<GlobalStatusContextValue>(() => ({
    ...snapshot,
    getCurrentSnapshot,
    subscribeSessionsChanged,
  }), [getCurrentSnapshot, snapshot, subscribeSessionsChanged]);

  return (
    <GlobalStatusContext.Provider value={value}>
      {children}
    </GlobalStatusContext.Provider>
  );
}

export function useGlobalStatus(): GlobalStatusContextValue {
  const value = useContext(GlobalStatusContext);
  if (!value) throw new Error("GlobalStatusProvider is missing");
  return value;
}
