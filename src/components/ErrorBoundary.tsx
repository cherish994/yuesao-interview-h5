import { Component, ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: string; }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) return (
      <div style={{ padding: 32, textAlign: 'center', background: '#F5F6FF', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>😓</div>
        <p style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>页面出了点问题</p>
        <p style={{ fontSize: 14, color: '#888', marginBottom: 24 }}>请刷新重试</p>
        <button onClick={() => window.location.reload()}
          style={{ background: '#6B7FD7', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 32px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
          刷新页面
        </button>
      </div>
    );
    return this.props.children;
  }
}
