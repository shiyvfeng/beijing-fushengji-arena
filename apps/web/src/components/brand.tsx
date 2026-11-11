import type { CSSProperties } from 'react';
import { AssetSlot } from '../../../../showcase/web/src/AssetSlot';
import { assetManifest } from '../../../../showcase/web/src/asset-manifest';

const imageUrl = (id: keyof typeof assetManifest) => `url("${new URL(assetManifest[id].src!, document.baseURI).href}")`;
export const workspaceArtworkStyle = {
  '--workspace-art-wide': imageUrl('home.background.pixel-wide'),
  '--workspace-art-narrow': imageUrl('home.background.pixel-narrow'),
} as CSSProperties;

export function BrandArt({ className = '' }: { className?: string }) {
  return <AssetSlot assetId="home.hero.zhongguancun" className={`brand-art ${className}`} loading="eager" fallback={<span>北京浮生记 · 五模型竞技场</span>} />;
}
