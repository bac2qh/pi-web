import { NextResponse } from "next/server";
import {
  SessionDagValueError,
  parseSessionDagMutationEnvelope,
  type SessionDagMutationEnvelope,
} from "./session-dag";
import {
  SessionDagListingChangedError,
  SessionDagMutationConflictResponseError,
  SessionDagStoreError,
  mutateSessionDagState,
  readSessionDagState,
  type SessionDagMutationResult,
} from "./session-dag-store";
import { listAllSessionsWithGeneration, type CompleteSessionListing } from "./session-reader";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const SESSION_LIST_RETRY_LIMIT = 4;
export const SESSION_DAG_MAX_MUTATION_BYTES = 2 * 1024 * 1024;

export interface SessionDagRouteDependencies {
  readState: typeof readSessionDagState;
  mutateState: typeof mutateSessionDagState;
  listSessions: typeof listAllSessionsWithGeneration;
}

const defaultDependencies: SessionDagRouteDependencies = {
  readState: readSessionDagState,
  mutateState: mutateSessionDagState,
  listSessions: listAllSessionsWithGeneration,
};

class SessionDagSessionsUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("Sessions could not be listed", options);
    this.name = "SessionDagSessionsUnavailableError";
  }
}

class SessionDagRequestTooLargeError extends Error {
  constructor() {
    super("Session DAG mutation exceeds its byte limit");
    this.name = "SessionDagRequestTooLargeError";
  }
}

async function readBoundedMutationJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength)
    && Number(declaredLength) > SESSION_DAG_MAX_MUTATION_BYTES) {
    throw new SessionDagRequestTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return JSON.parse("");
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > SESSION_DAG_MAX_MUTATION_BYTES) {
        await reader.cancel().catch(() => {});
        throw new SessionDagRequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function operationNeedsSessionListing(envelope: SessionDagMutationEnvelope): boolean {
  return envelope.operation.type === "add_edge"
    || envelope.operation.type === "replace_edge"
    || envelope.operation.type === "insert_edge";
}

function storeErrorResponse(error: SessionDagStoreError): NextResponse {
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status: error.status, headers: NO_STORE_HEADERS },
  );
}

function conflictResponse(error: SessionDagMutationConflictResponseError): NextResponse {
  return NextResponse.json(
    { error: error.message, code: error.code, state: error.state },
    { status: error.status, headers: NO_STORE_HEADERS },
  );
}

function sessionsErrorResponse(): NextResponse {
  return NextResponse.json(
    { error: "Sessions could not be listed", code: "session_dag_sessions_failed" },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

async function mutateWithCurrentSessionListing(
  envelope: SessionDagMutationEnvelope,
  dependencies: SessionDagRouteDependencies,
): Promise<SessionDagMutationResult> {
  for (let attempt = 0; attempt < SESSION_LIST_RETRY_LIMIT; attempt += 1) {
    let listing: CompleteSessionListing;
    try {
      listing = await dependencies.listSessions();
    } catch (error) {
      throw new SessionDagSessionsUnavailableError({ cause: error });
    }
    try {
      return await dependencies.mutateState(envelope, {
        availableSessionIds: new Set(listing.sessions.map((session) => session.id)),
        expectedSessionListGeneration: listing.generation,
      });
    } catch (error) {
      if (error instanceof SessionDagListingChangedError) continue;
      throw error;
    }
  }
  throw new SessionDagSessionsUnavailableError();
}

export function createSessionDagRouteHandlers(
  dependencies: SessionDagRouteDependencies = defaultDependencies,
): {
  GET(): Promise<NextResponse>;
  PATCH(request: Request): Promise<NextResponse>;
} {
  return {
    async GET() {
      try {
        const state = await dependencies.readState();
        return NextResponse.json(state, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof SessionDagStoreError) return storeErrorResponse(error);
        return NextResponse.json(
          { error: "Session DAG state could not be loaded", code: "session_dag_read_failed" },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }
    },

    async PATCH(request: Request) {
      let envelope: SessionDagMutationEnvelope;
      try {
        envelope = parseSessionDagMutationEnvelope(await readBoundedMutationJson(request));
      } catch (error) {
        if (error instanceof SessionDagRequestTooLargeError) {
          return NextResponse.json(
            { error: error.message, code: "session_dag_request_too_large" },
            { status: 413, headers: NO_STORE_HEADERS },
          );
        }
        const message = error instanceof SessionDagValueError
          ? error.message
          : "Request body must be valid JSON";
        return NextResponse.json(
          { error: message, code: "session_dag_bad_request" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }

      try {
        const result = operationNeedsSessionListing(envelope)
          ? await mutateWithCurrentSessionListing(envelope, dependencies)
          : await dependencies.mutateState(envelope);
        return NextResponse.json(result.state, { headers: NO_STORE_HEADERS });
      } catch (error) {
        if (error instanceof SessionDagMutationConflictResponseError) return conflictResponse(error);
        if (error instanceof SessionDagStoreError) return storeErrorResponse(error);
        if (error instanceof SessionDagSessionsUnavailableError) return sessionsErrorResponse();
        return NextResponse.json(
          { error: "Session DAG state could not be updated", code: "session_dag_write_failed" },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }
    },
  };
}
