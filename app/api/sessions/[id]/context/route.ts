import { NextResponse } from "next/server";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { resolveSessionPath, buildSessionContext } from "@/lib/session-reader";
import { classifySideSession, sideNavigationAllowed } from "@/lib/side-session";
import type { SessionEntry } from "@/lib/types";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries() as unknown as SessionEntry[];
    const selectedLeafId = leafId ?? sm.getLeafId();
    const classification = classifySideSession(entries, id, selectedLeafId);
    if (classification.kind === "invalid") {
      return NextResponse.json({ error: `Side session unavailable: ${classification.reason}` }, { status: 409 });
    }
    if (classification.kind === "side"
      && (!selectedLeafId || !sideNavigationAllowed(entries, classification.metadata, selectedLeafId))) {
      return NextResponse.json({ error: "Side session unavailable: side_boundary" }, { status: 409 });
    }
    const context = buildSessionContext(entries, selectedLeafId, {
      deferThinking,
      deferToolResultImages,
      ...(classification.kind === "side" ? { sideSession: classification.metadata } : {}),
    });

    return NextResponse.json({ context });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
