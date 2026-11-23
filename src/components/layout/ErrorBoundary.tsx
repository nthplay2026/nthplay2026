import { Component, type ReactNode } from 'react';

/** If anything crashes while rendering, show a way back instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('App crashed:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'Inter, system-ui, sans-serif', background: '#fbf5ee' }}>
        <div style={{ maxWidth: 380, textAlign: 'center' }}>
          <p style={{ fontSize: 20, fontWeight: 700, color: '#2d1c12' }}>Something went wrong</p>
          <p style={{ marginTop: 8, color: '#475569', fontSize: 15 }}>Please reload the page. If it keeps happening, contact us.</p>
          <button type="button" onClick={() => window.location.reload()}
            style={{ marginTop: 16, background: '#56704a', color: '#fff', border: 0, borderRadius: 12, padding: '12px 20px', fontSize: 15, fontWeight: 600 }}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
