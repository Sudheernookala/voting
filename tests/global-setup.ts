import { readFileSync } from 'node:fs';

const DB = 'http://127.0.0.1:9000';
const NS = '?ns=demo-livevote';
const owner = { Authorization: 'Bearer owner' };

/** Loads the real security rules into the emulator and adds a test host to the allow-list. */
export default async function globalSetup() {
  const rules = readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
  const res = await fetch(`${DB}/.settings/rules.json${NS}`, { method: 'PUT', headers: owner, body: rules });
  if (!res.ok) throw new Error('Could not load rules into the emulator: ' + (await res.text()));
  await fetch(`${DB}/.json${NS}`, { method: 'PUT', headers: owner, body: JSON.stringify({ admins: { 'host@example,com': true } }) });
}
