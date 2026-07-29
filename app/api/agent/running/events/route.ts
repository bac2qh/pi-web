import {
  getRunningRpcSessionIds,
  getSessionListRefreshGeneration,
  subscribeRunningSessions,
  subscribeSessionListRefresh,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running/events - SSE stream of the set of currently-running
// session ids. Pushes an update whenever any session starts or stops working,
// so the sidebar never has to poll.
export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Subscribe BEFORE taking the initial snapshot so no state change can slip
      // through the gap between snapshot and subscription.
      const unsubscribeRunning = subscribeRunningSessions((ids) => {
        try {
          encode({ type: "running", runningSessionIds: ids });
        } catch {
          // controller already closed
        }
      });
      const unsubscribeSessionListRefresh = subscribeSessionListRefresh((generation) => {
        try {
          encode({ type: "sessions_changed", sessionListGeneration: generation });
        } catch {
          // controller already closed
        }
      });

      // Initial snapshot so the client renders the correct state immediately.
      // (A duplicate frame here is harmless: the client just sets the same set.)
      encode({ type: "running", runningSessionIds: getRunningRpcSessionIds() });
      // Replay the current discovery generation on every initial connection and
      // reconnect so a change published during an SSE outage cannot be lost.
      encode({ type: "sessions_changed", sessionListGeneration: getSessionListRefreshGeneration() });

      // Heartbeat to keep the connection alive through proxies/timeouts.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribeRunning();
        unsubscribeSessionListRefresh();
        try { controller.close(); } catch { /* already closed */ }
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
