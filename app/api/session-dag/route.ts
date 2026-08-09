import { createSessionDagRouteHandlers } from "@/lib/session-dag-route";

export const dynamic = "force-dynamic";

const handlers = createSessionDagRouteHandlers();

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
