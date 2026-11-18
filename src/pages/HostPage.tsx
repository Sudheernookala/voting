import { useEffect, useMemo, useState, type FormEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import { push, remove, serverTimestamp, set, update } from 'firebase/database';
import type { User } from 'firebase/auth';
import qrcode from 'qrcode-generator';
import { r } from '../firebase';
import { useLive, useServerNow, useToast } from '../hooks';
import { RevealOverlay, useRevealQueue } from '../components/RevealOverlay';
import { People } from '../components/People';
import {
  BASE, computeResults, exportCsv, maxPicks, niceError, plural, randHex, revealWinner,
  type Ballot, type Category, type Feedback, type FeedbackResponse, type Voter,
} from '../lib';

export function HostPage({ user, code, urlKey }: { user: User; code: string; urlKey: string | null }) {
  const key = useMemo(() => {
    if (urlKey) localStorage.setItem('hostKey:' + code, urlKey);
    return urlKey || localStorage.getItem('hostKey:' + code);
  }, [code, urlKey]);
  const [access, setAccess] = useState<'checking' | 'ok' | 'denied'>('checking');
  useEffect(() => {
    if (!key) { setAccess('denied'); return; }
    // Proves we hold the host key (checked by the security rules).
    set(r(`meetings/${code}/hosts/${user.uid}`), key).then(() => setAccess('ok'), () => setAccess('denied'));
  }, [code, key, user.uid]);

  if (access === 'checking') return <div className="empty">Loading…</div>;
  if (access === 'denied') return (
    <div className="card narrow empty"><h2>Can't open host dashboard</h2>
      <p>Invalid meeting or host key. Use the private host link you got when you created the meeting.</p>
      <a className="btn" href={BASE}>Home</a></div>
  );
  return <Dashboard code={code} hostKey={key!} />;
}

function Dashboard({ code, hostKey }: { code: string; hostKey: string }) {
  const base = `meetings/${code}`;
  const info = useLive<{ title?: string }>(`${base}/info`, {});
  const categories = useLive<Record<string, Category>>(`${base}/categories`, {});
  const feedback = useLive<Feedback | null>(`${base}/feedback`, null);
  const voters = useLive<Record<string, Voter>>(`${base}/voters`, {});
  const ballots = useLive<Record<string, Record<string, Ballot>>>(`${base}/ballots`, {});
  const responses = useLive<Record<string, Record<string, FeedbackResponse>>>(`${base}/responses`, {});
  const online = useLive<Record<string, boolean>>(`${base}/online`, {});
  const serverNow = useServerNow();
  const reveal = useRevealQueue(categories, serverNow);

  useEffect(() => { document.title = (info.title || 'Meeting') + ' · Host'; }, [info.title]);

  const cats = Object.entries(categories).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  const voterCount = Object.keys(voters).length;

  return (
    <div className="host-grid">
      <aside>
        <ShareCard code={code} title={info.title} voters={voters} onlineCount={Object.keys(online).length} />
        <CategoryForm code={code} />
        <FeedbackControls code={code} feedback={feedback} />
        <div className="card small">
          <b>Your host link</b> (keep private — anyone with it can control this meeting)
          <div className="link">{`${BASE}?host=${code}&key=${hostKey}`}</div>
          <div className="row">
            <CopyButton text={`${BASE}?host=${code}&key=${hostKey}`} label="Copy host link" done="Host link copied" />
            <button className="btn sm ghost" id="exportCsv" onClick={() => exportCsv(code, categories, ballots, voters, responses)}>Export results (CSV)</button>
          </div>
        </div>
      </aside>
      <section>
        <div id="cats">
          {cats.length === 0 ? (
            <div className="card empty"><div style={{ fontSize: '2.4rem' }}>🗳️</div>
              <h3>No voting categories yet</h3><p>Create one on the left. Participants see it the moment you start it.</p></div>
          ) : cats.map(([cid, c]) => (
            <CategoryCard key={cid} code={code} cid={cid} cat={c} ballots={ballots} voters={voters} voterCount={voterCount} />
          ))}
        </div>
        <FeedbackResults code={code} responses={responses} />
      </section>
      {reveal.cat && <RevealOverlay cat={reveal.cat} serverNow={serverNow} onClose={reveal.close} />}
    </div>
  );
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const toast = useToast();
  return <button className="btn sm ghost" onClick={() => navigator.clipboard.writeText(text).then(() => toast(done), () => toast(text))}>{label}</button>;
}

function ShareCard({ code, title, voters, onlineCount }: { code: string; title?: string; voters: Record<string, Voter>; onlineCount: number }) {
  const joinUrl = `${BASE}?join=${code}`;
  const qr = useMemo(() => { const q = qrcode(0, 'M'); q.addData(joinUrl); q.make(); return q; }, [joinUrl]);
  const list = Object.values(voters);
  return (
    <div className="card share">
      <h2 id="mTitle">{title || 'Loading…'}</h2>
      <p className="muted small">Participants scan or open the link to join</p>
      <div role="img" aria-label="QR code to join" dangerouslySetInnerHTML={{ __html: qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }) }} />
      <div className="code">{code}</div>
      <div className="link">{joinUrl}</div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <CopyButton text={joinUrl} label="Copy link" done="Join link copied" />
        <a className="btn sm ghost" href={qr.createDataURL(10, 4)} download={`join-${code}.gif`}>Download QR</a>
      </div>
      <div className="stats">
        <div className="stat"><b id="sJoined">{list.length}</b><span className="small muted">joined</span></div>
        <div className="stat"><b id="sOnline">{onlineCount}</b><span className="small muted">online now</span></div>
      </div>
      <details><summary>Who has joined</summary>
        <ul className="voter-list" id="joinedList">
          {list.filter(v => !v.anon).map((v, i) => <li key={i}>{v.name}</li>)}
          {list.some(v => v.anon) && <li><i>{list.filter(v => v.anon).length} anonymous</i></li>}
          {list.length === 0 && <li>Nobody yet</li>}
        </ul>
      </details>
    </div>
  );
}

function CategoryForm({ code }: { code: string }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [multi, setMulti] = useState(1);

  const addOptions = (text: string) => {
    const add = text.split(/[,\n]/).map(s => s.trim().slice(0, 80)).filter(Boolean);
    setOptions(prev => {
      const next = [...prev];
      for (const o of add) if (!next.some(x => x.toLowerCase() === o.toLowerCase())) next.push(o);
      return next;
    });
    setInput('');
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); addOptions(input); } };
  const onPaste = (e: ClipboardEvent) => {
    const t = e.clipboardData.getData('text');
    if (/[,\n]/.test(t)) { e.preventDefault(); addOptions(t); }
  };

  const submit = async (openNow: boolean, e: FormEvent) => {
    e.preventDefault();
    const all = [...options];
    for (const o of input.split(/[,\n]/).map(s => s.trim().slice(0, 80)).filter(Boolean)) {
      if (!all.some(x => x.toLowerCase() === o.toLowerCase())) all.push(o);
    }
    const t = title.trim().slice(0, 100);
    if (!t) return toast('Category name is required', true);
    if (all.length < 2) return toast('Add at least 2 options or participants', true);
    const m = Math.min(multi, all.length);
    try {
      await push(r(`meetings/${code}/categories`), {
        title: t, status: openNow ? 'open' : 'draft', createdAt: serverTimestamp(),
        options: Object.fromEntries(all.map((label, i) => ['o' + randHex(4), { label, order: i }])),
        ...(m > 1 ? { multi: m } : {}),
      });
      toast(openNow ? 'Voting started — participants can vote now' : 'Saved as draft');
      setTitle(''); setInput(''); setOptions([]); setMulti(1);
    } catch (err) { toast(niceError(err), true); }
  };

  return (
    <div className="card">
      <h2>New voting category</h2>
      <form id="catForm" onSubmit={e => submit(true, e)}>
        <label htmlFor="ctitle">Category</label>
        <input id="ctitle" placeholder="e.g. Best Speaker" maxLength={100} value={title} onChange={e => setTitle(e.target.value)} />
        <label htmlFor="opt">Options / participants</label>
        <div className="row">
          <input id="opt" placeholder="Type a name, press Enter" style={{ flex: 1 }} maxLength={80}
            value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
          <button type="button" className="btn sm ghost" id="addOpt" onClick={() => addOptions(input)}>Add</button>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>Tip: paste several names separated by commas or new lines.</p>
        <div className="chips" id="chips">
          {options.map((o, i) => (
            <span className="chip" key={o}>{o}
              <button type="button" aria-label={`Remove ${o}`} onClick={() => setOptions(options.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
        <label htmlFor="cmulti">Each voter can choose</label>
        <select id="cmulti" value={multi} onChange={e => setMulti(+e.target.value)}>
          <option value={1}>One option</option>
          {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>Up to {n} options</option>)}
        </select>
        <div style={{ height: 14 }} />
        <div className="row">
          <button className="btn green" data-open="1" style={{ flex: 1 }}>Create &amp; start voting</button>
          <button type="button" className="btn ghost" data-open="0" onClick={e => submit(false, e)}>Save as draft</button>
        </div>
      </form>
    </div>
  );
}

function CategoryCard({ code, cid, cat, ballots, voters, voterCount }: {
  code: string; cid: string; cat: Category; ballots: Record<string, Record<string, Ballot>>;
  voters: Record<string, Voter>; voterCount: number;
}) {
  const toast = useToast();
  const res = computeResults(cat, cid, ballots, voters);
  const turnout = voterCount ? Math.round(res.total / voterCount * 100) : 0;
  const mp = maxPicks(cat);
  const path = `meetings/${code}/categories/${cid}`;
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (err) { toast(niceError(err), true); } };

  const doReveal = () => {
    const msg = cat.status === 'open'
      ? 'This closes voting and shows the winner on every screen. Continue?'
      : 'Show the winner on every screen?';
    if (confirm(msg)) act(() => revealWinner(code, cid, res));
  };

  const ranked = [...res.options].sort((a, b) => b.count - a.count || a.order - b.order);
  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>{cat.title}</h2>
        {cat.status === 'open' ? <span className="badge open"><span className="pulse" />Live</span>
          : <span className={`badge ${cat.status}`}>{cat.status}</span>}
        {cat.reveal && <span className="badge revealed">Winner revealed</span>}
        <span className="spacer" />
        {cat.status === 'open'
          ? <button className="btn sm" data-act="closed" data-id={cid} onClick={() => act(() => set(r(`${path}/status`), 'closed'))}>Close voting</button>
          : <button className="btn sm green" data-act="open" data-id={cid}
              onClick={() => act(() => update(r(path), { status: 'open', reveal: null }))}>{cat.status === 'draft' ? 'Start voting' : 'Reopen'}</button>}
        {res.total > 0 && cat.status !== 'draft' && (
          <button className="btn sm gold" data-reveal={cid} onClick={doReveal}>🏆 {cat.reveal ? 'Reveal again' : 'Reveal winner'}</button>
        )}
        <button className="btn sm red" data-act="delete" data-id={cid}
          onClick={() => confirm('Delete this category? Its results will no longer be shown.') && act(() => remove(r(path)))}>Delete</button>
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        <b>{plural(res.total, 'vote')}</b> received out of {voterCount} joined · {turnout}% turnout
        {mp > 1 && <><br />Multiple choice: up to {mp} per person · % = share of voters who picked it</>}
      </p>
      <div className="bars">
        {ranked.map(o => {
          const pct = res.total ? Math.round(o.count / res.total * 100) : 0;
          const win = res.max > 0 && o.count === res.max;
          return (
            <div className={`bar ${win ? 'win' : ''}`} key={o.id}>
              <div className="bar-top"><span>{win ? '🏆 ' : ''}{o.label}</span><span><b>{o.count}</b> <span className="muted">({pct}%)</span></span></div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
      </div>
      {res.total > 0 && (res.tie
        ? <div className="winner tie">🤝 Tie between {res.winners.map(w => w.label).join(' & ')} ({plural(res.max, 'vote')} each)</div>
        : <div className="winner">🏆 {cat.status === 'closed' ? 'Winner' : 'Leading'}: {res.winners[0].label} with {plural(res.max, 'vote')}</div>)}
      <details data-cat={cid}><summary>Verify: who voted for whom</summary>
        <ul className="voter-list">
          {res.options.filter(o => o.people.length).map(o => <li key={o.id}><b>{o.label}:</b> <People people={o.people} /></li>)}
          {res.total === 0 && <li>No votes yet</li>}
        </ul>
        {res.notVoted.length > 0 && <p className="small muted" style={{ marginTop: 6 }}>Not voted yet: <People people={res.notVoted} /></p>}
      </details>
    </div>
  );
}

function FeedbackControls({ code, feedback }: { code: string; feedback: Feedback | null }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const open = async () => {
    const question = (q.trim() || 'How was this meeting?').slice(0, 300);
    try {
      await set(r(`meetings/${code}/feedback`), { status: 'open', round: Date.now().toString(36), question });
      toast('Feedback form sent to all participants');
    } catch (err) { toast(niceError(err), true); }
  };
  return (
    <div className="card">
      <h2>Feedback</h2>
      <div id="fbControls">
        {feedback?.status === 'open' ? (
          <>
            <p><span className="badge open"><span className="pulse" />Collecting</span></p>
            <p className="small">“{feedback.question}”</p>
            <button className="btn block" id="fbClose"
              onClick={() => set(r(`meetings/${code}/feedback/status`), 'closed').catch(err => toast(niceError(err), true))}>Stop collecting feedback</button>
          </>
        ) : (
          <>
            <p className="small muted">Every participant's screen switches to a feedback form.</p>
            <input id="fbQ" placeholder="How was this meeting?" maxLength={300} value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ height: 10 }} />
            <button className="btn block ghost" id="fbOpen" onClick={open}>Ask for feedback</button>
          </>
        )}
      </div>
    </div>
  );
}

const stars = (n?: number) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

function FeedbackResults({ code, responses }: { code: string; responses: Record<string, Record<string, FeedbackResponse>> }) {
  const toast = useToast();
  const rounds = Object.entries(responses).sort((a, b) => b[0].localeCompare(a[0]));
  const total = rounds.reduce((n, [, x]) => n + Object.keys(x).length, 0);
  const del = async (round: string, vid?: string) => {
    if (!confirm(vid ? "Delete this feedback? This can't be undone." : "Delete ALL responses to this question? This can't be undone.")) return;
    try {
      await remove(r(`meetings/${code}/responses/${round}${vid ? '/' + vid : ''}`));
      toast(vid ? 'Feedback deleted' : 'All responses deleted');
    } catch (err) { toast(niceError(err), true); }
  };
  return (
    <div className="card" id="fbResults">
      <div className="row"><h2 style={{ margin: 0 }}>Feedback</h2><span className="spacer" />
        <span className="muted small">{plural(total, 'response')}</span></div>
      {rounds.length === 0 && <p className="muted" style={{ marginTop: 10 }}>No feedback yet.</p>}
      {rounds.map(([round, resp]) => {
        const list = Object.entries(resp).map(([vid, x]) => ({ vid, ...x })).sort((a, b) => b.at - a.at);
        const ratings = list.filter(x => x.rating).map(x => x.rating!);
        const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
        return (
          <div key={round}>
            <div className="round-title">“{list[0]?.q}” {avg && <><span className="stars-static">{stars(Math.round(avg))}</span> <b>{avg.toFixed(1)}</b>/5</>}
              <span className="muted small"> · {plural(list.length, 'response')}</span>
              <button className="link-btn" data-del-round={round} onClick={() => del(round)}>Delete all</button></div>
            {list.map(x => (
              <div className="fb-item" key={x.vid}>
                <div className="row"><b>{x.name}</b><span className="stars-static">{stars(x.rating)}</span><span className="spacer" />
                  <span className="small muted">{new Date(x.at).toLocaleTimeString()}</span>
                  <button className="link-btn" data-del-round={round} data-del-vid={x.vid} aria-label="Delete this feedback" onClick={() => del(round, x.vid)}>Delete</button></div>
                {x.comment && <div>{x.comment}</div>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
