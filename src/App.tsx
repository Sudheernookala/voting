import type { User } from 'firebase/auth';
import { useLive } from './hooks';
import { Home } from './pages/Home';
import { HostPage } from './pages/HostPage';
import { JoinPage } from './pages/JoinPage';

/** Same URLs as before, so existing QR codes and links keep working: ?join=CODE, ?host=CODE&key=KEY */
export function App({ user }: { user: User }) {
  const params = new URLSearchParams(location.search);
  const connected = useLive<boolean | null>('.info/connected', null);
  const host = params.get('host'), join = params.get('join');
  return (
    <>
      <header className="topbar">
        <a href="./" className="brand"><span className="logo">✓</span> LiveVote</a>
        <span className={`conn ${connected === null ? '' : connected ? 'on' : 'off'}`} title={connected ? 'Connected' : 'Offline'} />
      </header>
      <main>
        {host ? <HostPage user={user} code={host.toUpperCase()} urlKey={params.get('key')} />
          : join ? <JoinPage user={user} code={join.toUpperCase()} />
          : <Home user={user} />}
      </main>
    </>
  );
}
