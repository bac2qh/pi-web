import { NextResponse } from "next/server";
import {
  SidebarStateValueError,
  parseSidebarStateOperation,
} from "@/lib/sidebar-session-state";
import {
  SidebarStateListingChangedError,
  SidebarStateStoreError,
  reconcileStoredSidebarState,
  updateSidebarState,
} from "@/lib/sidebar-state-store";
import { listAllSessionsWithGeneration } from "@/lib/session-reader";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const SESSION_LIST_RETRY_LIMIT = 4;

class SidebarSessionsUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Sessions could not be listed", options);
    this.name = "SidebarSessionsUnavailableError";
  }
}

class SidebarSessionNotFoundError extends Error {
  constructor() {
    super("Session was not found");
    this.name = "SidebarSessionNotFoundError";
  }
}

function storeErrorResponse(error: SidebarStateStoreError): NextResponse {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status, headers: NO_STORE_HEADERS },
  );
}

function sessionsErrorResponse(): NextResponse {
  return NextResponse.json(
    { error: "Sessions could not be listed", code: "sidebar_state_sessions_failed" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

async function withCurrentSessionListing<T>(
  operation: (sessions: SessionInfo[], generation: number) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < SESSION_LIST_RETRY_LIMIT; attempt += 1) {
    let listing;
    try {
      listing = await listAllSessionsWithGeneration();
    } catch (error) {
      throw new SidebarSessionsUnavailableError({ cause: error });
    }

    try {
      return await operation(listing.sessions, listing.generation);
    } catch (error) {
      if (error instanceof SidebarStateListingChangedError) continue;
      throw error;
    }
  }
  throw new SidebarSessionsUnavailableError();
}

export async function GET() {
  try {
    const state = await withCurrentSessionListing((sessions, generation) => (
      reconcileStoredSidebarState(sessions, { expectedSessionListGeneration: generation })
    ));
    return NextResponse.json(state, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof SidebarStateStoreError) return storeErrorResponse(error);
    if (error instanceof SidebarSessionsUnavailableError) return sessionsErrorResponse();
    return NextResponse.json(
      { error: "Sidebar state could not be loaded", code: "sidebar_state_read_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PATCH(request: Request) {
  let operation;
  try {
    operation = parseSidebarStateOperation(await request.json());
  } catch (error) {
    const message = error instanceof SidebarStateValueError ? error.message : "Request body must be valid JSON";
    return NextResponse.json(
      { error: message, code: "sidebar_state_bad_request" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const state = await withCurrentSessionListing((sessions, generation) => {
      if ((operation.operation === "pin" || operation.operation === "hide")
        && !sessions.some((session) => session.id === operation.sessionId)) {
        throw new SidebarSessionNotFoundError();
      }
      return updateSidebarState(operation, sessions, { expectedSessionListGeneration: generation });
    });
    return NextResponse.json(state, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof SidebarSessionNotFoundError) {
      return NextResponse.json(
        { error: error.message, code: "sidebar_state_session_not_found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    if (error instanceof SidebarStateStoreError) return storeErrorResponse(error);
    if (error instanceof SidebarSessionsUnavailableError) return sessionsErrorResponse();
    return NextResponse.json(
      { error: "Sidebar state could not be updated", code: "sidebar_state_write_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
