import type { Drug, MarketEvent, HealthEvent, StealEvent, Location } from "./types.js";

// ========== 8种商品 ==========
// 直接从 SelectionDlg.cpp 移植
export const DRUGS: Drug[] = [
  { id: 0, name: "进口香烟", basePrice: 100, priceRange: 350 },
  { id: 1, name: "走私汽车", basePrice: 15000, priceRange: 15000 },
  { id: 2, name: "盗版VCD、游戏", basePrice: 5, priceRange: 50 },
  { id: 3, name: "假白酒（剧毒！）", basePrice: 1000, priceRange: 2500 },
  { id: 4, name: "上海小宝贝（禁书）", basePrice: 5000, priceRange: 9000 },
  { id: 5, name: "进口玩具", basePrice: 250, priceRange: 600 },
  { id: 6, name: "水货手机", basePrice: 750, priceRange: 750 },
  { id: 7, name: "伪劣化妆品", basePrice: 65, priceRange: 180 },
];

// ========== 18种商业事件 ==========
// gameMessages[] from SelectionDlg.cpp
export const MARKET_EVENTS: MarketEvent[] = [
  { freq: 170, msg: `专家提议提高大学生\u201c动手素质\u201d，进口玩具颇受欢迎!`, drug: 5, plus: 2, minus: 0, add: 0 },
  { freq: 139, msg: `有人自豪地说：生病不用打针吃药，喝假白酒（剧毒）就可以!`, drug: 3, plus: 3, minus: 0, add: 0 },
  { freq: 100, msg: `医院的秘密报告：\u201c上海小宝贝功效甚过伟哥\u201d!`, drug: 4, plus: 5, minus: 0, add: 0 },
  { freq: 41, msg: `文盲说：\u201c2000年诺贝尔文学奖？呸！不如盗版VCD港台片。\u201d`, drug: 2, plus: 4, minus: 0, add: 0 },
  { freq: 37, msg: `北京经济小报社论：\u201c走私汽车大力推进汽车消费!\u201d`, drug: 1, plus: 3, minus: 0, add: 0 },
  { freq: 23, msg: `北京真理报社论：\u201c提倡爱美，落到实处\u201d，伪劣化妆品大受欢迎!`, drug: 7, plus: 4, minus: 0, add: 0 },
  { freq: 37, msg: `8858.com电子书店也不敢卖上海小宝贝，黑市一册可卖天价!`, drug: 4, plus: 8, minus: 0, add: 0 },
  { freq: 15, msg: `谢不疯在晚会上说：\u201c我酷!我使用伪劣化妆品!\u201d，伪劣化妆品供不应求!`, drug: 7, plus: 7, minus: 0, add: 0 },
  { freq: 40, msg: `北京有人狂饮山西假酒，可以卖出天价!`, drug: 3, plus: 7, minus: 0, add: 0 },
  { freq: 29, msg: `北京的大学生们开始找工作，水货手机大受欢迎!`, drug: 6, plus: 7, minus: 0, add: 0 },
  { freq: 35, msg: `北京的富人疯狂地购买走私汽车！价格狂升!`, drug: 1, plus: 8, minus: 0, add: 0 },
  { freq: 17, msg: `市场上充斥着来自福建的走私香烟!`, drug: 0, plus: 0, minus: 8, add: 0 },
  { freq: 24, msg: `北京的孩子们都忙于上网学习，进口玩具没人愿意买。`, drug: 5, plus: 0, minus: 5, add: 0 },
  { freq: 18, msg: `盗版业十分兴旺，\u201c中国硅谷\u201d\u2014\u2014中关村全是卖盗版VCD的村姑!`, drug: 2, plus: 0, minus: 8, add: 0 },
  { freq: 160, msg: `厦门的老同学资助俺两部走私汽车！发了！！`, drug: 1, plus: 0, minus: 0, add: 2 },
  { freq: 45, msg: `工商局扫荡后，俺在黑暗角落里发现了老乡丢失的进口香烟。`, drug: 0, plus: 0, minus: 0, add: 6 },
  { freq: 35, msg: `俺老乡回家前把一些山西假白酒（剧毒）给俺!`, drug: 3, plus: 0, minus: 0, add: 4 },
  { freq: 140, msg: `媒体报道：又有日本出口到中国的产品出事了!出事后日本人死不认帐,拒绝赔偿。村长得知此消息，托人把他用的水货手机（无任何厂商标识）硬卖给您，收您2500元。`, drug: 6, plus: 0, minus: 0, add: 1 },
];

// ========== 12种健康事件 ==========
// random_event[] from SelectionDlg.cpp
export const HEALTH_EVENTS: HealthEvent[] = [
  { freq: 117, msg: "大街上两个流氓打了俺!", hurt: 3 },
  { freq: 157, msg: "俺在过街地道被人打了蒙棍!", hurt: 20 },
  { freq: 21, msg: "工商局的追俺超过三个胡同。", hurt: 1 },
  { freq: 100, msg: "北京拥挤的交通让俺心焦!", hurt: 1 },
  { freq: 35, msg: "开小巴的打俺一耳光!", hurt: 1 },
  { freq: 313, msg: "一群民工打了俺!", hurt: 10 },
  { freq: 120, msg: "附近胡同的一个小青年砸俺一砖头!", hurt: 5 },
  { freq: 29, msg: "附近写字楼一个假保安用电棍电击俺!", hurt: 3 },
  { freq: 43, msg: "北京臭黑的小河熏着我了!", hurt: 1 },
  { freq: 45, msg: "守自行车的王大婶嘲笑俺没北京户口!", hurt: 1 },
  { freq: 48, msg: "北京高温40度!俺热...", hurt: 1 },
  { freq: 33, msg: "申奥添了新风景，北京又来沙尘暴!", hurt: 1 },
];

// ========== 7种金钱事件 ==========
// random_steal_event[] from SelectionDlg.cpp
export const STEAL_EVENTS: StealEvent[] = [
  { freq: 60, msg: "俺怜悯地铁口扮演成乞丐的老太太。", ratio: 10 },
  { freq: 125, msg: `一个汉子在街头拦住俺：\u201c哥们，给点钱用!\u201d。`, ratio: 10 },
  { freq: 100, msg: `一个大个子碰了俺一下，说：\u201c别挤了!\u201d。`, ratio: 40 },
  { freq: 65, msg: `三个带红袖章的老太太揪住俺：\u201c你是外地人?罚款!\u201d`, ratio: 20 },
  { freq: 35, msg: `两个猛男揪住俺：\u201c交长话附加费、上网费。\u201d`, ratio: 15 },
  { freq: 27, msg: `副主任说：\u201c办经商证?晚上不要去我家给我送钱哦。\u201d`, ratio: 10 },
  { freq: 40, msg: "北京空气污染得厉害,俺去氧吧吸氧...", ratio: 5 },
];

// ========== 地点 ==========
// 从 OnGoShanghai() 和 OnLocXxx() 函数提取
export const LOCATIONS: Location[] = [
  // 地铁线路（默认）
  { id: 0, name: "西直门", map: "subway" },
  { id: 1, name: "复兴门", map: "subway" },
  { id: 2, name: "积水潭", map: "subway" },
  { id: 3, name: "东直门", map: "subway" },
  { id: 4, name: "建国门", map: "subway" },
  { id: 5, name: "北京站", map: "subway" },
  { id: 6, name: "崇文门", map: "subway" },
  { id: 7, name: "长椿街", map: "subway" },
  { id: 8, name: "公主坟", map: "subway" },
  { id: 9, name: "苹果园", map: "subway" },
  // 地面线路
  { id: 10, name: "海淀大街", map: "surface" },
  { id: 11, name: "府右街", map: "surface" },
  { id: 12, name: "亚运村", map: "surface" },
  { id: 13, name: "三元西桥", map: "surface" },
  { id: 14, name: "永安里", map: "surface" },
  { id: 15, name: "方庄", map: "surface" },
  { id: 16, name: "永定门", map: "surface" },
  { id: 17, name: "玉泉营", map: "surface" },
  { id: 18, name: "翠微路", map: "surface" },
  { id: 19, name: "八角西路", map: "surface" },
];

// ========== 游戏常量 ==========
export const TOTAL_DAYS = 40;
export const INIT_CASH = 2000;
export const INIT_DEBT = 5000;
export const INIT_HEALTH = 100;
export const INIT_FAME = 100;
export const INIT_CAPACITY = 100;
export const MAX_CAPACITY = 140;
export const CAPACITY_INCREMENT = 10;
export const DEBT_INTEREST_RATE = 0.10;
export const BANK_INTEREST_RATE = 0.01;
export const HOSPITAL_COST_PER_POINT = 3500;
export const DRUG_COUNT = 8;
export const FAME_LOSS_BANNED_BOOK = 7;   // 卖禁书扣声望
export const FAME_LOSS_FAKE_ALCOHOL = 10; // 卖假白酒扣声望
export const DEBT_CRISIS_THRESHOLD = 100000;
export const DEBT_CRISIS_HEALTH_LOSS = 30;
export const MAX_WANGBA_VISITS = 3;
export const WANGBA_MIN_CASH = 15;
