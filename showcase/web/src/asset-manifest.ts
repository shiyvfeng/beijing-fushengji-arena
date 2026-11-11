import rawManifest from "../public/assets/asset-manifest.json";
import { isPermittedRuntimeAssetPath } from "./asset-path";

export type AssetId = keyof typeof rawManifest.assets;

export interface AssetSourceRecord {
  provider: string;
  generatedOn: string;
  seed: string;
  manualEdits: string;
  sha256: string;
  promptRecord: string;
  licenseOrReviewStatus: string;
  publicDistributionAllowed: boolean;
}

export interface AssetDefinition {
  id: AssetId;
  src: string | null;
  alt: string;
  aspectRatio: `${number} / ${number}`;
  source: AssetSourceRecord;
}

function validateAssetEntry(id: string, value: (typeof rawManifest.assets)[AssetId]): void {
  if (!isPermittedRuntimeAssetPath(value.relativePath)) {
    throw new Error(`素材 ${id} 必须使用 public/assets 下的本地相对路径或构建期内联图片`);
  }
  if (!/^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?$/.test(value.aspectRatio)) throw new Error(`素材 ${id} 的 aspectRatio 无效`);
  if (!/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error(`素材 ${id} 的 SHA-256 无效`);
  if (!value.alt.trim() || !value.promptRecord.startsWith("./assets/")) throw new Error(`素材 ${id} 缺少无障碍或溯源记录`);
}

export const ASSET_IDS = Object.keys(rawManifest.assets) as AssetId[];

// asset-manifest.json is the single auditable source of paths and provenance.
// This typed projection validates it at startup; presentation assets remain
// outside ReplayArtifact.factLayerHash.
export const assetManifest = Object.fromEntries(
  ASSET_IDS.map((id) => {
    const entry = rawManifest.assets[id];
    validateAssetEntry(id, entry);
    const definition: AssetDefinition = {
      id,
      src: entry.relativePath,
      alt: entry.alt,
      aspectRatio: entry.aspectRatio as `${number} / ${number}`,
      source: {
        provider: entry.source,
        generatedOn: entry.generatedOn,
        seed: entry.seed,
        manualEdits: entry.manualEdits,
        sha256: entry.sha256,
        promptRecord: entry.promptRecord,
        licenseOrReviewStatus: entry.licenseOrReviewStatus,
        publicDistributionAllowed: entry.publicDistributionAllowed,
      },
    };
    return [id, definition];
  }),
) as Record<AssetId, AssetDefinition>;
