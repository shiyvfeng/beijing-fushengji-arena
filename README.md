# 北京浮生记 Arena

一个供自己或小团队使用的 Bench Web 应用。浏览器配置模型、管理任务和观看结果；后端执行五模型比赛，保存完整事实回放与调用统计。

## 快速开始

使用 Node.js **24.19.0 或更高的 24 LTS**，进入本版本的仓库目录：

```bash
npm ci
npm run dev
```

打开 **http://127.0.0.1:5173**。前端开发服务使用 5173 端口，后端 API 使用 3000 端口。

1. 进入“模型管理”，添加供应商连接，填写 Base URL 和 API Key。
2. 添加五个不同的 Provider + Model 配置；同一连接可以配置多个模型。
3. 在“任务中心”新建任务，选择模型、轨道与预算，确认启动。
4. 在任务详情查看进度，完成后打开“结果分析”或“比赛回放”。

模型 Key 在页面输入，由后端加密保存，读取接口不返回明文。首次使用无需填写模型 `.env`。不配置模型时，可以在空任务列表点击“查看历史演示”，导入只读的 Gold1 回放，不产生模型请求。

## 已支持

- 连接与模型配置的新增、编辑、停用、模型列表查询和显式模型测试。
- 任务草稿、编辑、启动、排队、取消、复制重跑、归档、恢复和筛选。
- 启动时固定参数和凭据版本；双击启动不会创建两场比赛。
- Probe → 十步 Stability → 正式比赛；门禁失败停止，不自动豁免。
- Strict Direct 与 Completion-Assisted；任务级取消可以中断在途请求和退避等待。
- SSE 进度、刷新与重连、重启时核对未完成执行；不自动重发付费比赛。
- 按任务动态读取结果与回放，展示排名、净资产、请求、失败、重试和 Token。
- 结果 JSON 导出，CLI 单文件 HTML 导出继续可用。

前端只在发布时构建一次；每场比赛只保存数据，不运行 Vite、不复制图片、不强制生成 HTML。当前默认一场比赛同时执行，场内五模型并行。

## 本地生产运行

```bash
npm run build
npm start
```

打开 **http://127.0.0.1:3000**。`npm start` 读取可选的根 `.env`，部署参数见 [.env.example](.env.example)。本地回环模式无需登录；绑定非回环地址必须配置至少 12 位 `ARENA_ADMIN_PASSWORD`。

SQLite、加密密钥材料和任务产物默认位于 Git 忽略的 `var/`。可以用 `ARENA_DATA_DIR` 指定持久目录。修改模型配置不会改变已启动任务；重跑会产生新的任务与文件，不覆盖旧事实。

官方供应商主机默认允许。自定义 HTTPS 网关需将主机名加入 `ARENA_ALLOWED_MODEL_HOSTS` 后重启服务；这也是允许访问内网模型网关的部署边界。

## 服务器部署

仓库包含 `Dockerfile` 与 `compose.yaml`：设置管理员密码后执行 `docker compose up --build -d`。默认将应用端口绑定至服务器 `127.0.0.1:3000`，可通过 SSH 隧道访问，或配置 HTTPS 反向代理；后者需设置 `ARENA_COOKIE_SECURE=true`。容器数据卷保存全部配置与结果。

详细的启动、备份恢复、网关配置、限制与验证记录见 [Web 应用运行说明](docs/web-app.md)。Docker 文件已提供；本轮环境没有 Docker 引擎，未宣称完成容器实机验收。

## 工程结构

```text
apps/web/               React 控制台、结果页面、动态回放入口
apps/server/            Node API、SQLite、加密配置、调度器和 Worker
packages/contracts/     前后端共享参数与状态契约
src/core/               确定性游戏引擎与事实契约
src/arena/              Provider、门禁、比赛、报告和公共 Bench 服务
showcase/web/           复用的回放组件、事实高光及资源清单
scripts/                开发启动、兼容导出与浏览器验收
var/                    本地私有运行数据，禁止提交
```

采用 npm workspaces 和一份根 lockfile。旧 `web/` 保留兼容测试，不是新应用入口；核心源码暂保留现有位置，通过公共服务供 CLI 和后端复用，避免在功能迁移时改变核心导入路径。

新应用按资源清单打包运行图片，排除设计原图、QA 截图、提示词、私有音频和历史运行归档。原始素材及 Git 历史保留，未执行历史重写。现有人物素材仍沿用私有概念展示的使用范围，公开部署前需确认或替换。

## 验证

```bash
npm test                         # 核心、展示、并行导出和后端集成；Fake Provider
npm run build                    # 核心编译、前端类型检查与生产构建
npm run arena:browser:install     # 首次安装 Chromium
npm run test:app-browser          # 浏览器配置五模型→运行→结果→回放
npm run test:showcase-browser -- --fixture
```

自动化使用假模型，不构成真实供应商配置的在线验收，也不增加 Strict Direct 金样场次。测试会启动本机 HTTP 服务。

## CLI 与历史资料

CLI 高级诊断、单文件导出和静态站点导出继续保留。模型环境变量模板迁至 [docs/cli.env.example](docs/cli.env.example)，用 `--env-file` 显式指定本机文件；已有 `.env` 不自动改写。

```bash
npm run arena:direct -- --env-file .env.cli --check-config
npm run arena:run -- --env-file .env.cli --output-dir dist/runs/my-match --confirm-live-run
npm run arena:replay -- --input dist/runs/my-match/replay.json
```

[Web 改造方案](docs/web-platform-plan.md) · [项目进度](docs/project-status.md) · [Direct 契约](docs/arena-direct.md) · [源码整合来源](docs/unified-project.md) · [历史 CLI/Legacy 说明](docs/cli-and-legacy-guide.md)
