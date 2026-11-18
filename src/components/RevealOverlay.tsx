import { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import type { Category } from '../lib';
import { plural } from '../lib';

const COUNTDOWN_MS = 3000;
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
 * Full-screen "And the winner is…" animation. The countdown is tied to the server time of the
 * reveal, so every phone and the projector hit "1" at about the same moment.
 */
export function RevealOverlay({ cat, serverNow, onClose }: { cat: Category; serverNow: () => number; onClose: () => void }) {
  const reveal = cat.reveal!;
  const endsAt = reveal.at + COUNTDOWN_MS;
  const [left, setLeft] = useState(() => Math.max(0, endsAt - serverNow()));

  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, endsAt - serverNow());
      setLeft(l);
      if (l <= 0) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, [endsAt, serverNow]);

  const done = left <= 0;
  const winnerIds = reveal.winners ?? []; // Firebase drops empty lists
  const hasWinner = winnerIds.length > 0;
  useEffect(() => {
    if (!done || !hasWinner || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fire = (x: number) => confetti({ particleCount: 90, spread: 75, startVelocity: 45, origin: { x, y: 0.7 }, zIndex: 60 });
    fire(0.25); fire(0.75);
    const t = setTimeout(() => fire(0.5), 450);
    return () => clearTimeout(t);
  }, [done, hasWinner]);

  const names = winnerIds.map(id => cat.options?.[id]?.label).filter(Boolean) as string[];
  return (
    <div className="reveal" role="dialog" aria-modal="true" aria-live="assertive">
      <div className="reveal-inner">
        <p className="reveal-kicker">{cat.title}</p>
        {!done ? (
          <>
            <p className="reveal-lead">And the winner is…</p>
            <div className="reveal-count" key={Math.min(3, Math.ceil(left / 1000))}>{Math.min(3, Math.ceil(left / 1000))}</div>
          </>
        ) : names.length === 0 ? (
          <p className="reveal-name">No votes were cast</p>
        ) : (
          <>
            <div className="reveal-trophy">🏆</div>
            {names.length > 1 && <p className="reveal-lead">It's a tie!</p>}
            <p className="reveal-name">{names.join(' & ')}</p>
            <p className="reveal-meta">
              {plural(reveal.votes, 'vote')}{names.length > 1 ? ' each' : ''} · {plural(reveal.voters, 'voter')} took part
            </p>
          </>
        )}
        {done && <button className="btn ghost" onClick={onClose} autoFocus>Close</button>}
      </div>
    </div>
  );
}
