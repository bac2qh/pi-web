import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { withModelsCacheInvalidation } from "@/lib/model-credential-cache";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const modelRuntime = await ModelRuntime.create();
  if (!modelRuntime.getProvider(provider)?.auth.oauth) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  }
  await withModelsCacheInvalidation(() => modelRuntime.logout(provider));
  return Response.json({ ok: true });
}
