import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./patch.ts");
}

function codeRows(hunk) {
  return hunk.rows.filter((row) => row.type === "context" || row.type === "removed" || row.type === "added");
}

test("parses factual unified rows and trims four supplied edge lines to the nearest three", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`===================================================================
--- a/demo.ts
+++ b/demo.ts
@@ -10,9 +10,9 @@ function demo() {
 before-10
 before-11
 before-12
 before-13
-const value = "old";
+const value = "new";
 after-15
 after-16
 after-17
 after-18
`);

  assert.equal(files?.length, 1);
  assert.equal(files?.[0].oldPath, "a/demo.ts");
  assert.equal(files?.[0].newPath, "b/demo.ts");
  assert.equal(files?.[0].additions, 1);
  assert.equal(files?.[0].deletions, 1);
  const hunk = files?.[0].hunks[0];
  assert.ok(hunk);
  const { fullRows, ...visibleHunk } = hunk;
  assert.deepEqual(fullRows.map((row) => row.text), [
    "before-10", "before-11", "before-12", "before-13",
    'const value = "old";', 'const value = "new";',
    "after-15", "after-16", "after-17", "after-18",
  ]);
  assert.deepEqual(visibleHunk, {
    header: "@@ -10,9 +10,9 @@ function demo() {",
    oldStart: 10,
    oldCount: 9,
    newStart: 10,
    newCount: 9,
    rows: [
      { type: "omission", oldLineNo: 10, newLineNo: 10, count: 1 },
      { type: "context", oldLineNo: 11, newLineNo: 11, text: "before-11" },
      { type: "context", oldLineNo: 12, newLineNo: 12, text: "before-12" },
      { type: "context", oldLineNo: 13, newLineNo: 13, text: "before-13" },
      {
        type: "removed",
        oldLineNo: 14,
        newLineNo: null,
        text: 'const value = "old";',
        emphasis: { start: 15, end: 18 },
      },
      {
        type: "added",
        oldLineNo: null,
        newLineNo: 14,
        text: 'const value = "new";',
        emphasis: { start: 15, end: 18 },
      },
      { type: "context", oldLineNo: 15, newLineNo: 15, text: "after-15" },
      { type: "context", oldLineNo: 16, newLineNo: 16, text: "after-16" },
      { type: "context", oldLineNo: 17, newLineNo: 17, text: "after-17" },
      { type: "omission", oldLineNo: 18, newLineNo: 18, count: 1 },
    ],
  });
});

test("merges touching context windows and reports the true hidden count when they separate", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const separated = parseUnifiedPatch(`--- a/separated.ts
+++ b/separated.ts
@@ -1,9 +1,9 @@
-old-one
+new-one
 context-2
 context-3
 context-4
 context-5
 context-6
 context-7
 context-8
-old-nine
+new-nine
`);
  const separatedRows = separated?.[0].hunks[0].rows ?? [];
  assert.deepEqual(separatedRows.filter((row) => row.type === "omission"), [
    { type: "omission", oldLineNo: 5, newLineNo: 5, count: 1 },
  ]);
  assert.deepEqual(
    separatedRows.filter((row) => row.type === "context").map((row) => row.text),
    ["context-2", "context-3", "context-4", "context-6", "context-7", "context-8"],
  );

  const touching = parseUnifiedPatch(`--- a/touching.ts
+++ b/touching.ts
@@ -1,8 +1,8 @@
-old-one
+new-one
 context-2
 context-3
 context-4
 context-5
 context-6
 context-7
-old-eight
+new-eight
`);
  const touchingRows = touching?.[0].hunks[0].rows ?? [];
  assert.equal(touchingRows.some((row) => row.type === "omission"), false);
  assert.deepEqual(
    touchingRows.filter((row) => row.type === "context").map((row) => row.text),
    ["context-2", "context-3", "context-4", "context-5", "context-6", "context-7"],
  );
});

test("preserves multiple files, multiple hunks, zero-count ranges, and one-sided changes", async () => {
  const { getUnifiedDiffFileDisplayPath, parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+export const one = 1;
+export const two = 2;
diff --git a/old.ts b/old.ts
--- a/old.ts\t2026-08-21
+++ /dev/null\t2026-08-22
@@ -3,2 +0,0 @@
-remove-three
-remove-four
diff --git a/multi.ts b/multi.ts
--- a/multi.ts
+++ b/multi.ts
@@ -1 +1 @@
-old-first
+new-first
@@ -20 +20 @@
-old-second
+new-second
`);

  assert.equal(files?.length, 3);
  assert.deepEqual(files?.map((file) => [file.additions, file.deletions, file.hunks.length]), [
    [2, 0, 1],
    [0, 2, 1],
    [2, 2, 2],
  ]);
  const addedHunk = files?.[0].hunks[0];
  assert.ok(addedHunk);
  const { fullRows: addedFullRows, ...visibleAddedHunk } = addedHunk;
  assert.strictEqual(addedFullRows[0], addedHunk.rows[0], "visible factual rows retain full-hunk identity");
  assert.deepEqual(visibleAddedHunk, {
    header: "@@ -0,0 +1,2 @@",
    oldStart: 0,
    oldCount: 0,
    newStart: 1,
    newCount: 2,
    rows: [
      { type: "added", oldLineNo: null, newLineNo: 1, text: "export const one = 1;" },
      { type: "added", oldLineNo: null, newLineNo: 2, text: "export const two = 2;" },
    ],
  });
  assert.equal(files?.[1].oldPath, "a/old.ts");
  assert.equal(files?.[1].newPath, "/dev/null");
  assert.equal(getUnifiedDiffFileDisplayPath(files[0]), "new.ts");
  assert.equal(getUnifiedDiffFileDisplayPath(files[1]), "old.ts");
  assert.equal(getUnifiedDiffFileDisplayPath(files[2]), "multi.ts");
});

test("accepts only stateful metadata consistent with the completed file headers", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`Index: indexed.ts
===================================================================
--- indexed.ts
+++ indexed.ts
@@ -1 +1 @@
-old-indexed
+new-indexed
diff --git a/mode.ts b/mode.ts
old mode 100644
new mode 100755
index 1234567..89abcde
--- a/mode.ts
+++ b/mode.ts
@@ -1 +1 @@
-old-mode
+new-mode
`);

  assert.deepEqual(files?.map((file) => [file.oldPath, file.newPath, file.hunks.length]), [
    ["indexed.ts", "indexed.ts", 1],
    ["a/mode.ts", "b/mode.ts", 1],
  ]);
});

test("retains no-newline markers beside changed rows", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/demo.txt
+++ b/demo.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`);

  assert.deepEqual(files?.[0].hunks[0].rows, [
    { type: "removed", oldLineNo: 1, newLineNo: null, text: "old" },
    { type: "no-newline", oldLineNo: null, newLineNo: null, text: "\\ No newline at end of file" },
    { type: "added", oldLineNo: null, newLineNo: 1, text: "new" },
    { type: "no-newline", oldLineNo: null, newLineNo: null, text: "\\ No newline at end of file" },
  ]);
});

test("adds intra-line ranges only for conservatively paired replacements", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const reliable = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -1 +1 @@
-const first = "old";
+const first = "new";
`);
  const reliableRows = codeRows(reliable[0].hunks[0]);
  for (const row of reliableRows) assert.ok(row.emphasis, row.text);
  assert.equal(reliableRows[0].text.slice(reliableRows[0].emphasis.start, reliableRows[0].emphasis.end), "old");
  assert.equal(reliableRows[1].text.slice(reliableRows[1].emphasis.start, reliableRows[1].emphasis.end), "new");

  const positionalButAmbiguous = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -1,2 +1,2 @@
-const first = "old";
-const second = false;
+const first = "new";
+const second = true;
`);
  assert.equal(codeRows(positionalButAmbiguous[0].hunks[0]).some((row) => row.emphasis), false);

  const unequal = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -1,2 +1 @@
-old-one
-old-two
+new-one
`);
  assert.equal(codeRows(unequal[0].hunks[0]).some((row) => row.emphasis), false);

  const reordered = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -1,2 +1,2 @@
-const first = 1;
-const second = 2;
+const second = 2;
+const first = 1;
`);
  assert.equal(codeRows(reordered[0].hunks[0]).some((row) => row.emphasis), false);

  const editedReorder = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -1,2 +1,2 @@
-const first = old;
-const second = old;
+const second = new;
+const first = new;
`);
  assert.equal(codeRows(editedReorder[0].hunks[0]).some((row) => row.emphasis), false);

  const unrelated = parseUnifiedPatch(`--- a/demo.ts
+++ b/demo.ts
@@ -1 +1 @@
-foo
+bar
`);
  assert.equal(codeRows(unrelated[0].hunks[0]).some((row) => row.emphasis), false);
});

test("intra-line ranges never split surrogate pairs", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const files = parseUnifiedPatch(`--- a/emoji.ts
+++ b/emoji.ts
@@ -1 +1 @@
-const face = "😀";
+const face = "😃";
`);
  const rows = codeRows(files[0].hunks[0]);

  assert.equal(rows[0].text.slice(rows[0].emphasis.start, rows[0].emphasis.end), "😀");
  assert.equal(rows[1].text.slice(rows[1].emphasis.start, rows[1].emphasis.end), "😃");
});

test("bounds intra-line work without changing oversized row text", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const oldLine = `const value = "${"a".repeat(2_100)}";`;
  const newLine = `const value = "${"b".repeat(2_100)}";`;
  const files = parseUnifiedPatch(`--- a/large.ts
+++ b/large.ts
@@ -1 +1 @@
-${oldLine}
+${newLine}
`);
  const rows = codeRows(files[0].hunks[0]);

  assert.equal(rows[0].text, oldLine);
  assert.equal(rows[1].text, newLine);
  assert.equal(rows.some((row) => row.emphasis), false);
});

test("rejects patch text beyond the parser budget without partial structure", async () => {
  const { parseUnifiedPatch } = await loadSubject();
  const oversized = `--- a/large.ts\n+++ b/large.ts\n@@ -1 +1 @@\n-old\n+${"x".repeat(2 * 1024 * 1024)}\n`;
  assert.equal(parseUnifiedPatch(oversized), null);
});

test("returns null instead of guessing malformed or unsupported patch structure", async () => {
  const { parseUnifiedPatch } = await loadSubject();

  for (const text of [
    "not a patch",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ malformed\n-old\n+new\n",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new\n extra-body\n",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n+new\n-old\n",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new\nunknown trailing payload\n",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git unknown payload\n",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new\nindex arbitrary user payload\n",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new\nnew mode arbitrary user payload\n",
    "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old-x\n+new-x\ndiff --git a/y.ts b/y.ts\n@@ -1 +1 @@\n-old-y\n+new-y\n",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new\n===================================================================\n",
    "diff --git a/demo.ts b/other.ts\n--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new\n",
    "Index: attacker.ts\n===================================================================\n--- x.ts\n+++ x.ts\n@@ -1 +1 @@\n-old\n+new\n",
    "diff --git a/x.ts b/x.ts\nnew file mode 100644\ndeleted file mode 100644\n--- /dev/null\n+++ b/x.ts\n@@ -0,0 +1 @@\n+new\n",
    "diff --git a/x.ts b/x.ts\nrename from attacker.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n",
    "diff --git a/x.ts b/x.ts\nold mode 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n",
    "diff --git a/x.ts b/x.ts\nindex 0000000..1234567\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n",
    "--- a/demo.ts\n+++ b/demo.ts\n@@ -9007199254740993 +9007199254740993 @@\n-old\n+new\n",
    "--- a/demo.ts\n",
    "+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new\n",
  ]) {
    assert.equal(parseUnifiedPatch(text), null, text);
  }
});
