# Arena 展示模块

这是统一 Arena 项目中的展示源码，日常安装、运行和预览均从仓库根目录执行，见 [快速开始](../README.md)。无需另行克隆原 Showcase 仓库。

- `web/`：React 展示端，含首页、玩法、回放、事实高光、历史 Bench 分析。
- `samples/`：两个历史 Replay 的白名单快照，hash 保持不变。
- `curation/`：Gold1 的人工精选高光；仅绑定对应 Replay。
- `scripts/`：单文件导出及旧私有发布工具。

当前新比赛入口：根目录 `npm run arena:view -- --input <replay.json>`。它展示本场比赛，不把 Gold1/Gold2 的历史 Bench 数据冒充本场分析；历史 Bench 源码及脱敏汇总仍保留。

`npm test` 在此目录运行只检查源码测试及类型。原始归档未随源码导入，所以 `verify:archive` 和 `build:bench-data` 仅能在原私有仓库使用。原有私有发布流程存于 [历史说明](LEGACY_README.md)，不是统一项目的快速开始。音频清单仍标注 private-demo-only，统一静态站点不分发这些音频。

来源提交与导入边界见 [统一项目说明](../docs/unified-project.md)；更早的来源记录保存在 [PROVENANCE.md](PROVENANCE.md)。
