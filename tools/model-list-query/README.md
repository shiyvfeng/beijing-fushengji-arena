# 模型列表查询

用于查询兼容 OpenAI Models API 的模型列表，并在本目录生成 `model-list.csv`。CSV 和本地 `.env` 已由本目录 `.gitignore` 忽略；脚本不会把 API Key 写入输出文件。

推荐把 Key 作为临时环境变量输入，避免出现在 shell 历史中：

```bash
MODEL_LIST_API_KEY='你的 API Key' \
node tools/model-list-query/query-models.mjs \
  --base-url 'https://example.com/v1'
```

也可以使用命令行参数：

```bash
node tools/model-list-query/query-models.mjs \
  --base-url 'https://example.com/v1' \
  --api-key '你的 API Key'
```

Base URL 可以是服务根地址、`/v1` 地址或完整的 `/models` 地址。脚本会分别请求 `/v1/models`、`/v1/models` 或给定的 `/models`。

默认使用 `Authorization: Bearer <API Key>`。若供应商需要其他头：

```bash
MODEL_LIST_API_KEY='你的 API Key' \
node tools/model-list-query/query-models.mjs \
  --base-url 'https://example.com/v1' \
  --auth-header x-api-key
```

支持 `bearer`、`x-api-key` 和 `x-goog-api-key`。默认输出为本目录的 `model-list.csv`；可用 `--output <path>` 覆盖。
