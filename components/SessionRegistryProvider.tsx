"use client";

import {
  SessionRegistry,
  type SessionRegistryController,
} from "@/lib/session-registry";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

const SessionRegistryContext = createContext<SessionRegistryController | null>(null);

type ProviderLifecycle = {
  pendingDisposal: object | null;
  disposed: boolean;
};

export function SessionRegistryProvider({
  children,
  createRegistry = () => new SessionRegistry(),
}: {
  children: ReactNode;
  createRegistry?: () => SessionRegistryController;
}) {
  const registryRef = useRef<SessionRegistryController | null>(null);
  if (registryRef.current === null) registryRef.current = createRegistry();
  const registry = registryRef.current;
  const lifecycleRef = useRef<ProviderLifecycle>({ pendingDisposal: null, disposed: false });

  useEffect(() => {
    // React StrictMode immediately replays setup after its development-only
    // cleanup. Cancel that deferred cleanup so the one ref-owned registry stays
    // usable; an actual final unmount has no following setup and disposes once.
    const lifecycle = lifecycleRef.current;
    lifecycle.pendingDisposal = null;
    return () => {
      const token = {};
      lifecycle.pendingDisposal = token;
      queueMicrotask(() => {
        if (lifecycle.pendingDisposal !== token || lifecycle.disposed) return;
        lifecycle.disposed = true;
        try { registryRef.current?.dispose(); } catch { /* final cleanup is isolated */ }
      });
    };
  }, []);

  return (
    <SessionRegistryContext.Provider value={registry}>
      {children}
    </SessionRegistryContext.Provider>
  );
}

export function useSessionRegistry(): SessionRegistryController {
  const registry = useContext(SessionRegistryContext);
  if (!registry) throw new Error("SessionRegistryProvider is missing");
  return registry;
}
