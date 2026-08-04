"use client";

import {
  SessionRegistry,
  type SessionRegistryController,
} from "@/lib/session-registry";
import {
  SessionViewTransport,
  type SessionViewTransportController,
} from "@/lib/session-view-transport";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

type SessionRegistryContextValue = Readonly<{
  registry: SessionRegistryController;
  views: SessionViewTransportController;
}>;

const SessionRegistryContext = createContext<SessionRegistryContextValue | null>(null);

type ProviderLifecycle = {
  pendingDisposal: object | null;
  disposed: boolean;
};

export function SessionRegistryProvider({
  children,
  createRegistry = () => new SessionRegistry(),
  createViewTransport = (registry) => new SessionViewTransport(registry),
}: {
  children: ReactNode;
  createRegistry?: () => SessionRegistryController;
  createViewTransport?: (registry: SessionRegistryController) => SessionViewTransportController;
}) {
  const registryRef = useRef<SessionRegistryController | null>(null);
  if (registryRef.current === null) registryRef.current = createRegistry();
  const registry = registryRef.current;
  const viewsRef = useRef<SessionViewTransportController | null>(null);
  if (viewsRef.current === null) viewsRef.current = createViewTransport(registry);
  const views = viewsRef.current;
  const valueRef = useRef<SessionRegistryContextValue | null>(null);
  if (valueRef.current === null) valueRef.current = Object.freeze({ registry, views });
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
        // View bindings own raw registry handles, so they must release before
        // the base registry performs its final exact-once disposal.
        try { viewsRef.current?.dispose(); } catch { /* final cleanup is isolated */ }
        try { registryRef.current?.dispose(); } catch { /* final cleanup is isolated */ }
      });
    };
  }, []);

  return (
    <SessionRegistryContext.Provider value={valueRef.current}>
      {children}
    </SessionRegistryContext.Provider>
  );
}

export function useSessionRegistry(): SessionRegistryController {
  const value = useContext(SessionRegistryContext);
  if (!value) throw new Error("SessionRegistryProvider is missing");
  return value.registry;
}

export function useSessionViewTransport(): SessionViewTransportController {
  const value = useContext(SessionRegistryContext);
  if (!value) throw new Error("SessionRegistryProvider is missing");
  return value.views;
}
