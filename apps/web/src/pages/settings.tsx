import React, { useEffect, useState, lazy, Suspense } from 'react';
import { api, navigate, date, count, type Item, type Actions } from '../lib/api';
import { Link, Badge, Empty, Dialog } from '../components/ui';
import { defaultLimits, providers, providerUrls, statusLabels, stageLabels, terminalStates } from '../../../../packages/contracts/index.mjs';
const labels: Record<string, string> = statusLabels;
const stages: Record<string, string> = stageLabels;
export function Settings() {
  const [data, setData] = useState<Item | null>(null), [error, setError] = useState('');
  useEffect(() => { api('/settings').then(setData).catch(error => setError(error.message)); }, []);
  return <><div className="page-heading"><div><div className="eyebrow">WORKSPACE SETTINGS</div><h1>设置与存储</h1><p className="muted">单实例运行，任务和结果保存在独立数据目录。</p></div></div>{error && <p className="error">{error}</p>}<section className="panel"><h2>运行设置</h2><dl className="metadata"><dt>比赛并发</dt><dd>1 场；场内五模型并行</dd><dt>任务数量</dt><dd>{data?.taskCount ?? '—'}</dd><dt>数据库大小</dt><dd>{data ? `${(data.databaseBytes / 1024).toFixed(0)} KB` : '—'}</dd><dt>数据目录</dt><dd className="mono">{data?.dataDir ?? '—'}</dd><dt>引擎标识</dt><dd className="mono">{data?.engineVersion ?? '—'}</dd></dl></section><section className="panel"><h2>允许的模型网关</h2><p className="muted">添加自定义网关时，在服务端设置逗号分隔的 ARENA_ALLOWED_MODEL_HOSTS 并重启。只填写你信任的主机名。</p><div className="chips">{data?.allowedHosts?.map((host: string) => <code key={host}>{host}</code>)}</div></section><section className="panel"><h2>备份与恢复</h2><p>停止服务后备份完整数据目录，包含数据库、master.key 和 tasks。恢复时使用完整备份，再启动服务。</p><p className="muted">master.key 用于解密模型凭据，丢失后无法从数据库恢复密钥。正在执行的任务在服务重启后会核对状态，不会自动重新发起付费请求。</p></section></>;
}
