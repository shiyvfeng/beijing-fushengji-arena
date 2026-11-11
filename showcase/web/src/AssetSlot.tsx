import { useState, type CSSProperties, type ReactNode } from "react";
import { assetManifest, type AssetId } from "./asset-manifest";

interface AssetSlotProps {
  assetId: AssetId;
  className?: string;
  fallback: ReactNode;
  loading?: "eager" | "lazy";
}

export function AssetSlot({ assetId, className, fallback, loading = "lazy" }: AssetSlotProps) {
  const definition = assetManifest[assetId];
  const [failed, setFailed] = useState(false);
  const style = { "--asset-ratio": definition.aspectRatio } as CSSProperties;

  if (!definition.src || failed) {
    return (
      <div className={`asset-slot asset-slot--fallback ${className ?? ""}`} style={style} data-asset-id={assetId}>
        {fallback}
      </div>
    );
  }

  return (
    <div className={`asset-slot ${className ?? ""}`} style={style} data-asset-id={assetId}>
      <img src={definition.src} alt={definition.alt} loading={loading} onError={() => setFailed(true)} />
    </div>
  );
}
