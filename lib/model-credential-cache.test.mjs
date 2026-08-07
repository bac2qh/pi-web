import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { CredentialSynchronizationError } from "@earendil-works/pi-coding-agent";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { withModelsCacheInvalidation } = await jiti.import("./model-credential-cache.ts");
const { invalidateModelsCache, loadModelsWithCache } = await jiti.import("./models-cache.ts");

function modelsData(label) {
  return {
    models: { provider: label },
    modelList: [],
    defaultModel: null,
    thinkingLevels: {},
    thinkingLevelMaps: {},
  };
}

test("credential mutation success invalidates the independent Pi Web model cache", async () => {
  invalidateModelsCache();
  let loads = 0;
  const load = () => Promise.resolve(modelsData(`load-${++loads}`));
  await loadModelsWithCache("success", load);
  await loadModelsWithCache("success", load);
  assert.equal(loads, 1);

  assert.equal(await withModelsCacheInvalidation(async () => "ok"), "ok");
  await loadModelsWithCache("success", load);
  assert.equal(loads, 2);
});

test("committed credential synchronization failure is preserved while invalidating the cache", async () => {
  invalidateModelsCache();
  let loads = 0;
  const load = () => Promise.resolve(modelsData(`load-${++loads}`));
  await loadModelsWithCache("post-commit-failure", load);
  const failure = new CredentialSynchronizationError(
    "synthetic-provider",
    "login",
    { type: "api_key", key: "synthetic-key" },
    { cause: new Error("synthetic refresh failure") },
  );

  await assert.rejects(
    withModelsCacheInvalidation(async () => { throw failure; }),
    (error) => error === failure,
  );
  await loadModelsWithCache("post-commit-failure", load);
  assert.equal(loads, 2);
});
