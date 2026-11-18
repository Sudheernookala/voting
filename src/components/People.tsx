import type { Voter } from '../lib';

/** "Asha, Ravi, 2 anonymous" */
export function People({ people }: { people: Voter[] }) {
  const named = people.filter(v => !v.anon).map(v => v.name);
  const anon = people.length - named.length;
  return <>{named.join(', ')}{named.length > 0 && anon > 0 && ', '}{anon > 0 && <i>{anon} anonymous</i>}</>;
}
