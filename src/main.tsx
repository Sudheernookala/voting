import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ensureUser } from './firebase';
import { App } from './App';
import { ToastProvider } from './hooks';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const root = createRoot(document.getElementById('root')!);
root.render(<main><div className="empty">Loading…</div></main>);

ensureUser().then(
  user => root.render(<StrictMode><ErrorBoundary><ToastProvider><App user={user} /></ToastProvider></ErrorBoundary></StrictMode>),
  err => root.render(
    <main><div className="narrow card">
      <h2>Can't connect</h2><p>{String(err?.message || err)}</p>
      <p className="muted">Check that Anonymous sign-in is enabled in Firebase → Authentication → Sign-in method.</p>
    </div></main>,
  ),
);
