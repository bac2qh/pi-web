import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPreferences";
import { GlobalStatusProvider } from "@/components/GlobalStatusProvider";

export default function Home() {
  return (
    <Suspense>
      <GlobalStatusProvider>
        <DisplayPreferencesProvider>
          <AppShell />
        </DisplayPreferencesProvider>
      </GlobalStatusProvider>
    </Suspense>
  );
}
