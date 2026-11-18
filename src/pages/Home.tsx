import { useEffect, useState, type FormEvent } from 'react';
import { get, remove, set } from 'firebase/database';
import { GoogleAuthProvider, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, r } from '../firebase';
import { useLive, useToast } from '../hooks';
import {
  BASE, DAY, KEEP_DAYS, cleanupOldMeetings, createMeeting, deleteMeeting, emailKey, keyToEmail, niceError,
  type HostMeeting,
} from '../lib';

export function Home({ user }: { user: User }) {
  const toast = useToast();
  // null = still checking. Only people on the host list can read it.
  const [isHost, setIsHost] = useState<boolean | null>(user.isAnonymous ? false : null);
  useEffect(() => {
    if (user.isAnonymous) return;
    get(r('admins')).then(() => setIsHost(true), () => setIsHost(false));
  }, [user]);

  const signIn = async (e: React.MouseEvent) => {
    e.preventDefault();
    try { await signInWithPopup(auth, new GoogleAuthProvider()); location.reload(); }
    catch (err) {
      const code = (err as { code?: string }).code || '';
      if (/popup-closed|cancelled-popup/.test(code)) return;
      toast(/unauthorized-domain/.test(code) ? 'This website is not in Firebase “Authorized domains” yet' : niceError(err), true);
    }
  };
  const doSignOut = async (e: React.MouseEvent) => { e.preventDefault(); await signOut(auth); location.reload(); };

  if (isHost === null) return <div className="empty">Loading…</div>;

  return (
    <div className="narrow">
      <div className="hero">
        <h1>Live voting for your meeting</h1>
        <p className="muted">{isHost ? 'Create a meeting, share the QR code, and watch votes arrive in real time.' : 'Enter the code from your host to join.'}</p>
      </div>
      {isHost && <><CreateMeeting user={user} /><MyMeetings user={user} /><ManageHosts user={user} /></>}
      <JoinCard />
      {!user.isAnonymous && !isHost && (
        <div className="card"><h2>Not allowed to host</h2>
          <p><b>{user.email}</b> isn't on the host list. Ask the owner to add this email under “Manage hosts”.</p></div>
      )}
      {!user.isAnonymous && (
        <p className="small muted" style={{ textAlign: 'center' }}>Signed in as <b>{user.email}</b> · <a href="#" onClick={doSignOut}>Sign out</a></p>
      )}
      {user.isAnonymous && (
        <p className="small" style={{ textAlign: 'center', marginTop: 24 }}><a href="#" id="hostSignIn" onClick={signIn}>Host sign-in</a></p>
      )}
    </div>
  );
}

function JoinCard() {
  const [code, setCode] = useState('');
  return (
    <div className="card">
      <h2>Join a vote</h2>
      <form id="joinForm" className="row" onSubmit={e => { e.preventDefault(); location.href = `${BASE}?join=${code.trim().toUpperCase()}`; }}>
        <input id="jcode" placeholder="Enter 6-letter code" maxLength={6} required value={code} onChange={e => setCode(e.target.value)}
          style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '.15em' }} />
        <button className="btn">Join</button>
      </form>
      <p className="small muted" style={{ margin: '8px 0 0' }}>Or scan the QR code shown by the host.</p>
    </div>
  );
}

function CreateMeeting({ user }: { user: User }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const { code, key } = await createMeeting(user, title.trim().slice(0, 100));
      localStorage.setItem('hostKey:' + code, key);
      location.href = `${BASE}?host=${code}&key=${key}`;
    } catch (err) { toast(niceError(err), true); setBusy(false); }
  };
  return (
    <div className="card">
      <h2>Host a meeting</h2>
      <form id="createForm" onSubmit={submit}>
        <label htmlFor="mtitle">Meeting name</label>
        <input id="mtitle" placeholder="e.g. Annual Awards Night 2026" maxLength={100} required value={title} onChange={e => setTitle(e.target.value)} />
        <div style={{ height: 14 }} />
        <button className="btn block" disabled={busy}>{busy ? 'Creating…' : 'Create meeting'}</button>
      </form>
    </div>
  );
}

function MyMeetings({ user }: { user: User }) {
  const toast = useToast();
  const myKey = emailKey(user.email!);
  const meetings = useLive<Record<string, HostMeeting>>(`hostMeetings/${myKey}`, {});
  const [gone, setGone] = useState<Set<string>>(new Set());

  useEffect(() => { cleanupOldMeetings(); }, []);
  // Entries older than 30 days whose meeting was already cleaned up: drop them from the list.
  useEffect(() => {
    for (const [code, m] of Object.entries(meetings)) {
      if (Date.now() - m.createdAt < KEEP_DAYS * DAY || gone.has(code)) continue;
      get(r(`meetings/${code}/info`)).then(s => {
        if (!s.exists()) { setGone(g => new Set(g).add(code)); remove(r(`hostMeetings/${myKey}/${code}`)).catch(() => {}); }
      }, () => {});
    }
  }, [meetings, myKey, gone]);

  const list = Object.entries(meetings).filter(([c]) => !gone.has(c)).sort((a, b) => b[1].createdAt - a[1].createdAt);
  const del = async (code: string, title: string) => {
    if (!confirm(`Delete “${title}” and all its votes and feedback? This can't be undone.`)) return;
    try { await deleteMeeting(user, code); toast('Meeting deleted'); } catch (err) { toast(niceError(err), true); }
  };
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="card">
      <h2>Your meetings</h2>
      <p className="small muted">Meetings are deleted automatically {KEEP_DAYS} days after they were created. Export results before then if you need to keep them.</p>
      <div id="myMeetings">
        {list.length === 0 ? <p className="muted">No meetings yet.</p> : (
          <ul className="host-list">
            {list.map(([code, m]) => {
              const daysLeft = KEEP_DAYS - Math.floor((Date.now() - m.createdAt) / DAY);
              return (
                <li key={code}>
                  <span><b>{m.title}</b><br />
                    <span className="small muted">{fmt(m.createdAt)} · code {code} · {daysLeft > 0 ? `deletes in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'deleting soon'}</span>
                  </span>
                  <span className="row" style={{ flexWrap: 'nowrap' }}>
                    <a className="btn sm ghost" href={`${BASE}?host=${code}&key=${m.key}`}>Open</a>
                    <button className="btn sm red" data-del={code} onClick={() => del(code, m.title)}>Delete</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ManageHosts({ user }: { user: User }) {
  const toast = useToast();
  const admins = useLive<Record<string, boolean>>('admins', {});
  const myKey = emailKey(user.email!);
  const [email, setEmail] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast('Enter a valid email', true);
    try { await set(r(`admins/${emailKey(v)}`), true); setEmail(''); toast(`${v} can now host`); }
    catch (err) { toast(niceError(err), true); }
  };
  const del = async (k: string) => {
    if (!confirm(`Remove ${keyToEmail(k)} as a host?`)) return;
    try { await remove(r(`admins/${k}`)); toast('Host removed'); } catch (err) { toast(niceError(err), true); }
  };
  return (
    <div className="card">
      <h2>Manage hosts</h2>
      <p className="small muted">People on this list can sign in with Google and create meetings.</p>
      <ul className="host-list" id="adminList">
        {Object.keys(admins).sort().map(k => (
          <li key={k}>
            <span>{keyToEmail(k)}{k === myKey && <span className="muted"> (you)</span>}</span>
            {k !== myKey && <button className="btn sm red" data-remove={k} onClick={() => del(k)}>Remove</button>}
          </li>
        ))}
      </ul>
      <form id="adminForm" className="row" onSubmit={add}>
        <input id="adminEmail" type="email" placeholder="colleague@gmail.com" style={{ flex: 1 }} required value={email} onChange={e => setEmail(e.target.value)} />
        <button className="btn ghost">Add host</button>
      </form>
    </div>
  );
}
