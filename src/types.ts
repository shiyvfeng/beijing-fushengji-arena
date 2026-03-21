// 商品定义
export interface Drug {
  id: number;
  name: string;
  basePrice: number;
  priceRange: number; // price = basePrice + random(0, priceRange)
}

// 商业事件（影响价格/赠送物品）
export interface MarketEvent {
  freq: number;
  msg: string;
  drug: number;    // 影响的商品ID
  plus: number;    // 价格乘数（0=不涨）
  minus: number;   // 价格除数（0=不跌）
  add: number;     // 赠送数量
}

// 健康事件
export interface HealthEvent {
  freq: number;
  msg: string;
  hurt: number;    // 扣减健康值
}

// 金钱事件
export interface StealEvent {
  freq: number;
  msg: string;
  ratio: number;   // 扣减百分比 money = money * (1 - ratio/100)
}

// 地点
export interface Location {
  id: number;
  name: string;
  map: "subway" | "surface";
}

// 游戏状态
export interface GameState {
  cash: number;
  debt: number;
  bank: number;
  health: number;
  fame: number;
  daysLeft: number;
  totalDays: number;
  capacity: number;     // 背包容量（100-140）
  currentLocation: number;
  currentMap: "subway" | "surface";
  inventory: number[];  // 8种商品的持有数量（-1=未持有，0+=数量）
  market: number[];     // 8种商品当前价格（0=缺货）
  priceHistory: number[][]; // 每天的价格记录 [day][drugId]
  gameOver: boolean;
  score: number;
  visitWangba: number;  // 网吧访问次数
  hackEnabled: boolean;
}

// Tool 返回值
export interface GameResponse {
  success: boolean;
  message: string;
  events: string[];
  state: GameState;
  gameOver: boolean;
  score: number;
}
