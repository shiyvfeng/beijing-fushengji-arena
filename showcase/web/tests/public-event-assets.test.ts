import assert from "node:assert/strict";
import test from "node:test";

import { publicEventAsset } from "../src/public-event-assets.ts";

test("Gold1 公共事件 catalog ID 映射到各自素材", () => {
  for (const catalogEventId of [
    "market-01", "market-04", "market-05", "market-06", "market-07", "market-08",
    "market-09", "market-10", "market-12", "market-13", "market-14",
  ]) {
    assert.equal(
      publicEventAsset({ id: `global-${catalogEventId}`, catalogEventId, title: "公共市场事件", summary: "事实摘要" }),
      `event.gold1.${catalogEventId}`,
    );
  }
});

test("未知或旧格式公共事件保留既有回退图", () => {
  assert.equal(
    publicEventAsset({ id: "legacy-inspection", title: "突击检查", summary: "检查人员正在清点摊位" }),
    "event.inspection",
  );
  assert.equal(
    publicEventAsset({ id: "unknown-market", catalogEventId: "market-99", title: "公共市场事件", summary: "价格发生变化" }),
    "event.market.volatility",
  );
});
