import { createRoot } from 'react-dom/client';
import { Component } from 'react';
import App from './App.jsx';
import './styles.css';

class SceneBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="scene-error" role="alert">
      <strong>机场三维场景未能打开</strong>
      <p>请确认五个设备模型已准备好，且浏览器已启用图形加速，然后重新加载。</p>
      <button type="button" onClick={() => location.reload()}>重新加载</button>
    </main>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')).render(<SceneBoundary><App /></SceneBoundary>);
