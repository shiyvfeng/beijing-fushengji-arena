import { useEffect, useState } from 'react';
import { ReplayView } from '../../../showcase/web/src/App';
import { adaptCoreMatchReplay } from '../../../showcase/web/src/replay-adapter';
import { validateReplayEnrichment } from '../../../showcase/web/src/enrichment';
import '../../../showcase/web/src/styles.css';
export default function Replay({ id }: { id: string }) {
  const [data, setData] = useState<any>(null), [error, setError] = useState('');
  useEffect(() => { const abort = new AbortController(); (async () => {
    try {
      const response = await fetch(`/api/tasks/${id}/replay`, { signal: abort.signal });
      if (!response.ok) throw new Error('回放不可用或尚未完成');
      const replay = adaptCoreMatchReplay(await response.json());
      let enrichment: any = { status: 'missing', message: '暂无高光' };
      try {
        const response = await fetch(`/api/tasks/${id}/enrichment`, { signal: abort.signal });
        if (response.ok) { const value = await response.json(); validateReplayEnrichment(value, replay); enrichment = { status: 'ready', enrichment: value }; }
      } catch { /* Facts remain available when the optional enrichment fails. */ }
      if (!abort.signal.aborted) setData({ replay, enrichment });
    } catch (error) { if (!abort.signal.aborted) setError((error as Error).message); }
  })(); return () => abort.abort(); }, [id]);
  if (error) return <div role="alert" className="panel error">正式回放已停止展示：{error}</div>;
  if (!data) return <div className="empty">正在读取并校验回放…</div>;
  return <div className="embedded-replay"><ReplayView replay={data.replay} enrichment={data.enrichment}/></div>;
}
