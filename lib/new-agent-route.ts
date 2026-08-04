import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { existsSync } from "fs";
import { allowFileRoot } from "@/lib/file-access";
import {
  invalidateSessionListCache,
  invalidateSessionPathCache,
} from "@/lib/session-reader";
import {
  getRpcSession,
  startRpcSession,
  type RpcSessionStartResult,
} from "@/lib/rpc-manager";

// POST /api/agent/new  body: { cwd: string; type: string; message?: string; ... }
// Spawns a brand-new pi session. Most calls immediately send the first command;
// type:"ensure_session" only creates the runtime so clients can query commands.
// Returns { sessionId, data } where sessionId is pi's real session id.
type NewAgentRouteDependencies = {
  cwdExists(cwd: string): boolean;
  createStartupKey(): string;
  startSession: typeof startRpcSession;
  allowRoot(cwd: string): void;
  invalidateSessions(): void;
};

const defaultDependencies: NewAgentRouteDependencies = {
  cwdExists: existsSync,
  createStartupKey: () => `__pi_web_new_request__:${randomUUID()}`,
  startSession: startRpcSession,
  allowRoot: allowFileRoot,
  invalidateSessions: invalidateSessionListCache,
};

export function createNewAgentPost(
  dependencies: NewAgentRouteDependencies = defaultDependencies,
) {
  return async (req: Request) => {
    let failedEnsureOwner: RpcSessionStartResult["session"] | undefined;
    let failedEnsureSessionId: string | undefined;
    try {
      const body = await req.json() as { cwd?: string; [key: string]: unknown };
      const { cwd, ...command } = body;

      if (!cwd || typeof cwd !== "string") {
        return NextResponse.json({ error: "cwd is required" }, { status: 400 });
      }
      if (!dependencies.cwdExists(cwd)) {
        return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
      }

      // Use a collision-resistant per-request key so concurrent new-session
      // startups never share startRpcSession's lock or native owner.
      const { provider, modelId, toolNames, thinkingLevel, ...promptCommand } = command as { provider?: string; modelId?: string; toolNames?: string[]; thinkingLevel?: string; [key: string]: unknown };
      const isEnsureRequest = promptCommand.type === "ensure_session";

      const tempKey = dependencies.createStartupKey();
      const { session, realSessionId }: RpcSessionStartResult = await dependencies.startSession(tempKey, "", cwd, toolNames);
      if (isEnsureRequest) {
        failedEnsureOwner = session;
        failedEnsureSessionId = realSessionId;
      }

      // Keep the files-route allowed-roots cache (see app/api/files/[...path]/route.ts)
      // in sync so the new cwd is immediately readable via /api/files. Without this,
      // a file request under a brand-new cwd would 403 for up to the cache TTL.
      dependencies.allowRoot(cwd);
      dependencies.invalidateSessions();

      // Apply pre-selected model before sending the prompt
      if (provider && modelId) {
        await session.send({ type: "set_model", provider, modelId });
      }

      // Apply pre-selected thinking level before sending the prompt
      if (thinkingLevel) {
        await session.send({ type: "set_thinking_level", level: thinkingLevel });
      }

      if (isEnsureRequest) {
        if (realSessionId !== session.sessionId) {
          throw new Error("rpc_ensured_session_id_mismatch");
        }
        // SessionManager allocates the exact native owner/file identity before
        // the header is written. Publish that server-held identity for the
        // narrow pre-prompt ticket path; no synthetic persistence is created.
        session.enableEnsuredSessionTransport();
        return NextResponse.json({ success: true, sessionId: realSessionId, data: null });
      }

      const result = await session.send(promptCommand);

      return NextResponse.json({ success: true, sessionId: realSessionId, data: result });
    } catch (error) {
      // An ensure response that fails after publication exposes no usable owner
      // ID. Remove its exact owner and, unless a different same-ID owner replaced
      // it during setup, both directions of its path-cache entry. Successful
      // ensures retain that cache for pre-persistence resolution. Ordinary prompt
      // failures remain target-owned because command acceptance can be ambiguous.
      if (failedEnsureOwner) {
        try {
          failedEnsureOwner.destroy();
        } finally {
          if (failedEnsureSessionId) {
            const currentOwner = getRpcSession(failedEnsureSessionId);
            if (!currentOwner || currentOwner === failedEnsureOwner) {
              invalidateSessionPathCache(failedEnsureSessionId);
            }
          }
        }
      }
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  };
}
