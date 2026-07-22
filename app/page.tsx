import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { DisplayPreferencesProvider } from "@/hooks/useDisplayPreferences";

export default function Home() {
  return (
    <Suspense>
      <DisplayPreferencesProvider>
        <AppShell />
      </DisplayPreferencesProvider>
    </Suspense>
  );
}
