import rawManifest from "../public/assets/audio/audio-manifest.json";
import { isPermittedRuntimeAudioPath } from "./asset-path";

export type AudioAssetId = keyof typeof rawManifest.assets;

export interface AudioAssetDefinition {
  id: AudioAssetId;
  src: string;
  durationSeconds: number;
  usageScope: "private-demo-only";
  publicDistributionAllowed: false;
}

export const audioManifest = Object.fromEntries(
  (Object.keys(rawManifest.assets) as AudioAssetId[]).map(id => {
    const entry = rawManifest.assets[id];
    if (!isPermittedRuntimeAudioPath(entry.relativePath)) throw new Error(`音频 ${id} 不是本地运行时素材`);
    if (!/^[a-f0-9]{64}$/u.test(entry.sha256) || entry.durationSeconds <= 0) throw new Error(`音频 ${id} 的审计信息无效`);
    if (entry.usageScope !== "private-demo-only" || entry.publicDistributionAllowed !== false) {
      throw new Error(`音频 ${id} 只能用于私有 Demo`);
    }
    const definition: AudioAssetDefinition = {
      id,
      src: entry.relativePath,
      durationSeconds: entry.durationSeconds,
      usageScope: "private-demo-only",
      publicDistributionAllowed: false,
    };
    return [id, definition];
  }),
) as Record<AudioAssetId, AudioAssetDefinition>;
