import React, { useEffect, useState } from 'react';
import { api, navigate, type Item } from './lib/api';
import { Link, Empty } from './components/ui';
import { Tasks, NewTask, Task } from './pages/tasks';
import { Models } from './pages/models';
import { Settings } from './pages/settings';
import { BrandArt, workspaceArtworkStyle } from './components/brand';
export function App() {
  const [path, setPath] = useState(location.pathname);
  const [session, setSession] = useState<Item | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => {
    const change = () => { setPath(location.pathname); setError(''); setNotice(''); };
    const expire = () => setSession({ authenticated: false, requiresLogin: true });
    window.addEventListener('popstate', change); window.addEventListener('session-expired', expire);
    api('/session').then(setSession).catch(error => setError(error.message));
    return () => { window.removeEventListener('popstate', change); window.removeEventListener('session-expired', expire); };
  }, []);
  const action = async (fn: () => Promise<unknown>, message = '') => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); setNotice(message); refresh(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  if (!session) return <div className="console" style={workspaceArtworkStyle}><Empty>{error || '正在连接 Arena…'}</Empty></div>;
  if (!session.authenticated) return <div className="console login" style={workspaceArtworkStyle}><section className="panel"><BrandArt className="login-art"/><div className="eyebrow">BEIJING FUSHENGJI ARENA</div><h1>欢迎回到 Arena</h1><p className="muted">登录后管理模型与 Bench 任务。</p><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void action(async () => setSession(await api('/session', 'POST', { password: data.get('password') }))); }}><label>管理员密码<input name="password" type="password" autoComplete="current-password" required /></label><button disabled={busy} className="primary">登录</button></form>{error && <p role="alert" className="error">{error}</p>}</section></div>;
  const taskMatch = /^\/tasks\/([^/]+)(?:\/(results|replay|edit))?$/.exec(path);
  return <div className="console" style={workspaceArtworkStyle}>
    <aside className="sidebar"><Link to="/tasks" className="brand"><span className="brand-mark">浮</span><span>北京浮生记<small>ARENA · BENCH 工作台</small></span></Link><nav aria-label="主导航"><Link to="/tasks" className={path.startsWith('/tasks') || path === '/' ? 'active' : ''}>▦　任务中心</Link><Link to="/models" className={path === '/models' ? 'active' : ''}>◈　模型管理</Link><Link to="/settings" className={path === '/settings' ? 'active' : ''}>⚙　设置与存储</Link></nav><div className="sidebar-footer"><span className="online-dot"/> 单实例工作空间<p>五个模型，同一场比赛。<br/>每一步决策都有事实记录。</p>{session.requiresLogin && <button onClick={() => void action(async () => { await api('/session', 'DELETE', {}); setSession({ authenticated: false, requiresLogin: true }); })}>退出登录</button>}</div></aside>
    <main className="workspace"><header className="workspace-bar"><span>工作空间 <span className="slash">/</span> {path === '/models' ? '模型管理' : path === '/settings' ? '设置' : '任务中心'}</span><span className="muted">{session.requiresLogin ? '管理员' : '本地工作空间'}</span></header>
      {error && <div role="alert" className="banner error">{error}<button aria-label="关闭错误" onClick={() => setError('')}>×</button></div>}{notice && <div role="status" className="banner success">{notice}</div>}
      {path === '/models' ? <Models {...{ action, busy, revision }} /> : path === '/settings' ? <Settings /> : path === '/tasks/new' ? <NewTask {...{ action, busy }} /> : taskMatch?.[2] === 'edit' ? <NewTask id={taskMatch[1]} {...{ action, busy }} /> : taskMatch ? <Task key={taskMatch[1]} id={taskMatch[1]} tab={taskMatch[2] ?? 'overview'} {...{ action, busy, revision }} /> : <Tasks {...{ action, busy, revision }} />}
    </main>
  </div>;
}
