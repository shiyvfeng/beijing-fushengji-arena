import type { AssetId } from "./asset-manifest";
import type { PublicEvent } from "./replay-types";

const GOLD1_PUBLIC_EVENT_ASSETS = {
  "market-01": "event.gold1.market-01",
  "market-04": "event.gold1.market-04",
  "market-05": "event.gold1.market-05",
  "market-06": "event.gold1.market-06",
  "market-07": "event.gold1.market-07",
  "market-08": "event.gold1.market-08",
  "market-09": "event.gold1.market-09",
  "market-10": "event.gold1.market-10",
  "market-12": "event.gold1.market-12",
  "market-13": "event.gold1.market-13",
  "market-14": "event.gold1.market-14",
} as const satisfies Partial<Record<string, AssetId>>;

export function publicEventAsset(event: PublicEvent): AssetId {
  const curated = event.catalogEventId
    ? GOLD1_PUBLIC_EVENT_ASSETS[event.catalogEventId as keyof typeof GOLD1_PUBLIC_EVENT_ASSETS]
    : undefined;
  if (curated) return curated;
  return /检查|执法|清点|查处/u.test(`${event.title} ${event.summary}`)
    ? "event.inspection"
    : "event.market.volatility";
}
