import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const sessionRoute = await jiti.import("../app/api/sessions/[id]/route.ts");
const sessionRouteSource = await readFile(
  new URL("../app/api/sessions/[id]/route.ts", import.meta.url),
  "utf8",
);

test("sessions/[id] exposes only GET and PATCH", () => {
  const exportNames = Object.getOwnPropertyNames(sessionRoute)
    .filter((name) => name !== "__esModule")
    .sort();

  assert.deepEqual(exportNames, ["GET", "PATCH"]);
  assert.equal(typeof sessionRoute.GET, "function");
  assert.equal(typeof sessionRoute.PATCH, "function");
});

test("sessions/[id] contains no permanent-deletion dependencies or logic", () => {
  assert.doesNotMatch(sessionRouteSource, /\bDELETE\b/);
  assert.doesNotMatch(
    sessionRouteSource,
    /\b(?:getRpcSession|invalidateSessionPathCache|readSessionHeader|readdirSync|readFileSync|unlinkSync|writeFileSync)\b/,
  );
  assert.doesNotMatch(sessionRouteSource, /from ["']path["']/);
});
