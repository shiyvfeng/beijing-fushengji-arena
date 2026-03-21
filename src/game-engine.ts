import type { GameState, GameResponse } from "./types.js";
import {
  DRUGS, MARKET_EVENTS, HEALTH_EVENTS, STEAL_EVENTS, LOCATIONS,
  TOTAL_DAYS, INIT_CASH, INIT_DEBT, INIT_HEALTH, INIT_FAME,
  INIT_CAPACITY, MAX_CAPACITY, CAPACITY_INCREMENT,
  DEBT_INTEREST_RATE, BANK_INTEREST_RATE,
  HOSPITAL_COST_PER_POINT, DRUG_COUNT,
  FAME_LOSS_BANNED_BOOK, FAME_LOSS_FAKE_ALCOHOL,
  DEBT_CRISIS_THRESHOLD, DEBT_CRISIS_HEALTH_LOSS,
  MAX_WANGBA_VISITS, WANGBA_MIN_CASH,
} from "./game-data.js";

function randomNum(upper: number): number {
  return Math.floor(Math.random() * upper);
}

function min(a: number, b: number): number {
  return a < b ? a : b;
}

export class GameEngine {
  private state: GameState | null = null;

  private ensureGame(): GameState {
    if (!this.state || this.state.gameOver) {
      throw new Error("游戏未开始，请先调用 start_game");
    }
    return this.state;
  }

  private getInventoryTotal(): number {
    const s = this.ensureGame();
    let total = 0;
    for (let i = 0; i < DRUG_COUNT; i++) {
      if (s.inventory[i] > 0) total += s.inventory[i];
    }
    return total;
  }

  private makeResponse(message: string, events: string[]): GameResponse {
    const s = this.state!;
    return {
      success: true,
      message,
      events,
      state: { ...s, inventory: [...s.inventory], market: [...s.market], priceHistory: s.priceHistory.map(r => [...r]) },
      gameOver: s.gameOver,
      score: s.score,
    };
  }

  private errorResponse(message: string): GameResponse {
    return {
      success: false,
      message,
      events: [],
      state: this.state ?? this.emptyState(),
      gameOver: this.state?.gameOver ?? false,
      score: this.state?.score ?? 0,
    };
  }

  private emptyState(): GameState {
    return {
      cash: 0, debt: 0, bank: 0, health: 0, fame: 0,
      currentDay: 0, daysLeft: 0, totalDays: TOTAL_DAYS, capacity: INIT_CAPACITY,
      currentLocation: -1, currentMap: "subway",
      inventory: new Array(DRUG_COUNT).fill(-1),
      market: new Array(DRUG_COUNT).fill(0),
      priceHistory: [],
      gameOver: true, score: 0, visitWangba: 0, hackEnabled: false,
    };
  }

  // ===== 价格生成 =====
  // 从 SelectionDlg.cpp makeDrugPrices(int leaveout) 移植
  private makeDrugPrices(leaveout: number): void {
    const s = this.ensureGame();
    for (let i = 0; i < DRUG_COUNT; i++) {
      s.market[i] = DRUGS[i].basePrice + randomNum(DRUGS[i].priceRange);
    }
    // 随机 leaveout 个商品设为0（缺货）
    for (let i = 0; i < leaveout; i++) {
      s.market[randomNum(DRUG_COUNT)] = 0;
    }
  }

  // ===== 利息计算 =====
  // 从 HandleCashAndDebt() 移植
  private handleCashAndDebt(): void {
    const s = this.ensureGame();
    s.debt = s.debt + Math.floor(s.debt * DEBT_INTEREST_RATE);
    s.bank = s.bank + Math.floor(s.bank * BANK_INTEREST_RATE);
  }

  // ===== 商业事件 =====
  // 从 DoRandomStuff() 移植
  private doRandomStuff(events: string[]): void {
    const s = this.ensureGame();
    for (let i = 0; i < MARKET_EVENTS.length; i++) {
      const evt = MARKET_EVENTS[i];
      if (!(randomNum(950) % evt.freq)) {
        // 最后一个事件（村长卖手机）特殊处理：增加债务
        if (i === MARKET_EVENTS.length - 1) {
          s.debt += 2500;
        }
        // 赠送物品
        if (evt.add > 0) {
          const total = this.getInventoryTotal();
          let addCount = evt.add;
          if (evt.add + total > s.capacity) {
            addCount = s.capacity - total;
          }
          if (addCount > 0) {
            if (s.inventory[evt.drug] < 0) s.inventory[evt.drug] = 0;
            s.inventory[evt.drug] += addCount;
            events.push(evt.msg);
            if (addCount < evt.add) {
              events.push(`可惜!俺租的房子太小，只能放${s.capacity}个物品。`);
            }
          }
          continue;
        }
        // 价格变动（仅当该商品有货时）
        if (s.market[evt.drug] > 0) {
          if (evt.plus > 0) {
            s.market[evt.drug] *= evt.plus;
          }
          if (evt.minus > 0) {
            s.market[evt.drug] = Math.floor(s.market[evt.drug] / evt.minus);
          }
          events.push(evt.msg);
        }
      }
    }
  }

  // ===== 健康事件 + 金钱事件 =====
  // 从 DoRandomEvent() + OnSteal() 移植
  private doRandomEvent(events: string[]): void {
    const s = this.ensureGame();

    // 健康事件
    for (const evt of HEALTH_EVENTS) {
      if (!(randomNum(1000) % evt.freq)) {
        s.health -= evt.hurt;
        events.push(evt.msg + ` (健康-${evt.hurt})`);
      }
    }

    // 强制住院：健康<85且剩余>3天
    if (s.health < 85 && s.daysLeft > 3) {
      const delayDay = 1 + randomNum(2); // 1-2天
      const cost = delayDay * (1000 + randomNum(8500));
      s.debt += cost;
      s.health += 10;
      if (s.health > 100) s.health = 100;
      s.daysLeft -= delayDay;
      s.currentDay += delayDay;
      events.push(`健康状况不佳，被迫住院${delayDay}天，医疗费${cost}元计入债务。(健康+10)`);
    }

    // 健康警告
    if (s.health < 20 && s.health > 0) {
      events.push("警告：健康值过低(<20)，有生命危险!");
    }

    // 死亡判定
    if (s.health <= 0) {
      s.health = 0;
      s.gameOver = true;
      s.score = s.cash + s.bank - s.debt;
      events.push("俺死了...游戏结束。");
      return;
    }

    // 金钱事件
    for (let i = 0; i < STEAL_EVENTS.length; i++) {
      const evt = STEAL_EVENTS[i];
      if (!(randomNum(1000) % evt.freq)) {
        if (i === 5) {
          // 第6个事件：扣银行存款
          if (s.bank > 0) {
            s.bank = Math.floor((s.bank / 100) * (100 - evt.ratio));
          }
        } else {
          // 其他事件：扣现金
          s.cash = Math.floor((s.cash / 100) * (100 - evt.ratio));
        }
        if (s.cash < 0) s.cash = 0;
        events.push(evt.msg);
      }
    }

    // 黑客事件（如果启用）
    if (s.hackEnabled && !(randomNum(1000) % 25)) {
      if (s.bank > 1000) {
        if (s.bank > 100000) {
          const num = Math.floor(s.bank / (2 + randomNum(20)));
          if (randomNum(3) < 2) {
            s.bank -= num;
            events.push(`黑客入侵了您的银行账户，损失${num}元!`);
          } else {
            s.bank += num;
            events.push(`黑客误操作，您的银行账户意外多了${num}元!`);
          }
        } else {
          const num = Math.floor(s.bank / (1 + randomNum(15)));
          s.bank += num;
          events.push(`网络漏洞让您的银行账户多了${num}元!`);
        }
      }
    }
  }

  // ===== 回合结束检查 =====
  private checkGameEnd(events: string[]): void {
    const s = this.ensureGame();

    // 债务危机
    if (s.debt > DEBT_CRISIS_THRESHOLD) {
      s.health -= DEBT_CRISIS_HEALTH_LOSS;
      events.push(`债务超过${DEBT_CRISIS_THRESHOLD}元!压力巨大，健康-${DEBT_CRISIS_HEALTH_LOSS}。`);
      if (s.health <= 0) {
        s.health = 0;
        s.gameOver = true;
        s.score = s.cash + s.bank - s.debt;
        events.push("欠债太多，压力过大，俺倒下了...游戏结束。");
        return;
      }
    }

    // 最后1天警告
    if (s.daysLeft === 1) {
      events.push("明天就要离开北京了！赶紧卖掉所有货物!");
    }

    // 游戏结束
    if (s.daysLeft <= 0) {
      s.daysLeft = 0;
      events.push("俺已经在北京40天了，该回去结婚去了。");
      // 强制卖出所有库存
      let sellTotal = 0;
      for (let i = 0; i < DRUG_COUNT; i++) {
        if (s.inventory[i] > 0 && s.market[i] > 0) {
          const gain = s.inventory[i] * s.market[i];
          sellTotal += gain;
          s.cash += gain;
          events.push(`自��卖出 ${DRUGS[i].name} x${s.inventory[i]}，得${gain}元`);
          s.inventory[i] = -1;
        }
      }
      if (sellTotal > 0) {
        events.push(`共回收${sellTotal}元。`);
      }
      s.gameOver = true;
      s.score = s.cash + s.bank - s.debt;
      if (s.score > 0) {
        events.push(`最终得分：${s.score}元`);
      } else {
        events.push(`玩家在北京没挣着钱，被遣送回家。最终得分：${s.score}元`);
      }
    }
  }

  // ===== 记录价格历史 =====
  private recordPriceHistory(): void {
    const s = this.ensureGame();
    s.priceHistory.push([...s.market]);
  }

  // ==================== 公开方法 ====================

  startGame(): GameResponse {
    this.state = {
      cash: INIT_CASH,
      debt: INIT_DEBT,
      bank: 0,
      health: INIT_HEALTH,
      fame: INIT_FAME,
      currentDay: 0,
      daysLeft: TOTAL_DAYS,
      totalDays: TOTAL_DAYS,
      capacity: INIT_CAPACITY,
      currentLocation: -1,
      currentMap: "subway",
      inventory: new Array(DRUG_COUNT).fill(-1),
      market: new Array(DRUG_COUNT).fill(0),
      priceHistory: [],
      gameOver: false,
      score: 0,
      visitWangba: 0,
      hackEnabled: false,
    };
    // 生成初始价格
    this.makeDrugPrices(3);
    this.handleCashAndDebt();
    this.recordPriceHistory();
    return this.makeResponse(
      "北京浮生记开始！你是铁牛，带着2000元现金和5000元债务来到北京。在40天内想办法发家致富吧！",
      ["游戏开始。现金2000元，债务5000元（每天+10%利息）。选择一个地点开始你的旅程。"],
    );
  }

  move(locationId: number): GameResponse {
    const s = this.ensureGame();
    if (s.gameOver) return this.errorResponse("游戏已结束。");

    const loc = LOCATIONS.find(l => l.id === locationId);
    if (!loc) return this.errorResponse(`无效地点ID: ${locationId}。有效范围: 0-19`);
    if (loc.id === s.currentLocation) return this.errorResponse("你已经在这个地点了。");

    const events: string[] = [];
    s.currentLocation = loc.id;
    s.currentMap = loc.map;

    // 回合推进（忠于原版顺序）
    const leaveout = s.daysLeft <= 2 ? 0 : 3;
    this.makeDrugPrices(leaveout);
    this.handleCashAndDebt();
    this.doRandomStuff(events);
    this.recordPriceHistory();
    this.doRandomEvent(events);
    s.daysLeft--;
    s.currentDay++;
    this.checkGameEnd(events);

    return this.makeResponse(`到达${loc.name}。`, events);
  }

  buy(itemId: number, quantity: number): GameResponse {
    const s = this.ensureGame();
    if (s.gameOver) return this.errorResponse("游戏已结束。");
    if (s.currentLocation < 0) return this.errorResponse("请先��动到一个地点。");
    if (itemId < 0 || itemId >= DRUG_COUNT) return this.errorResponse(`无效商品ID: ${itemId}。有效范围: 0-7`);
    if (quantity <= 0) return this.errorResponse("数量必须大于0。");

    const price = s.market[itemId];
    if (price <= 0) return this.errorResponse(`${DRUGS[itemId].name} 目前缺货。`);

    const maxAfford = Math.floor(s.cash / price);
    if (maxAfford <= 0) return this.errorResponse(`现金不足，买不起${DRUGS[itemId].name}。（单价${price}元，现金${s.cash}元）`);

    const total = this.getInventoryTotal();
    const spaceLeft = s.capacity - total;
    const maxBuy = min(min(quantity, maxAfford), spaceLeft);

    if (maxBuy <= 0) return this.errorResponse(`背包已满（${total}/${s.capacity}），无法购买更多物品。`);

    if (s.inventory[itemId] < 0) s.inventory[itemId] = 0;
    s.inventory[itemId] += maxBuy;
    s.cash -= price * maxBuy;

    const msg = maxBuy < quantity
      ? `买入 ${DRUGS[itemId].name} x${maxBuy}（请求${quantity}个，受限于${maxBuy < maxAfford ? "背包容量" : "现金不足"}），花费${price * maxBuy}元。`
      : `买入 ${DRUGS[itemId].name} x${maxBuy}，花费${price * maxBuy}元。`;

    return this.makeResponse(msg, []);
  }

  sell(itemId: number, quantity: number): GameResponse {
    const s = this.ensureGame();
    if (s.gameOver) return this.errorResponse("游戏已结束。");
    if (s.currentLocation < 0) return this.errorResponse("请先移动到一个地点。");
    if (itemId < 0 || itemId >= DRUG_COUNT) return this.errorResponse(`无效商品ID: ${itemId}。有效范围: 0-7`);
    if (quantity <= 0) return this.errorResponse("数量必须大于0。");

    if (s.inventory[itemId] <= 0) return this.errorResponse(`你没有${DRUGS[itemId].name}可卖。`);

    const price = s.market[itemId];
    if (price <= 0) return this.errorResponse(`${DRUGS[itemId].name} 目前无人收购（缺货状态）。`);

    const sellCount = min(quantity, s.inventory[itemId]);
    s.cash += price * sellCount;
    s.inventory[itemId] -= sellCount;
    if (s.inventory[itemId] === 0) s.inventory[itemId] = -1;

    const events: string[] = [];

    // 卖禁书/假酒扣声望
    if (itemId === 4) {
      s.fame -= FAME_LOSS_BANNED_BOOK;
      if (s.fame < 0) s.fame = 0;
      events.push(`买卖《上海小宝贝》（禁书），污染社会,俺的名声变坏了啊! (声望-${FAME_LOSS_BANNED_BOOK})`);
      if (s.fame < 60) events.push("警告：声望过低!");
    }
    if (itemId === 3) {
      s.fame -= FAME_LOSS_FAKE_ALCOHOL;
      if (s.fame < 0) s.fame = 0;
      events.push(`买卖假白酒（剧毒！），危害社会，俺的名声下降了. (声望-${FAME_LOSS_FAKE_ALCOHOL})`);
      if (s.fame < 60) events.push("警告：声望过低!");
    }

    return this.makeResponse(
      `卖出 ${DRUGS[itemId].name} x${sellCount}，得${price * sellCount}元。`,
      events,
    );
  }

  bankDeposit(amount: number): GameResponse {
    const s = this.ensureGame();
    if (s.gameOver) return this.errorResponse("游戏已结束。");
    if (amount <= 0) return this.errorResponse("金额必须大于0。");
    if (amount > s.cash) return this.errorResponse(`现金不足。当前现金${s.cash}元。`);

    s.cash -= amount;
    s.bank += amount;
    return this.makeResponse(`存入${amount}元。现金${s.cash}元，存款${s.bank}元。`, []);
  }

  bankWithdraw(amount: number): GameResponse {
    const s = this.ensureGame();
    if (s.gameOver) return this.errorResponse("游戏已结束。");
    if (amount <= 0) return this.errorResponse("金额必须大于0。");
    if (amount > s.bank) return this.errorResponse(`存款不足。当前存款${s.bank}元。`);

    s.bank -= amount;
    s.cash += amount;
    return this.makeResponse(`取出${amount}元。现金${s.cash}元，存款${s.bank}元。`, []);
  }

  repayDebt(amount: number): GameResponse {
    const s = this.ensureGame();
    if (s.gameOver) return this.errorResponse("游戏已结束。");
    if (s.debt <= 0) return this.errorResponse("你没有债务了!");
    if (amount <= 0) return this.errorResponse("金额必须大于0。");
    if (amount > s.cash) return this.errorResponse(`现金不足。当前现金${s.cash}元，债务${s.debt}元。`);

    const repay = min(amount, s.debt);
    s.cash -= repay;
    s.debt -= repay;

    const msg = s.debt === 0
      ? `还清了所有债务!还款${repay}元。`
      : `还款${repay}元。剩余债务${s.debt}元。`;

    return this.makeResponse(msg, []);
  }

  hospital(healPoints: number): GameResponse {
    const s = this.ensureGame();
    if (s.gameOver) return this.errorResponse("游戏已结束。");
    if (s.health >= 100) return this.errorResponse("你的健康值已满(100)，不需要治疗。");
    if (healPoints <= 0) return this.errorResponse("治疗点数必须大于0。");

    const maxHeal = 100 - s.health;
    const actual = min(healPoints, maxHeal);
    const cost = actual * HOSPITAL_COST_PER_POINT;

    if (cost > s.cash) return this.errorResponse(`钱不够哎! 治疗${actual}点需要${cost}元，现金只有${s.cash}元。`);

    s.health += actual;
    s.cash -= cost;
    return this.makeResponse(`治疗${actual}点健康，花费${cost}元。当前健康${s.health}。`, []);
  }

  rentHouse(): GameResponse {
    const s = this.ensureGame();
    if (s.gameOver) return this.errorResponse("游戏已结束。");
    if (s.capacity >= MAX_CAPACITY) return this.errorResponse(`房子已经最大了(${MAX_CAPACITY}个物品)，不能再扩容。`);
    if (s.cash < 30000) return this.errorResponse(`现金不足30000元，无法租更大的房子。当前现金${s.cash}元。`);

    let cost: number;
    if (s.cash <= 30000) {
      cost = 25000;
    } else {
      cost = Math.floor(s.cash / 2) + 2000;
    }
    s.cash -= cost;
    s.capacity += CAPACITY_INCREMENT;

    return this.makeResponse(
      `我的房子可以放${s.capacity}个物品了!可是，好象中介公司骗了我一些钱...（花费${cost}元）`,
      [],
    );
  }

  getStatus(): GameResponse {
    if (!this.state) return this.errorResponse("游戏未开始，请先调用 start_game。");

    const s = this.state;
    const total = this.getInventoryTotal();
    const lines: string[] = [
      `=== 北京浮生记 (第${s.currentDay}/${s.totalDays}天) ===`,
      `现金: ${s.cash}元 | 存款: ${s.bank}元 | 债务: ${s.debt}元`,
      `健康: ${s.health}/100 | 声望: ${s.fame} | 背包: ${total}/${s.capacity}`,
      `当前位置: ${s.currentLocation >= 0 ? LOCATIONS[s.currentLocation].name : "未选择"} (${s.currentMap === "subway" ? "地铁" : "地面"})`,
      "",
      "--- 当前市场 ---",
    ];

    for (let i = 0; i < DRUG_COUNT; i++) {
      const held = s.inventory[i] > 0 ? s.inventory[i] : 0;
      const priceStr = s.market[i] > 0 ? `${s.market[i]}元` : "缺货";
      lines.push(`[${i}] ${DRUGS[i].name}: ${priceStr} (持有: ${held})`);
    }

    lines.push("");
    lines.push("--- 可选地点 ---");
    const mapLocs = LOCATIONS.filter(l => l.map === s.currentMap);
    for (const loc of mapLocs) {
      const marker = loc.id === s.currentLocation ? " <-- 当前" : "";
      lines.push(`[${loc.id}] ${loc.name}${marker}`);
    }
    lines.push(`(切换到${s.currentMap === "subway" ? "地面" : "地铁"}线路可访问更多地点)`);

    // 价格历史
    if (s.priceHistory.length > 1) {
      lines.push("");
      lines.push("--- 价格历史 (最近5天) ---");
      const recent = s.priceHistory.slice(-5);
      const startDay = s.priceHistory.length - recent.length;
      const header = "天数\\商品 | " + DRUGS.map(d => d.name.slice(0, 4).padEnd(6)).join(" | ");
      lines.push(header);
      for (let d = 0; d < recent.length; d++) {
        const dayLabel = `第${startDay + d + 1}天`.padEnd(9);
        const prices = recent[d].map(p => (p > 0 ? String(p) : "-").padEnd(6)).join(" | ");
        lines.push(`${dayLabel} | ${prices}`);
      }
    }

    return this.makeResponse(lines.join("\n"), []);
  }
}
