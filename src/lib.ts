import { get, query, orderByValue, endAt, limitToFirst, serverTimestamp, update } from 'firebase/database';
import type { User } from 'firebase/auth';
import { r } from './firebase';

// ---------- data types (same structure as database.rules.json) ----------
export type Status = 'draft' | 'open' | 'closed';
export interface Option { label: string; order: number }
/** One finishing place. Several ids = a tie for that place. */
export interface Place { place: number; ids: string[]; votes: number }
export interface Reveal {
  at: number; winners: string[]; votes: number; voters: number;
  places?: Place[];        // multiple choice: top N (1st, 2nd, ...)
}
export interface Category {
  title: string; status: Status; createdAt: number;
  options: Record<string, Option>;
  multi?: number;          // max picks per voter (absent = single choice)
  reveal?: Reveal;         // set when the host reveals the winner
}
export interface Voter { name: string; joinedAt: number; anon?: boolean }
export interface Feedback { status: 'open' | 'closed'; round: string; question: string }
export interface FeedbackResponse { name: string; q: string; at: number; rating?: number; comment?: string }
/** Option id (single choice) or { s0: id, s1: id, ... } (multiple choice). */
export type Ballot = string | Record<string, string>;
export interface HostMeeting { title: string; key: string; createdAt: number }

// ---------- small helpers ----------
export const KEEP_DAYS = 30;
export const DAY = 86_400_000;
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const initials = (s: string) => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
export const randHex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
/** Firebase keys can't contain "." so emails are stored with "," instead (same as the security rules). */
export const emailKey = (e: string) => e.trim().toLowerCase().replace(/\./g, ',');
export const keyToEmail = (k: string) => k.replace(/,/g, '.');
export const BASE = location.origin + location.pathname.replace(/index\.html$/, '');
export const isPermissionError = (e: unknown) => /permission/i.test(String((e as Error)?.message ?? e));
export const niceError = (e: unknown) => (isPermissionError(e) ? 'Not allowed' : (e as Error)?.message || 'Something went wrong');

export const sortedOptions = (c: Category) =>
  Object.entries(c.options || {}).map(([id, o]) => ({ id, ...o })).sort((a, b) => a.order - b.order);
export const picksOf = (b: Ballot | undefined | null): string[] =>
  typeof b === 'string' ? [b] : b && typeof b === 'object' ? [...new Set(Object.values(b))] : [];
export const maxPicks = (c?: Category) => Math.max(1, c?.multi || 1);

// ---------- results ----------
export interface OptionResult { id: string; label: string; order: number; count: number; people: Voter[] }
export interface Results {
  options: OptionResult[]; total: number; max: number;
  winners: OptionResult[]; tie: boolean; notVoted: Voter[];
}
export function computeResults(cat: Category, catId: string, ballots: Record<string, Record<string, Ballot>>,
  voters: Record<string, Voter>): Results {
  const options: OptionResult[] = sortedOptions(cat).map(o => ({ ...o, count: 0, people: [] }));
  const byId = Object.fromEntries(options.map(o => [o.id, o]));
  const voted = new Set<string>();
  for (const [vid, b] of Object.entries(ballots)) {
    const picks = picksOf(b?.[catId]).filter(id => byId[id]);
    if (!picks.length) continue;
    voted.add(vid);
    for (const id of picks) { byId[id].count++; byId[id].people.push(voters[vid] || { name: 'Unknown', joinedAt: 0 }); }
  }
  const max = Math.max(0, ...options.map(o => o.count));
  const winners = max > 0 ? options.filter(o => o.count === max) : [];
  const notVoted = Object.entries(voters).filter(([vid]) => !voted.has(vid)).map(([, v]) => v);
  return { options, total: voted.size, max, winners, tie: winners.length > 1, notVoted };
}

// ---------- meetings ----------
export async function createMeeting(user: User, title: string) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => chars[b % chars.length]).join('');
    const key = randHex(16);
    try {
      // One atomic write. Fails if the code is taken or you're not on the host list.
      await update(r('/'), {
        [`hostSecrets/${code}`]: key,
        [`meetings/${code}/hosts/${user.uid}`]: key,
        [`meetings/${code}/info`]: { title, createdAt: serverTimestamp() },
        [`meetingIndex/${code}`]: serverTimestamp(),
        [`hostMeetings/${emailKey(user.email!)}/${code}`]: { title, key, createdAt: serverTimestamp() },
      });
      return { code, key };
    } catch (e) { if (attempt === 4) throw e; } // a taken code also fails, so retry with a new one
  }
  throw new Error('Could not create meeting');
}

export const deleteMeeting = (user: User, code: string) => update(r('/'), {
  [`meetings/${code}`]: null, [`hostSecrets/${code}`]: null, [`meetingIndex/${code}`]: null,
  [`hostMeetings/${emailKey(user.email!)}/${code}`]: null,
});

/** No server, so cleanup of meetings older than 30 days runs whenever a host opens the home page. */
export async function cleanupOldMeetings() {
  const cutoff = Date.now() - KEEP_DAYS * DAY - 60_000;
  const snap = await get(query(r('meetingIndex'), orderByValue(), endAt(cutoff), limitToFirst(50))).catch(() => null);
  for (const code of Object.keys(snap?.val() || {})) {
    await update(r('/'), { [`meetings/${code}`]: null, [`hostSecrets/${code}`]: null, [`meetingIndex/${code}`]: null })
      .catch(() => {});
  }
}

/**
 * Top places using standard sports ranking: tied options share a place and the next place is skipped
 * (5, 5, 3 votes -> 1st, 1st, 3rd). Returns places up to `n` (e.g. top 2), ignoring options with no votes.
 */
export function rankPlaces(options: { id: string; count: number }[], n: number): Place[] {
  const voted = options.filter(o => o.count > 0);
  const places: Place[] = [];
  for (const count of [...new Set(voted.map(o => o.count))].sort((a, b) => b - a)) {
    const place = 1 + voted.filter(o => o.count > count).length;
    if (place > n) break;
    places.push({ place, ids: voted.filter(o => o.count === count).map(o => o.id), votes: count });
  }
  return places;
}

/** How many places a category ranks: top N for "up to N" categories, otherwise just the winner. */
export const placesToShow = (c: Category) => maxPicks(c);

export const ordinal = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
export const medal = (place: number) => ['🥇', '🥈', '🥉'][place - 1] || '🏅';

/** Closes voting and publishes the result, which triggers the reveal animation on every screen. */
export const revealWinner = (code: string, catId: string, cat: Category, res: Results) => {
  const places = rankPlaces(res.options, placesToShow(cat));
  return update(r(`meetings/${code}/categories/${catId}`), {
    status: 'closed',
    reveal: {
      at: serverTimestamp(), winners: res.winners.map(w => w.id), votes: res.max, voters: res.total,
      ...(placesToShow(cat) > 1 ? { places } : {}),
    },
  });
};

// ---------- CSV export ----------
export function exportCsv(code: string, categories: Record<string, Category>, ballots: Record<string, Record<string, Ballot>>,
  voters: Record<string, Voter>, responses: Record<string, Record<string, FeedbackResponse>>) {
  const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows: unknown[][] = [['Category', 'Voter', 'Voted for']];
  for (const [cid, c] of Object.entries(categories)) {
    for (const [vid, b] of Object.entries(ballots)) {
      for (const id of picksOf(b?.[cid])) {
        const opt = c.options?.[id];
        if (opt) rows.push([c.title, voters[vid]?.name || 'Unknown', opt.label]);
      }
    }
  }
  rows.push([], ['Feedback question', 'Name', 'Rating', 'Comment']);
  for (const round of Object.values(responses)) {
    for (const x of Object.values(round)) rows.push([x.q, x.name, x.rating || '', x.comment || '']);
  }
  const blob = new Blob([rows.map(row => row.map(q).join(',')).join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `results-${code}.csv` });
  a.click(); URL.revokeObjectURL(a.href);
}
