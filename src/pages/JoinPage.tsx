import { useEffect, useRef, useState, type FormEvent } from 'react';
import { get, onDisconnect, onValue, serverTimestamp, set } from 'firebase/database';
import type { User } from 'firebase/auth';
import { r } from '../firebase';
import { useLive, useServerNow, useToast } from '../hooks';
import { RevealOverlay, useRevealQueue } from '../components/RevealOverlay';
import {
  BASE, initials, maxPicks, niceError, picksOf, sortedOptions,
  type Ballot, type Category, type Feedback, type FeedbackResponse, type Voter,
} from '../lib';

export function JoinPage({ user, code }: { user: User; code: string }) {
  const base = `meetings/${code}`;
  const [info, setInfo] = useState<{ title: string } | null | undefined>(undefined);
  const [me, setMe] = useState<Voter | null | undefined>(undefined);

  useEffect(() => {
    get(r(`${base}/info`)).then(s => setInfo(s.val()), () => setInfo(null));
    get(r(`${base}/voters/${user.uid}`)).then(s => setMe(s.val()), () => setMe(null)); // returning participant?
  }, [base, user.uid]);
  useEffect(() => { if (info) document.title = info.title + ' · Vote'; }, [info]);

  if (info === undefined || me === undefined) return <div className="empty">Loading…</div>;
  if (info === null) return (
    <div className="narrow card empty"><h2>Meeting not found</h2><p>Check the code “{code}” and try again.</p>
      <a className="btn" href={BASE}>Back</a></div>
  );
  if (!me) return <NameForm base={base} uid={user.uid} title={info.title} onJoined={setMe} />;
  return <Voting base={base} uid={user.uid} title={info.title} me={me} />;
}

function NameForm({ base, uid, title, onJoined }: { base: string; uid: string; title: string; onJoined: (v: Voter) => void }) {
  const [name, setName] = useState(() => localStorage.getItem('voterName') || '');
  const [anon, setAnon] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = anon ? 'Anonymous' : name.trim().slice(0, 40);
    if (!n) return;
    try {
      await set(r(`${base}/voters/${uid}`), { name: n, joinedAt: serverTimestamp(), ...(anon ? { anon: true } : {}) });
      if (!anon) localStorage.setItem('voterName', n);
      onJoined({ name: n, joinedAt: Date.now(), anon });
    } catch (e2) { setErr(niceError(e2)); }
  };
  return (
    <div className="narrow card">
      <p className="muted small" style={{ margin: 0 }}>You're joining</p>
      <h1>{title}</h1>
      <form id="nameForm" onSubmit={submit}>
        <label htmlFor="vname">Your name</label>
        <input id="vname" placeholder="Enter your name" maxLength={40} required={!anon} disabled={anon} autoFocus
          value={name} onChange={e => setName(e.target.value)} />
        <label className="check"><input type="checkbox" id="vanon" checked={anon} onChange={e => setAnon(e.target.checked)} /> Join anonymously</label>
        <p className="small muted" style={{ margin: 0 }}>The host sees “Anonymous” instead of your name. You can still vote only once.</p>
        {err && <p style={{ color: 'var(--red)' }}>{err}</p>}
        <div style={{ height: 14 }} />
        <button className="btn block">Join voting</button>
      </form>
    </div>
  );
}

function Voting({ base, uid, title, me }: { base: string; uid: string; title: string; me: Voter }) {
  const categories = useLive<Record<string, Category>>(`${base}/categories`, {});
  const ballot = useLive<Record<string, Ballot>>(`${base}/ballots/${uid}`, {});
  const feedback = useLive<Feedback | null>(`${base}/feedback`, null);
  const myResponse = useLive<FeedbackResponse | null>(feedback?.round ? `${base}/responses/${feedback.round}/${uid}` : null, null);
  const serverNow = useServerNow();
  const reveal = useRevealQueue(categories, serverNow);
  const [fbHidden, setFbHidden] = useState<string | null>(null); // round the person clicked "Later" on
  const [fbThanks, setFbThanks] = useState<string | null>(null); // round we're showing "Thank you" for

  // presence: counts as "online now" while this page is open
  useEffect(() => onValue(r('.info/connected'), s => {
    if (!s.val()) return;
    const p = r(`${base}/online/${uid}`);
    onDisconnect(p).remove().then(() => set(p, true));
  }), [base, uid]);

  const cats = Object.entries(categories).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
  const open = cats.filter(([, c]) => c.status === 'open');
  const closed = cats.filter(([, c]) => c.status === 'closed');
  const fbPending = feedback?.status === 'open' && !myResponse;
  // Stay open while showing "Thank you", even though the answer is already saved.
  const showFb = !!feedback && ((fbPending && fbHidden !== feedback.round) || fbThanks === feedback.round);

  return (
    <div className="narrow">
      <div className="row" style={{ marginBottom: 12 }}>
        <div><div className="muted small">{title}</div>
          <b>{me.anon ? <>Hi 👋 <span className="muted small">(voting anonymously)</span></> : <>Hi, {me.name} 👋</>}</b></div>
        <span className="spacer" />
        {fbPending && <button className="btn sm" id="fbBtn" onClick={() => setFbHidden(null)}>Give feedback</button>}
      </div>

      {open.length === 0 && (
        <div className="card wait"><div className="big">⏳</div>
          <h2>Waiting for the host<span className="dots"><span>.</span><span>.</span><span>.</span></span></h2>
          <p className="muted">Keep this screen open. Voting appears here automatically.</p></div>
      )}
      {open.map(([cid, c]) => <VoteCard key={cid} base={base} uid={uid} cid={cid} cat={c} ballot={ballot[cid]} />)}

      {closed.length > 0 && <h3 className="muted" style={{ marginTop: 20 }}>Closed</h3>}
      {closed.map(([cid, c]) => {
        const mine = picksOf(ballot[cid]).map(id => c.options?.[id]?.label).filter(Boolean);
        const winners = (c.reveal?.winners ?? []).map(id => c.options?.[id]?.label).filter(Boolean) ?? [];
        return (
          <div className="card small" key={cid}>
            <b>{c.title}</b> — {mine.length ? `you voted for ${mine.join(', ')}` : 'you did not vote'} · voting closed
            {winners.length > 0 && <div className="winner" style={{ marginTop: 8 }}>🏆 Winner: {winners.join(' & ')}</div>}
          </div>
        );
      })}

      {showFb && <FeedbackOverlay base={base} uid={uid} me={me} feedback={feedback!} onLater={() => setFbHidden(feedback!.round)}
        onSending={() => setFbThanks(feedback!.round)} onDone={() => setFbThanks(null)} />}
      {reveal.cat && <RevealOverlay cat={reveal.cat} serverNow={serverNow} onClose={reveal.close} />}
    </div>
  );
}

function VoteCard({ base, uid, cid, cat, ballot }: { base: string; uid: string; cid: string; cat: Category; ballot?: Ballot }) {
  const toast = useToast();
  const [sel, setSel] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const isNew = useRef(true);
  useEffect(() => { isNew.current = false; }, []);
  const mp = maxPicks(cat);
  const mine = picksOf(ballot).map(id => cat.options?.[id]?.label).filter(Boolean);

  if (mine.length) return (
    <div className="card">
      <div className="row"><h2 style={{ margin: 0 }}>{cat.title}</h2><span className="badge open">Live</span></div>
      <div style={{ height: 10 }} />
      <div className="done">✓ Your vote for <b>{mine.join(', ')}</b> is recorded</div>
    </div>
  );

  const toggle = (id: string) => {
    if (mp === 1) return setSel([id]);
    if (sel.includes(id)) return setSel(sel.filter(x => x !== id));
    if (sel.length >= mp) return toast(`You can choose up to ${mp}`, true);
    setSel([...sel, id]);
  };
  const submit = async () => {
    setSending(true);
    try {
      const value = mp === 1 ? sel[0] : Object.fromEntries(sel.map((id, i) => ['s' + i, id]));
      await set(r(`${base}/ballots/${uid}/${cid}`), value);
      toast('Vote recorded ✓');
    } catch {
      toast('Vote not accepted — voting may be closed, or you already voted', true);
      setSending(false);
    }
  };

  return (
    <div className={`card${isNew.current ? ' new-in' : ''}`}>
      <div className="row"><h2 style={{ margin: 0 }}>{cat.title}</h2><span className="badge open"><span className="pulse" />Vote now</span></div>
      <p className="muted small" style={{ margin: '4px 0 0' }}>{mp > 1 ? `Choose up to ${mp}.` : 'Choose one.'} You can vote only once.</p>
      {sortedOptions(cat).map(o => (
        <button key={o.id} className={`option${mp > 1 ? ' multi' : ''}${sel.includes(o.id) ? ' sel' : ''}`} onClick={() => toggle(o.id)}
          role={mp > 1 ? 'checkbox' : 'radio'} aria-checked={sel.includes(o.id)}>
          <span className="radio" /><span className="avatar">{initials(o.label)}</span><span>{o.label}</span>
        </button>
      ))}
      <button className="btn block" data-submit={cid} disabled={!sel.length || sending} onClick={submit}>
        {sending ? 'Sending…' : `Submit vote${mp > 1 ? ` (${sel.length} of ${mp} selected)` : ''}`}
      </button>
    </div>
  );
}

function FeedbackOverlay({ base, uid, me, feedback, onLater, onSending, onDone }: {
  base: string; uid: string; me: Voter; feedback: Feedback; onLater: () => void; onSending: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [thanks, setThanks] = useState(false);

  const send = async () => {
    const c = comment.trim().slice(0, 1000);
    if (!rating && !c) return toast('Give a rating or a comment', true);
    setThanks(true); onSending(); // Firebase updates the screen before the write finishes
    try {
      await set(r(`${base}/responses/${feedback.round}/${uid}`), {
        name: me.name, q: feedback.question, at: serverTimestamp(),
        ...(rating ? { rating } : {}), ...(c ? { comment: c } : {}),
      });
      setTimeout(onDone, 1800);
    } catch (err) {
      setThanks(false); onDone();
      toast(niceError(err) === 'Not allowed' ? 'Feedback is closed or already sent' : niceError(err), true);
    }
  };

  return (
    <div className="overlay" id="fbOverlay">
      <div className="card" role="dialog" aria-modal="true">
        {thanks ? (
          <div className="wait" style={{ padding: 20 }}><div className="big">🙏</div><h2>Thank you!</h2><p className="muted">Your feedback was sent to the host.</p></div>
        ) : (
          <>
            <p className="muted small" style={{ margin: 0 }}>The host would like your feedback</p>
            <h2>{feedback.question}</h2>
            <div className="stars">
              {[1, 2, 3, 4, 5].map(n => (
                <button type="button" key={n} data-star={n} aria-label={`${n} star`} className={n <= rating ? 'on' : ''} onClick={() => setRating(n)}>★</button>
              ))}
            </div>
            <textarea id="fbText" placeholder="Share your thoughts (optional)" maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} />
            <div style={{ height: 12 }} />
            <div className="row">
              <button className="btn ghost" id="fbLater" onClick={onLater}>Later</button>
              <button className="btn" id="fbSend" style={{ flex: 1 }} onClick={send}>Send feedback</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
