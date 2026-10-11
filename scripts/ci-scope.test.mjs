import { test } from "node:test";
import assert from "node:assert/strict";
import { ciScope } from "./ci-scope.mjs";

test("routine changes select affected fixtures without a full flow", () => {
  assert.deepEqual(
    ciScope({
      changed: [
        "src/application/service.ts",
        "tests/persistence.test.ts",
        "tests/ui/packsize.spec.ts",
        "docs/testing.md",
      ],
    }),
    {
      full: false,
      unit: ["tests/persistence.test.ts"],
      ui: [],
    },
  );
});
test("version, documentation and promotion do not request a full release", () => {
  for (const changed of [
    [],
    ["package.json", "package-lock.json"],
    ["docs/roadmap.md"],
  ])
    assert.deepEqual(ciScope({ changed }), { full: false, unit: [], ui: [] });
});
test("only explicit release mode requests the full flow", () => {
  assert.deepEqual(ciScope({ mode: "release" }), {
    full: true,
    unit: [],
    ui: [],
  });
  assert.throws(() => ciScope({ mode: "unexpected" }));
});
test("failed checks can be rerun with bounded paths and no command injection", () => {
  assert.deepEqual(
    ciScope({
      mode: "focused",
      unit: "tests/persistence.test.ts tests/persistence.test.ts",
      ui: "tests/ui/packsize.spec.ts",
    }),
    {
      full: false,
      unit: ["tests/persistence.test.ts"],
      ui: ["tests/ui/packsize.spec.ts"],
    },
  );
  assert.throws(() => ciScope({ mode: "focused" }));
  for (const unit of [
    "../private.test.ts",
    "tests/../private.test.ts",
    "tests/persistence.test.ts;whoami",
    "tests/ui/packsize.spec.ts",
  ])
    assert.throws(() => ciScope({ mode: "focused", unit }));
});
