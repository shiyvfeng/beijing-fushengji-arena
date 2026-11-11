import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPermittedRuntimeAssetPath } from "../src/asset-path.ts";

test("asset paths allow local source assets and build-time data images only", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/assets/asset-manifest.json", import.meta.url), "utf8"));
  assert.ok(Object.values<{ relativePath: string }>(manifest.assets).every((asset) => asset.relativePath.startsWith("./assets/")));
  assert.equal(isPermittedRuntimeAssetPath("./assets/illustrations/stage.png"), true);
  assert.equal(isPermittedRuntimeAssetPath("data:image/png;base64,AAAA"), true);
  assert.equal(isPermittedRuntimeAssetPath("https://cdn.example.com/stage.png"), false);
  assert.equal(isPermittedRuntimeAssetPath("//cdn.example.com/stage.png"), false);
  assert.equal(isPermittedRuntimeAssetPath("data:text/html;base64,AAAA"), false);
});
