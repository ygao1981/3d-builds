import { createRoot } from 'react-dom/client';
import { Component, lazy, Suspense } from 'react';

const query=new URLSearchParams(location.search);
const baggage=query.get('project')==='bagline' || query.get('view')==='monitor' || query.has('film');
const App=lazy(baggage ? async () => { await import('./styles.css'); return import('./App.jsx'); } : () => import('./cargo/CargoApp.jsx'));

class SceneBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="scene-error" role="alert">
      <strong>机场三维场景未能打开</strong>
      <p>请确认项目资料、设备模型及浏览器图形加速可用，然后重新加载。</p>
      <button type="button" onClick={() => location.reload()}>重新加载</button>
    </main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<SceneBoundary><Suspense fallback={<p>正在打开三维场景…</p>}><App /></Suspense></SceneBoundary>);
