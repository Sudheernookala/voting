import { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import type { Category, Place } from '../lib';
import { medal, ordinal, plural } from '../lib';

const COUNTDOWN_MS = 3000;
const STEP_MS = 3000; // how long each lower place (e.g. 2nd) is shown before the next
const SHOW_WITHIN_MS = 30_000; // people who open the page later than this just see the result on the card

/** Which revealed category (if any) should be shown full-screen right now. */
export function useRevealQueue(categories: Record<string, Category>, serverNow: () => number) {
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const now = serverNow();
  const next = Object.entries(categories)
    .filter(([cid, c]) => typeof c.reveal?.at === 'number' && now - c.reveal.at < SHOW_WITHIN_MS && !seen.has(`${cid}:${c.reveal.at}`))
    .sort((a, b) => a[1].reveal!.at - b[1].reveal!.at)[0];
  return {
    cat: next?.[1] ?? null,
    close: () => next && setSeen(s => new Set(s).add(`${next[0]}:${next[1].reveal!.at}`)),
  };
}

/**
 * Full-screen reveal. Timed from the server time of the reveal, so every phone and the projector
 * stay in step:  3-2-1 countdown  →  lower places one by one (e.g. 2nd)  →  the winner with confetti
 * and the full podium.
 */
export function RevealOverlay({ cat, serverNow, onClose }: { cat: Category; serverNow: () => number; onClose: () => void }) {
  const reveal = cat.reveal!;
  // Older reveals (and single-choice categories) only have `winners`; treat them as one place.
  const places: Place[] = reveal.places?.length
    ? reveal.places.map(p => ({ ...p, ids: p.ids ?? [] }))       // Firebase drops empty lists
    : [{ place: 1, ids: reveal.winners ?? [], votes: reveal.votes }];
  const lower = places.filter(p => p.place > 1).sort((a, b) => b.place - a.place); // announce 2nd before 1st
  const first = places.find(p => p.place === 1);
  const finalAt = reveal.at + COUNTDOWN_MS + lower.length * STEP_MS;

  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => {
      const n = serverNow();
      setNow(n);
      if (n >= finalAt) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, [finalAt, serverNow]);

  const elapsed = now - reveal.at;
  const stage = elapsed < COUNTDOWN_MS ? -1 : Math.floor((elapsed - COUNTDOWN_MS) / STEP_MS); // -1 = countdown
  const showingLower = stage >= 0 && stage < lower.length ? lower[stage] : null;
  const done = stage >= lower.length;
  const hasWinner = !!first?.ids.length;

  useEffect(() => {
    if (!done || !hasWinner || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fire = (x: number) => confetti({ particleCount: 90, spread: 75, startVelocity: 45, origin: { x, y: 0.7 }, zIndex: 60 });
    fire(0.25); fire(0.75);
    const t = setTimeout(() => fire(0.5), 450);
    return () => clearTimeout(t);
  }, [done, hasWinner]);

  const names = (ids: string[]) => ids.map(id => cat.options?.[id]?.label).filter(Boolean) as string[];
  const multi = places.length > 1;
  const secondsLeft = Math.min(3, Math.ceil((COUNTDOWN_MS - elapsed) / 1000));

  return (
    <div className="reveal" role="dialog" aria-modal="true" aria-live="assertive">
      <div className="reveal-inner">
        <p className="reveal-kicker">{cat.title}</p>
        {stage === -1 ? (
          <>
            <p className="reveal-lead">{multi ? `And the top ${Math.max(...places.map(p => p.place))} are…` : 'And the winner is…'}</p>
            <div className="reveal-count" key={secondsLeft}>{secondsLeft}</div>
          </>
        ) : showingLower ? (
          <div key={`p${showingLower.place}`} className="reveal-step">
            <div className="reveal-trophy">{medal(showingLower.place)}</div>
            <p className="reveal-lead">{ordinal(showingLower.place)} place{showingLower.ids.length > 1 ? ' (tie)' : ''}</p>
            <p className="reveal-name silver">{names(showingLower.ids).join(' & ')}</p>
            <p className="reveal-meta">{plural(showingLower.votes, 'vote')}{showingLower.ids.length > 1 ? ' each' : ''}</p>
          </div>
        ) : !hasWinner ? (
          <p className="reveal-name">No votes were cast</p>
        ) : (
          <div className="reveal-step">
            <div className="reveal-trophy">{multi ? '🥇' : '🏆'}</div>
            <p className="reveal-lead">{first!.ids.length > 1 ? "It's a tie!" : multi ? 'Winner' : ''}</p>
            <p className="reveal-name">{names(first!.ids).join(' & ')}</p>
            <p className="reveal-meta">
              {plural(first!.votes, 'vote')}{first!.ids.length > 1 ? ' each' : ''} · {plural(reveal.voters, 'voter')} took part
            </p>
            {lower.length > 0 && (
              <ul className="podium">
                {[...lower].reverse().map(p => (
                  <li key={p.place}>{medal(p.place)} <b>{ordinal(p.place)}:</b> {names(p.ids).join(' & ')} <span>· {plural(p.votes, 'vote')}</span></li>
                ))}
              </ul>
            )}
          </div>
        )}
        {done && <button className="btn ghost" onClick={onClose} autoFocus>Close</button>}
      </div>
    </div>
  );
}
