# LiveVote: live meeting voting and feedback (React + Firebase, free)

Hosts create voting categories during a meeting and share a QR code. Participants vote from their phones and see
new votes and feedback forms appear instantly. Hosts get live results and can **reveal the winner** with a
countdown and confetti on every screen.

No server of our own: GitHub Pages hosts the app, and Firebase stores the data and sends live updates.
Free limits (Firebase Spark plan): **100 people connected at the same time**, 1 GB of data, 10 GB of downloads a month.

## Features
- **Hosts** (Google sign-in, allow-list): create meetings, add categories (single or multiple choice), open, close or reopen voting,
  see live results with turnout and "who voted for whom", **reveal the winner**, ask for and delete feedback,
  export CSV, see past meetings, and manage the host list.
- **Participants** (no account): join by QR code, link or code, with a name or anonymously. Vote once per category and give feedback.
- **Winner reveal:** "And the winner is… 3, 2, 1" then the winner with confetti, on every phone and the host screen
  at the same time. Ties show all tied winners. People who join later see the winner on the category card.
- **Automatic cleanup:** meetings are deleted 30 days after creation.

## Tech stack

| Part | Technology | What it does |
|---|---|---|
| Front end | **React 19 + TypeScript 5.9** | All screens: home, host dashboard, participant screen, winner reveal |
| Build tool | **Vite 7** | Dev server and production build (`dist/`) |
| Hosting | **GitHub Pages**, deployed by **GitHub Actions** | Every push to `main` builds and publishes automatically |
| Database and live updates | **Firebase Realtime Database** | Stores meetings, votes and feedback, and pushes changes to every screen instantly |
| Sign-in | **Firebase Authentication**: Anonymous + Google | Participants get a hidden anonymous ID (one vote per person). Hosts sign in with Google. |
| Security | **Firebase Security Rules** (`database.rules.json`) | One vote per person, host-only controls, private ballots, host allow-list, multi-choice limits, reveal data checks, 30-day deletion |
| Libraries | **firebase 12.19**, **qrcode-generator 2.0.4**, **canvas-confetti 1.9.4** | Firebase SDK, join QR code, confetti |
| Tests | **Playwright 1.63** + **Firebase Local Emulator Suite** | End-to-end tests of host and participant flows, plus attack attempts against the real security rules |

### How it fits together
```
Participant phone ─┐                          ┌─ Firebase Authentication (anonymous / Google)
Host laptop ───────┼── app files from ────────┤
                   │   GitHub Pages           └─ Firebase Realtime Database
                   └── live connection ──────────  (data + live updates, protected by security rules)
```
The browser talks directly to Firebase. The security rules are the only thing that stops cheating, so they're tested automatically.

### Project layout
| Path | Purpose |
|---|---|
| `src/main.tsx`, `src/App.tsx` | Start-up and routing (`?join=CODE`, `?host=CODE&key=KEY`, home) |
| `src/pages/Home.tsx` | Home: join box, host sign-in, create meeting, your meetings, manage hosts |
| `src/pages/HostPage.tsx` | Host dashboard: QR code, categories and results, reveal, feedback |
| `src/pages/JoinPage.tsx` | Participant screen: name or anonymous, voting, feedback form |
| `src/components/RevealOverlay.tsx` | Winner reveal animation |
| `src/lib.ts` | Data types, results calculation, meeting create, delete and cleanup, CSV export |
| `src/hooks.tsx` | Live database hook, server clock, toast messages |
| `src/firebase.ts`, `src/firebaseConfig.ts` | Firebase connection and project settings (public by design) |
| `src/index.css` | Styles |
| `database.rules.json` | Security rules: paste into Firebase → Realtime Database → Rules |
| `tests/` | End-to-end tests |
| `.github/workflows/deploy.yml` | Builds and deploys to GitHub Pages |

### Data stored in Firebase
| Path | Contents | Who can read it |
|---|---|---|
| `admins/` | Emails allowed to host | Hosts on the list |
| `hostMeetings/<email>/` | Each host's own meetings | That host only |
| `meetingIndex/` | Meeting creation times (for 30-day cleanup) | Hosts |
| `hostSecrets/` | Host keys | Nobody (checked by the rules only) |
| `meetings/<code>/info, categories, feedback` | Title, categories, options, revealed winner, feedback question | Anyone who has joined |
| `meetings/<code>/voters, ballots, responses, online` | Names, votes, feedback answers, who's online | That meeting's host. Participants can only read their own. |

## Development
Requires Node.js 22+. Tests also need Java (for the Firebase emulator).
```bash
npm install
npm run dev        # http://localhost:5173 (uses the real Firebase project)
npm run build      # type-check and production build into dist/
npm run test:e2e   # starts the Firebase emulators, then runs the Playwright tests
```

## Deploying
Pushes to `main` deploy automatically through GitHub Actions. One-time setting:
**GitHub → Settings → Pages → Build and deployment → Source: GitHub Actions.**
Watch progress under the repository's **Actions** tab.

The build uses relative paths, so it also works on Firebase Hosting, Cloudflare Pages, Vercel or Netlify
(build command `npm run build`, output folder `dist`). Add each new address under
Firebase → Authentication → Settings → **Authorized domains**, or Google sign-in will fail there.

## Firebase setup (one time)
1. **Create a project** at https://console.firebase.google.com. Analytics can be off.
2. **Sign-in methods:** Authentication → Sign-in method → enable **Anonymous** and **Google** (choose a support email for Google).
3. **Authorized domains:** Authentication → Settings → Authorized domains → add your site's domain, e.g. `sudheernookala.github.io` (no `https://`, no path).
4. **Database:** Realtime Database → Create database → *Start in locked mode*. Then open the **Rules** tab, paste the whole of
   `database.rules.json`, and click **Publish**. **Publish again every time this file changes.**
5. **App settings:** Project settings → Your apps → Web app → copy the config into `src/firebaseConfig.ts`
   (it must include `databaseURL`).
6. **First host:** Realtime Database → Data → **+** → key `admins`, then a child row with key = your Gmail in lowercase with every
   `.` replaced by `,` (e.g. `john,smith@gmail,com`) and value `true` (boolean). Use the address exactly as your Google account reports it.
   After that, add more hosts in the app under **Manage hosts** (normal email format).

## Using it
- **Host:** open the site → **Host sign-in** → **Create meeting**. Share the QR code. Add categories and start voting.
  Click **🏆 Reveal winner** to close voting and show the winner on every screen. **Reveal again** replays it, and **Reopen** clears it.
- **Participants:** scan the QR code, then type a name or tick **Join anonymously**. Keep the page open; votes, reveals and feedback forms appear automatically.
- **Multiple choice:** "Each voter can choose: Up to N options" (2–10). Percentages mean "share of voters who picked it", so they can add up to more than 100%.
- **Feedback:** **Ask for feedback** pops a form on every phone. Hosts can delete single responses or all responses.
  If feedback is still open, someone whose response you deleted is asked again.
- **Past meetings:** listed on the home page for signed-in hosts. They're deleted 30 days after creation, so **export the CSV** if you need the results.
  Cleanup runs when a host opens the home page (there's no server to run it on a timer).

## Good to know
- "One vote per person" means one vote per browser. A private window or second phone can vote again. That's fine for internal events, not for high-stakes votes.
- "Anonymous" hides the name on screen. Firebase still stores votes under a hidden browser ID.
- Names are not verified. Anyone with a meeting's host link can control that meeting.
- The 100-connection limit counts open pages (participants and host tabs) across all meetings at once.
- To change the 30 days, edit `KEEP_DAYS` in `src/lib.ts` **and** `2592000000` (30 days in ms) in `database.rules.json`, then publish the rules.

## Troubleshooting
| Problem | Fix |
|---|---|
| "Can't connect" | Enable Anonymous sign-in (setup step 2) |
| "Not allowed" on actions | Publish the latest `database.rules.json` (setup step 4) |
| "This website is not in Firebase Authorized domains" | Add the domain (setup step 3) |
| `auth/operation-not-allowed` | Enable Google sign-in (setup step 2) |
| Signed in but "Not allowed to host" | The `admins` entry doesn't match your Google email exactly (setup step 6) |
| Site shows an old version | Wait for the Actions run to finish, then hard-refresh (Ctrl+Shift+R) |
| "Something went wrong" screen | Reload. If it keeps happening, check the browser console and report it |
