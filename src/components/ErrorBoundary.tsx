import { Component, type ReactNode } from 'react';

/** If something unexpected breaks the page, show a reload button instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error(error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main><div className="narrow card empty">
        <h2>Something went wrong</h2>
        <p>Reload the page — your vote and name are kept.</p>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
      </div></main>
    );
  }
}
