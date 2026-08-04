import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPreferences";
import { GlobalStatusProvider } from "@/components/GlobalStatusProvider";
import { SessionRegistryProvider } from "@/components/SessionRegistryProvider";

export default function Home() {
  return (
    <Suspense>
      <GlobalStatusProvider>
        <SessionRegistryProvider>
          <DisplayPreferencesProvider>
            <AppShell />
          </DisplayPreferencesProvider>
        </SessionRegistryProvider>
      </GlobalStatusProvider>
    </Suspense>
  );
}
