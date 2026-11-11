# Runner 与 Showcase 统一项目

本文记录此前源码整合和 CLI＋静态展示方式。现已实现前端模型/任务控制台与后端 Bench 服务，当前入口见 [Web 应用运行说明](web-app.md)。下文四份 lockfile 等说明属于整合时的历史状态；当前使用一份根 lockfile。

## 目标与来源

一个仓库安装依赖、配置模型、运行五模型比赛、观看完整回放。采用源码整合，不使用 Git submodule，不要求用户克隆兄弟目录。

- Arena 基线：`4f16210bcc2f3bce8b0601f842ad6149a34bc71a`。
- Showcase 来源：`https://github.com/shiyvfeng/beijing-fushengji-arena-showcase`，提交 `d9866077794512549aafea37c6b8e4f8476c3381`。
- Showcase 按提交对象提取 `web/`、`scripts/`、`samples/`、`curation/`、测试与锁文件等，放入本仓库 `showcase/`，随后修改统一入口。
- 原仓库及其历史、完整私有 `archive/`、旧 `release/`、诊断文件不移动、不删除，不进入新用户运行依赖。
- 保留原 LICENSE 与来源记录。源码许可不替代素材清单中的音频使用限制；站点导出排除全部音频。
- 当前人物及插画素材的清单仍标记为私有概念展示。静态部署能力已经提供；公开或商业发布前应确认素材授权或替换相应图片。

## 数据流

```text
.env 中的五组配置
  → 配置校验 → Provider Probe → 十步 Stability → Match
  → replay.json（事实）＋审计报告
  → showcase/web 回放适配器与事实高光
  → 单文件 replay.html / 首页＋回放＋玩法的静态站点
```

`arena:run --confirm-live-run` 明确授权同一次命令中的 Probe、Stability、Match；门禁失败停止，不偷偷应用 waiver。每个阶段复用同一组参数和输出目录。原有 `arena:direct` 保留逐阶段操作能力。

新比赛自动使用 Showcase 构建单文件。`arena:replay` 支持从已有事实重建，`arena:replay:legacy` 留作旧版兼容。`arena:view` 生成普通网页与共享资源，因此线上查看不必加载包含所有图片的巨大单文件。它不启动 Runner，也不访问模型。

## 静态部署

```bash
npm run arena:view -- --input dist/runs/my-match/replay.json --build-only
```

命令返回新的 `dist/sites/match-<随机标识>/public/`。只将该目录整体上传至静态托管。每次导出使用独立目录，避免覆盖既有站点；当前是单场展示，多个站点可分别部署在不同子路径。

首页没有错误指向历史 Gold Bench 的入口。高光默认按本场事实程序生成；通过 `--enrichment` 可提供符合该场 hash 的高光数据。`arena:demo` 使用 Gold1 已校验的人工精选高光；Gold2 原始样本保留不改写。

静态站点仅允许 HTML/JS/CSS/图片/字体，JSON 数据安全嵌入回放页面，不复制调用日志、原始响应、环境配置、素材提示词或音频。本地预览仅绑定 `127.0.0.1`，服务专用导出目录；禁止越界路径、符号链接越界及非静态资源读取。

在线发起新比赛属于下一阶段：模型凭据必须保存在服务端，还需用户权限、后台任务、进度查询、费用限制和运行结果存储。本次交付支持本地运行＋静态在线展示。

## 验证与证据边界

`npm run setup` 使用 lockfile 安装四个包并只在缺失时创建 `.env`。`npm test` 覆盖原核心回归、两代展示适配器、新入口完整 Fake Provider 流程和冻结样本 hash。`npm run test:project-browser` 检查 HTTP 首页/玩法/回放、Day 1/40、子路径和访问边界；`test:showcase-browser -- --fixture` 检查单文件离线展示。

上述检查不调用真实付费模型，不等价于当前模型配置的在线验收。两份历史样本均为 Completion-Assisted，不能累加成 Strict Direct 的三场验收。

### 2026-11-11 本地验证结果

- Node `24.19.0`；核心 114、旧展示端 11、Showcase 24、统一流程 5，共 154 项测试通过，类型检查通过。
- 新增并行导出测试：两个导出同时运行，独立临时目录，最终 HTML 字节 hash 相同。
- 统一站点 Chromium：1366×768 与 1920×1080 的首页、玩法、Day 1/40、导航、无远程请求及部署子路径检查通过；路径穿越和越界符号链接访问返回 404。
- Showcase 离线 Fixture 浏览器矩阵：36 项通过，6 项仅适用于 Gold1 人工精选成品的检查按实际嵌入数据跳过。
- 从将提交的源码文件列表复制到全新临时目录，不带依赖、`.env`、比赛归档或旧成品；`setup`、完整 Fake Provider 比赛、演示站点导出均通过。
- Git diff 空白检查通过。已添加 GitHub Actions 流程，但远端 CI 尚未运行。本轮未调用真实模型、未部署线上站点。
