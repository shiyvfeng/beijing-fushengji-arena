import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPermittedRuntimeAssetPath, isPermittedRuntimeAudioPath } from "../src/asset-path.ts";

test("asset paths allow local source assets and build-time data images only", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/assets/asset-manifest.json", import.meta.url), "utf8"));
  assert.ok(Object.values<{ relativePath: string }>(manifest.assets).every((asset) => asset.relativePath.startsWith("./assets/")));
  assert.equal(isPermittedRuntimeAssetPath("./assets/illustrations/stage.png"), true);
  assert.equal(isPermittedRuntimeAssetPath("data:image/png;base64,AAAA"), true);
  assert.equal(isPermittedRuntimeAssetPath("https://cdn.example.com/stage.png"), false);
  assert.equal(isPermittedRuntimeAssetPath("//cdn.example.com/stage.png"), false);
  assert.equal(isPermittedRuntimeAssetPath("data:text/html;base64,AAAA"), false);
  assert.equal(isPermittedRuntimeAudioPath("./assets/audio/bgm.mp3"), true);
  assert.equal(isPermittedRuntimeAudioPath("data:audio/mpeg;base64,AAAA"), true);
  assert.equal(isPermittedRuntimeAudioPath("data:audio/wav;base64,AAAA"), true);
  assert.equal(isPermittedRuntimeAudioPath("data:text/html;base64,AAAA"), false);
});

test("Replay UI v1 image and private-demo audio manifests match audited files", () => {
  const images = JSON.parse(readFileSync(new URL("../public/assets/asset-manifest.json", import.meta.url), "utf8"));
  for (const asset of Object.values<any>(images.assets)) {
    const path = new URL(`../public/${asset.relativePath.replace(/^\.\//u, "")}`, import.meta.url);
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), asset.sha256);
  }
  const audio = JSON.parse(readFileSync(new URL("../public/assets/audio/audio-manifest.json", import.meta.url), "utf8"));
  for (const asset of Object.values<any>(audio.assets)) {
    const path = new URL(`../public/${asset.relativePath.replace(/^\.\//u, "")}`, import.meta.url);
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), asset.sha256);
    assert.equal(asset.usageScope, "private-demo-only");
    assert.equal(asset.publicDistributionAllowed, false);
  }
  const bgm = audio.assets["demo.bgm.happy-times"];
  assert.equal(bgm.usageScope, "private-demo-only");
  assert.equal(bgm.publicDistributionAllowed, false);
  assert.deepEqual(
    Object.keys(audio.assets).filter((id) => id.startsWith("highlight.gold1.voice.")).sort(),
    [
      "highlight.gold1.voice.dario-exit",
      "highlight.gold1.voice.deepseek-gamble",
      "highlight.gold1.voice.final-victory",
    ],
  );
});

test("舞台 idle 条带固定为六个方形帧，排名头像保持静态", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/assets/asset-manifest.json", import.meta.url), "utf8"));
  const stageIds = [
    "model.pet.stage.gpt-5.6-sol.idle",
    "model.pet.stage.anthropic.idle",
    "model.pet.stage.qwen.idle",
    "model.pet.stage.kimi.idle",
    "model.pet.stage.deepseek.idle",
  ];
  for (const id of stageIds) {
    const asset = manifest.assets[id];
    const path = new URL(`../public/${asset.relativePath.replace(/^\.\//u, "")}`, import.meta.url);
    const png = readFileSync(path);
    assert.equal(png.readUInt32BE(16), 1_536, `${id} 必须横排 6 个 256px 帧`);
    assert.equal(png.readUInt32BE(20), 256, `${id} 必须使用 256px 方形运行时单元`);
  }

  for (const id of ["model.avatar.gpt-5.6-sol", "model.avatar.anthropic", "model.avatar.qwen", "model.avatar.deepseek"]) {
    const asset = manifest.assets[id];
    const path = new URL(`../public/${asset.relativePath.replace(/^\.\//u, "")}`, import.meta.url);
    const png = readFileSync(path);
    assert.equal(png.readUInt32BE(16), 512);
    assert.equal(png.readUInt32BE(20), 512);
    assert.match(asset.manualEdits, /head-only-crop/u);
  }
  assert.equal(manifest.assets["model.pet.kimi"].relativePath.endsWith("kimi-orb.png"), true);
});
