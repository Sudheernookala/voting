import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getDatabase, ref, onValue, set, update, get, remove, push, serverTimestamp, onDisconnect, connectDatabaseEmulator,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

// ---------- helpers ----------
const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const initials = s => s.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const randHex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const BASE = location.origin + location.pathname.replace(/index\.html$/, '');

function toast(msg, err = false) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (t.className = 'toast'), 2800);
}
function niceError(e) {
  return /permission|PERMISSION_DENIED/i.test(e?.message || e?.code || '') ? 'Not allowed' : (e?.message || 'Something went wrong');
}

// ---------- Firebase setup ----------
if (firebaseConfig.apiKey.startsWith('PASTE')) {
  $app.innerHTML = `<div class="narrow card"><h2>Setup needed</h2>
    <p>Open <b>firebase-config.js</b> and paste your Firebase project config. See README.md, step 1–3.</p></div>`;
  throw new Error('Firebase config missing');
}
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getDatabase(fbApp);
if (firebaseConfig.emulatorHost) { // only used for local testing
  connectAuthEmulator(auth, `http://${firebaseConfig.emulatorHost}:9099`, { disableWarnings: true });
  connectDatabaseEmulator(db, firebaseConfig.emulatorHost, 9000);
}
const r = path => ref(db, path);

const conn = document.getElementById('conn');
onValue(r('.info/connected'), s => { conn.className = 'conn ' + (s.val() ? 'on' : 'off'); });

const uid = await new Promise((resolve, reject) => {
  const stop = onAuthStateChanged(auth, u => { if (u) { stop(); resolve(u.uid); } });
  signInAnonymously(auth).catch(e => {
    $app.innerHTML = `<div class="narrow card"><h2>Can't connect</h2><p>${esc(e.message)}</p>
      <p class="muted">Check that Anonymous sign-in is enabled in Firebase → Authentication → Sign-in method.</p></div>`;
    reject(e);
  });
});

// ---------- router ----------
const params = new URLSearchParams(location.search);
if (params.get('host')) hostPage(params.get('host').toUpperCase(), params.get('key'));
else if (params.get('join')) joinPage(params.get('join').toUpperCase());
else homePage();

// ================= HOME =================
async function createMeeting(title) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => chars[b % chars.length]).join('');
    const key = randHex(16);
    try {
      // One atomic write: secret + me as host + meeting info. Fails if the code is already taken.
      await update(r('/'), {
        [`hostSecrets/${code}`]: key,
        [`meetings/${code}/hosts/${uid}`]: key,
        [`meetings/${code}/info`]: { title, createdAt: serverTimestamp() },
      });
      return { code, key };
    } catch (e) { if (attempt === 4) throw e; }
  }
}

function homePage() {
  $app.innerHTML = `
    <div class="narrow">
      <div class="hero">
        <h1>Live voting for your meeting</h1>
        <p class="muted">Create categories, share a QR code, and watch votes arrive in real time.</p>
      </div>
      <div class="card">
        <h2>Host a meeting</h2>
        <form id="createForm">
          <label for="mtitle">Meeting name</label>
          <input id="mtitle" placeholder="e.g. Annual Awards Night 2026" maxlength="100" required>
          <div style="height:14px"></div>
          <button class="btn block">Create meeting</button>
        </form>
      </div>
      <p class="or">or</p>
      <div class="card">
        <h2>Join a vote</h2>
        <form id="joinForm" class="row">
          <input id="jcode" placeholder="Enter 6-letter code" maxlength="6" style="flex:1;text-transform:uppercase;letter-spacing:.15em" required>
          <button class="btn ghost">Join</button>
        </form>
      </div>
    </div>`;
  document.getElementById('createForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const { code, key } = await createMeeting(document.getElementById('mtitle').value.trim().slice(0, 100));
      store.set('hostKey:' + code, key);
      location.href = `${BASE}?host=${code}&key=${key}`;
    } catch (err) { toast(niceError(err), true); btn.disabled = false; btn.textContent = 'Create meeting'; }
  };
  document.getElementById('joinForm').onsubmit = e => {
    e.preventDefault();
    location.href = `${BASE}?join=${document.getElementById('jcode').value.trim().toUpperCase()}`;
  };
}

// ================= HOST =================
function computeResults(cat, catId, ballots, voters) {
  const options = Object.entries(cat.options || {}).map(([id, o]) => ({ id, label: o.label, order: o.order, count: 0, voters: [] }))
    .sort((a, b) => a.order - b.order);
  const byId = Object.fromEntries(options.map(o => [o.id, o]));
  const voted = new Set();
  for (const [vid, b] of Object.entries(ballots)) {
    const o = byId[b?.[catId]];
    if (!o) continue;
    o.count++; o.voters.push(voters[vid]?.name || 'Unknown'); voted.add(vid);
  }
  const total = voted.size;
  const max = Math.max(0, ...options.map(o => o.count));
  const winners = max > 0 ? options.filter(o => o.count === max).map(o => o.label) : [];
  const notVoted = Object.entries(voters).filter(([vid]) => !voted.has(vid)).map(([, v]) => v.name);
  return { options, total, max, winners, tie: winners.length > 1, notVoted };
}

async function hostPage(code, urlKey) {
  if (urlKey) store.set('hostKey:' + code, urlKey);
  const key = urlKey || store.get('hostKey:' + code);
  try {
    if (!key) throw new Error('no key');
    await set(r(`meetings/${code}/hosts/${uid}`), key); // proves I hold the host key (checked by the rules)
  } catch {
    $app.innerHTML = `<div class="card narrow empty"><h2>Can't open host dashboard</h2>
      <p>Invalid meeting or host key. Use the private host link you got when you created the meeting.</p><a class="btn" href="${BASE}">Home</a></div>`;
    return;
  }

  const joinUrl = `${BASE}?join=${code}`;
  const hostUrl = `${BASE}?host=${code}&key=${key}`;
  const qr = qrcode(0, 'M'); qr.addData(joinUrl); qr.make();
  const S = { info: {}, categories: {}, feedback: null, voters: {}, ballots: {}, responses: {}, online: {} };
  const openDetails = new Set();
  let options = [];

  $app.innerHTML = `
    <div class="host-grid">
      <aside>
        <div class="card share">
          <h2 id="mTitle">Loading…</h2>
          <p class="muted small">Participants scan or open the link to join</p>
          ${qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true, alt: 'QR code to join' })}
          <div class="code">${code}</div>
          <div class="link">${esc(joinUrl)}</div>
          <div class="row" style="justify-content:center">
            <button class="btn sm ghost" id="copyJoin">Copy link</button>
            <a class="btn sm ghost" href="${qr.createDataURL(10, 4)}" download="join-${code}.gif">Download QR</a>
          </div>
          <div class="stats">
            <div class="stat"><b id="sJoined">0</b><span class="small muted">joined</span></div>
            <div class="stat"><b id="sOnline">0</b><span class="small muted">online now</span></div>
          </div>
          <details><summary>Who has joined</summary><ul class="voter-list" id="joinedList"></ul></details>
        </div>

        <div class="card">
          <h2>New voting category</h2>
          <form id="catForm">
            <label for="ctitle">Category</label>
            <input id="ctitle" placeholder="e.g. Best Speaker" maxlength="100">
            <label for="opt">Options / participants</label>
            <div class="row">
              <input id="opt" placeholder="Type a name, press Enter" style="flex:1" maxlength="80">
              <button type="button" class="btn sm ghost" id="addOpt">Add</button>
            </div>
            <p class="small muted" style="margin:6px 0 0">Tip: paste several names separated by commas or new lines.</p>
            <div class="chips" id="chips"></div>
            <div style="height:14px"></div>
            <div class="row">
              <button class="btn green" data-open="1" style="flex:1">Create &amp; start voting</button>
              <button class="btn ghost" data-open="0">Save as draft</button>
            </div>
          </form>
        </div>

        <div class="card">
          <h2>Feedback</h2>
          <div id="fbControls"></div>
        </div>

        <div class="card small">
          <b>Your host link</b> (keep private — anyone with it can control this meeting)
          <div class="link">${esc(hostUrl)}</div>
          <div class="row">
            <button class="btn sm ghost" id="copyHost">Copy host link</button>
            <button class="btn sm ghost" id="exportCsv">Export results (CSV)</button>
          </div>
        </div>
      </aside>
      <section>
        <div id="cats"></div>
        <div class="card" id="fbResults"></div>
      </section>
    </div>`;

  const copy = (txt, msg) => navigator.clipboard.writeText(txt).then(() => toast(msg), () => toast(txt));
  document.getElementById('copyJoin').onclick = () => copy(joinUrl, 'Join link copied');
  document.getElementById('copyHost').onclick = () => copy(hostUrl, 'Host link copied');

  // --- option chips ---
  const optInput = document.getElementById('opt');
  function addOptions(text) {
    text.split(/[,\n]/).map(s => s.trim().slice(0, 80)).filter(Boolean).forEach(o => {
      if (!options.some(x => x.toLowerCase() === o.toLowerCase())) options.push(o);
    });
    optInput.value = ''; renderChips();
  }
  function renderChips() {
    document.getElementById('chips').innerHTML = options.map((o, i) =>
      `<span class="chip">${esc(o)}<button type="button" data-i="${i}" aria-label="Remove">×</button></span>`).join('');
  }
  document.getElementById('chips').onclick = e => {
    if (e.target.dataset.i !== undefined) { options.splice(+e.target.dataset.i, 1); renderChips(); }
  };
  document.getElementById('addOpt').onclick = () => { addOptions(optInput.value); optInput.focus(); };
  optInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addOptions(optInput.value); } });
  optInput.addEventListener('paste', e => {
    const t = e.clipboardData.getData('text');
    if (/[,\n]/.test(t)) { e.preventDefault(); addOptions(t); }
  });

  let openNow = true;
  document.querySelectorAll('#catForm [data-open]').forEach(b => b.onclick = () => (openNow = b.dataset.open === '1'));
  document.getElementById('catForm').onsubmit = async e => {
    e.preventDefault();
    if (optInput.value.trim()) addOptions(optInput.value);
    const title = document.getElementById('ctitle').value.trim().slice(0, 100);
    if (!title) return toast('Category name is required', true);
    if (options.length < 2) return toast('Add at least 2 options or participants', true);
    try {
      await push(r(`meetings/${code}/categories`), {
        title, status: openNow ? 'open' : 'draft', createdAt: serverTimestamp(),
        options: Object.fromEntries(options.map((label, i) => ['o' + randHex(4), { label, order: i }])),
      });
      toast(openNow ? 'Voting started — participants can vote now' : 'Saved as draft');
      document.getElementById('ctitle').value = ''; options = []; renderChips();
    } catch (err) { toast(niceError(err), true); }
  };

  document.getElementById('cats').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const { act, id } = b.dataset;
    try {
      if (act === 'delete') {
        if (confirm('Delete this category? Its results will no longer be shown.')) await remove(r(`meetings/${code}/categories/${id}`));
      } else await set(r(`meetings/${code}/categories/${id}/status`), act);
    } catch (err) { toast(niceError(err), true); }
  });
  document.getElementById('cats').addEventListener('toggle', e => {
    const id = e.target.dataset?.cat;
    if (id) e.target.open ? openDetails.add(id) : openDetails.delete(id);
  }, true);

  // --- export CSV ---
  document.getElementById('exportCsv').onclick = () => {
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['Category', 'Voter', 'Voted for']];
    for (const [cid, c] of Object.entries(S.categories)) {
      for (const [vid, b] of Object.entries(S.ballots)) {
        const opt = c.options?.[b?.[cid]];
        if (opt) rows.push([c.title, S.voters[vid]?.name || 'Unknown', opt.label]);
      }
    }
    rows.push([], ['Feedback question', 'Name', 'Rating', 'Comment']);
    for (const round of Object.values(S.responses)) {
      for (const x of Object.values(round)) rows.push([x.q, x.name, x.rating || '', x.comment || '']);
    }
    const blob = new Blob([rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `results-${code}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  };

  // --- feedback controls ---
  document.getElementById('fbControls').addEventListener('click', async e => {
    try {
      if (e.target.id === 'fbOpen') {
        const question = (document.getElementById('fbQ').value.trim() || 'How was this meeting?').slice(0, 300);
        await set(r(`meetings/${code}/feedback`), { status: 'open', round: Date.now().toString(36), question });
        toast('Feedback form sent to all participants');
      }
      if (e.target.id === 'fbClose') await set(r(`meetings/${code}/feedback/status`), 'closed');
    } catch (err) { toast(niceError(err), true); }
  });

  // --- rendering ---
  function renderCats() {
    const el = document.getElementById('cats');
    const cats = Object.entries(S.categories).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    const voterCount = Object.keys(S.voters).length;
    if (!cats.length) {
      el.innerHTML = `<div class="card empty"><div style="font-size:2.4rem">🗳️</div>
        <h3>No voting categories yet</h3><p>Create one on the left. Participants see it the moment you start it.</p></div>`;
      return;
    }
    el.innerHTML = cats.map(([cid, c]) => {
      const res = computeResults(c, cid, S.ballots, S.voters);
      const turnout = voterCount ? Math.round(res.total / voterCount * 100) : 0;
      const bars = [...res.options].sort((a, b) => b.count - a.count).map(o => {
        const pct = res.total ? Math.round(o.count / res.total * 100) : 0;
        const win = res.max > 0 && o.count === res.max;
        return `<div class="bar ${win ? 'win' : ''}">
          <div class="bar-top"><span>${win ? '🏆 ' : ''}${esc(o.label)}</span><span><b>${o.count}</b> <span class="muted">(${pct}%)</span></span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
      }).join('');
      let winner = '';
      if (res.total && res.tie) winner = `<div class="winner tie">🤝 Tie between ${res.winners.map(esc).join(' & ')} (${res.max} votes each)</div>`;
      else if (res.total) winner = `<div class="winner">🏆 ${c.status === 'closed' ? 'Winner' : 'Leading'}: ${esc(res.winners[0])} with ${plural(res.max, 'vote')}</div>`;
      const badge = c.status === 'open' ? '<span class="badge open"><span class="pulse"></span>Live</span>'
        : `<span class="badge ${c.status}">${c.status}</span>`;
      const action = c.status === 'open'
        ? `<button class="btn sm" data-act="closed" data-id="${cid}">Close voting</button>`
        : `<button class="btn sm green" data-act="open" data-id="${cid}">${c.status === 'draft' ? 'Start voting' : 'Reopen'}</button>`;
      const who = res.options.filter(o => o.voters.length).map(o =>
        `<li><b>${esc(o.label)}:</b> ${o.voters.map(esc).join(', ')}</li>`).join('') || '<li>No votes yet</li>';
      return `<div class="card">
        <div class="row"><h2 style="margin:0">${esc(c.title)}</h2>${badge}<span class="spacer"></span>${action}
          <button class="btn sm red" data-act="delete" data-id="${cid}">Delete</button></div>
        <p class="muted small" style="margin:6px 0 0"><b>${plural(res.total, 'vote')}</b> received out of ${voterCount} joined · ${turnout}% turnout</p>
        ${bars}${winner}
        <details data-cat="${cid}" ${openDetails.has(cid) ? 'open' : ''}><summary>Verify: who voted for whom</summary>
          <ul class="voter-list">${who}</ul>
          ${res.notVoted.length ? `<p class="small muted" style="margin-top:6px">Not voted yet: ${res.notVoted.map(esc).join(', ')}</p>` : ''}
        </details></div>`;
    }).join('');
  }

  function renderFeedback() {
    const fb = S.feedback;
    const ctl = document.getElementById('fbControls');
    if (fb?.status === 'open') {
      ctl.innerHTML = `<p><span class="badge open"><span class="pulse"></span>Collecting</span></p>
        <p class="small">“${esc(fb.question)}”</p>
        <button class="btn block" id="fbClose">Stop collecting feedback</button>`;
    } else if (!ctl.querySelector('#fbQ')) {
      ctl.innerHTML = `<p class="small muted">Every participant's screen switches to a feedback form.</p>
        <input id="fbQ" placeholder="How was this meeting?" value="${esc(fb?.question || '')}" maxlength="300">
        <div style="height:10px"></div>
        <button class="btn block ghost" id="fbOpen">Ask for feedback</button>`;
    }
    const stars = n => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '';
    const rounds = Object.entries(S.responses).sort((a, b) => b[0].localeCompare(a[0]));
    const total = rounds.reduce((n, [, x]) => n + Object.keys(x).length, 0);
    const body = rounds.map(([, resp]) => {
      const list = Object.values(resp).sort((a, b) => b.at - a.at);
      const ratings = list.filter(x => x.rating).map(x => x.rating);
      const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
      return `<div class="round-title">“${esc(list[0]?.q)}” ${avg ? `<span class="stars-static">${stars(Math.round(avg))}</span> <b>${avg.toFixed(1)}</b>/5` : ''}
          <span class="muted small">· ${plural(list.length, 'response')}</span></div>` +
        list.map(x => `<div class="fb-item"><div class="row"><b>${esc(x.name)}</b><span class="stars-static">${stars(x.rating)}</span>
          <span class="spacer"></span><span class="small muted">${new Date(x.at).toLocaleTimeString()}</span></div>
          ${x.comment ? `<div>${esc(x.comment)}</div>` : ''}</div>`).join('');
    }).join('');
    document.getElementById('fbResults').innerHTML = `<div class="row"><h2 style="margin:0">Feedback</h2><span class="spacer"></span>
      <span class="muted small">${plural(total, 'response')}</span></div>${body || '<p class="muted" style="margin-top:10px">No feedback yet.</p>'}`;
  }

  let queued = false;
  function render() {
    if (queued) return; queued = true;
    requestAnimationFrame(() => {
      queued = false;
      document.getElementById('mTitle').textContent = S.info.title || '';
      document.title = (S.info.title || 'Meeting') + ' · Host';
      document.getElementById('sJoined').textContent = Object.keys(S.voters).length;
      document.getElementById('sOnline').textContent = Object.keys(S.online).length;
      document.getElementById('joinedList').innerHTML = Object.values(S.voters).map(v => `<li>${esc(v.name)}</li>`).join('') || '<li>Nobody yet</li>';
      renderCats(); renderFeedback();
    });
  }
  for (const k of Object.keys(S)) {
    onValue(r(`meetings/${code}/${k}`), snap => { S[k] = snap.val() || (k === 'feedback' ? null : {}); render(); },
      err => toast(niceError(err), true));
  }
}

// ================= PARTICIPANT =================
async function joinPage(code) {
  const base = `meetings/${code}`;
  const info = (await get(r(`${base}/info`)).catch(() => null))?.val();
  if (!info) {
    $app.innerHTML = `<div class="narrow card empty"><h2>Meeting not found</h2><p>Check the code “${esc(code)}” and try again.</p><a class="btn" href="${BASE}">Back</a></div>`;
    return;
  }
  document.title = info.title + ' · Vote';

  let me = (await get(r(`${base}/voters/${uid}`))).val(); // returning participant?
  const S = { categories: {}, feedback: null, ballot: {}, myResponse: null };
  const selected = {};
  const seen = new Set();
  let fbShownFor = null, fbDismissed = false, rating = 0, lastFbRound = null, stopResp = null;

  function showNameForm(err) {
    $app.innerHTML = `<div class="narrow card">
      <p class="muted small" style="margin:0">You're joining</p>
      <h1>${esc(info.title)}</h1>
      <form id="nameForm">
        <label for="vname">Your name</label>
        <input id="vname" placeholder="Enter your name" maxlength="40" required value="${esc(store.get('voterName') || '')}">
        ${err ? `<p style="color:var(--red)">${esc(err)}</p>` : ''}
        <div style="height:14px"></div>
        <button class="btn block">Join voting</button>
      </form></div>`;
    const inp = document.getElementById('vname'); inp.focus();
    document.getElementById('nameForm').onsubmit = async e => {
      e.preventDefault();
      const name = inp.value.trim().slice(0, 40);
      if (!name) return;
      try {
        await set(r(`${base}/voters/${uid}`), { name, joinedAt: serverTimestamp() });
        store.set('voterName', name);
        me = { name };
        start();
      } catch (err) { showNameForm(niceError(err)); }
    };
  }

  function start() {
    // presence: counts as "online now" until the tab closes
    onValue(r('.info/connected'), s => {
      if (!s.val()) return;
      const p = r(`${base}/online/${uid}`);
      onDisconnect(p).remove().then(() => set(p, true));
    });
    onValue(r(`${base}/categories`), s => { S.categories = s.val() || {}; render(); });
    onValue(r(`${base}/ballots/${uid}`), s => { S.ballot = s.val() || {}; render(); });
    onValue(r(`${base}/feedback`), s => {
      S.feedback = s.val();
      const round = S.feedback?.round;
      if (round !== lastFbRound) { // new feedback request: listen for my own answer to it
        lastFbRound = round; fbDismissed = false; S.myResponse = null;
        stopResp?.();
        stopResp = round ? onValue(r(`${base}/responses/${round}/${uid}`), x => { S.myResponse = x.val(); render(); syncFeedback(); }) : null;
      }
      render(); syncFeedback();
    });
  }

  const submitted = () => !!S.myResponse;

  function render() {
    const cats = Object.entries(S.categories).sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));
    const open = cats.filter(([, c]) => c.status === 'open');
    const closed = cats.filter(([, c]) => c.status === 'closed');
    const opts = c => Object.entries(c.options || {}).map(([id, o]) => ({ id, ...o })).sort((a, b) => a.order - b.order);
    const fbPending = S.feedback?.status === 'open' && !submitted();
    let html = `<div class="narrow">
      <div class="row" style="margin-bottom:12px"><div><div class="muted small">${esc(info.title)}</div>
      <b>Hi, ${esc(me.name)} 👋</b></div><span class="spacer"></span>
      ${fbPending ? '<button class="btn sm" id="fbBtn">Give feedback</button>' : ''}</div>`;

    if (!open.length) {
      html += `<div class="card wait"><div class="big">⏳</div>
        <h2>Waiting for the host<span class="dots"><span>.</span><span>.</span><span>.</span></span></h2>
        <p class="muted">Keep this screen open. Voting appears here automatically.</p></div>`;
    }
    for (const [cid, c] of open) {
      const isNew = !seen.has(cid); seen.add(cid);
      const mine = S.ballot[cid];
      if (mine) {
        html += `<div class="card ${isNew ? 'new-in' : ''}"><div class="row"><h2 style="margin:0">${esc(c.title)}</h2>
          <span class="badge open">Live</span></div><div style="height:10px"></div>
          <div class="done">✓ Your vote for <b>${esc(c.options?.[mine]?.label)}</b> is recorded</div></div>`;
        continue;
      }
      html += `<div class="card ${isNew ? 'new-in' : ''}"><div class="row"><h2 style="margin:0">${esc(c.title)}</h2>
        <span class="badge open"><span class="pulse"></span>Vote now</span></div>
        <p class="muted small" style="margin:4px 0 0">Choose one. You can vote only once.</p>
        ${opts(c).map(o => `<button class="option ${selected[cid] === o.id ? 'sel' : ''}" data-cat="${cid}" data-opt="${o.id}">
          <span class="radio"></span><span class="avatar">${esc(initials(o.label))}</span><span>${esc(o.label)}</span></button>`).join('')}
        <button class="btn block" data-submit="${cid}" ${selected[cid] ? '' : 'disabled'}>Submit vote</button></div>`;
    }
    if (closed.length) {
      html += `<h3 class="muted" style="margin-top:20px">Closed</h3>` + closed.map(([cid, c]) => {
        const o = c.options?.[S.ballot[cid]];
        return `<div class="card small"><b>${esc(c.title)}</b> — ${o ? `you voted for ${esc(o.label)}` : 'you did not vote'} · voting closed</div>`;
      }).join('');
    }
    $app.innerHTML = html + '</div>';
    const fbBtn = document.getElementById('fbBtn');
    if (fbBtn) fbBtn.onclick = () => { fbDismissed = false; fbShownFor = null; syncFeedback(); };
  }

  $app.addEventListener('click', async e => {
    const opt = e.target.closest('.option');
    if (opt) { selected[opt.dataset.cat] = opt.dataset.opt; render(); return; }
    const sub = e.target.closest('[data-submit]');
    if (sub) {
      const cid = sub.dataset.submit;
      sub.disabled = true; sub.textContent = 'Sending…';
      try {
        await set(r(`${base}/ballots/${uid}/${cid}`), selected[cid]);
        delete selected[cid]; toast('Vote recorded ✓');
      } catch {
        toast('Vote not accepted — voting may be closed, or you already voted', true); render();
      }
    }
  });

  // Feedback overlay lives outside the main render so typing isn't wiped by live updates.
  function syncFeedback() {
    const fb = S.feedback;
    let ov = document.getElementById('fbOverlay');
    if (ov?.dataset.done) return; // showing the thank-you message
    const should = fb?.status === 'open' && !submitted() && !fbDismissed;
    if (!should) { ov?.remove(); fbShownFor = null; return; }
    if (ov && fbShownFor === fb.round) return;
    ov?.remove();
    fbShownFor = fb.round; rating = 0;
    ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = 'fbOverlay';
    ov.innerHTML = `<div class="card" role="dialog" aria-modal="true">
      <p class="muted small" style="margin:0">The host would like your feedback</p>
      <h2>${esc(fb.question)}</h2>
      <div class="stars">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}" aria-label="${n} star">★</button>`).join('')}</div>
      <textarea id="fbText" placeholder="Share your thoughts (optional)" maxlength="1000"></textarea>
      <div style="height:12px"></div>
      <div class="row"><button class="btn ghost" id="fbLater">Later</button><button class="btn" id="fbSend" style="flex:1">Send feedback</button></div>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector('.stars').onclick = e => {
      const n = +e.target.dataset.star; if (!n) return;
      rating = n;
      ov.querySelectorAll('[data-star]').forEach(b => b.classList.toggle('on', +b.dataset.star <= n));
    };
    ov.querySelector('#fbLater').onclick = () => { fbDismissed = true; syncFeedback(); };
    ov.querySelector('#fbSend').onclick = async () => {
      const comment = ov.querySelector('#fbText').value.trim().slice(0, 1000);
      if (!rating && !comment) return toast('Give a rating or a comment', true);
      const data = { name: me.name, q: fb.question, at: serverTimestamp() };
      if (rating) data.rating = rating;
      if (comment) data.comment = comment;
      ov.dataset.done = '1'; // set first: Firebase fires local updates before the write finishes
      try {
        await set(r(`${base}/responses/${fb.round}/${uid}`), data);
        ov.querySelector('.card').innerHTML = `<div class="wait" style="padding:20px"><div class="big">🙏</div><h2>Thank you!</h2><p class="muted">Your feedback was sent to the host.</p></div>`;
        setTimeout(() => ov.remove(), 1800);
      } catch (err) {
        delete ov.dataset.done;
        toast(niceError(err) === 'Not allowed' ? 'Feedback is closed or already sent' : niceError(err), true); }
    };
  }

  if (me) start(); else showNameForm();
}
