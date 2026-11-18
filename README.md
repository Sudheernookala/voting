# LiveVote: live meeting voting and feedback (GitHub Pages + Firebase, free)

No server needed. GitHub Pages hosts the screens, and Firebase stores votes and sends live updates.
Free limits (Firebase Spark plan): **100 people connected at the same time**, 1 GB of data, 10 GB of downloads a month.

## Tech stack

| Part | Technology | What it does |
|---|---|---|
| Screens (front end) | Plain **HTML, CSS and JavaScript** (ES modules) | All pages: home, host dashboard, participant screen. No framework and no build step. |
| Hosting | **GitHub Pages** | Serves the static files for free. |
| Database and live updates | **Firebase Realtime Database** | Stores meetings, votes and feedback, and pushes changes to every screen instantly. |
| Sign-in | **Firebase Authentication**: Anonymous + Google | Participants get a hidden anonymous ID (used for one vote per person). Hosts sign in with Google. |
| Security | **Firebase Realtime Database Security Rules** (`database.rules.json`) | Enforces the rules the server used to: one vote per person, host-only controls, private ballots, the host allow-list, multi-choice limits, 30-day deletion. |
| Firebase SDK | **Firebase JS SDK 12.19.0**, loaded from Google's CDN (`gstatic.com`) | Connects the browser to Firebase. |
| QR codes | **qrcode-generator 2.0.4** (MIT licence), bundled as `qrcode.js` | Draws the join QR code in the browser. |
| Testing (during development) | **Firebase Local Emulator Suite** + **Playwright** (headless Chromium) | Ran host and participant flows and attack attempts against the security rules. The test scripts are not part of this repo. |

### How it fits together
```
Participant phone ─┐                          ┌─ Firebase Authentication (anonymous / Google)
Host laptop ───────┼── static files from ─────┤
                   │   GitHub Pages           └─ Firebase Realtime Database
                   └── live connection ──────────  (data + live updates, protected by security rules)
```
There is no server of our own. The browser talks directly to Firebase, and the security rules are the only thing that stops cheating.

### Files
| File | Purpose |
|---|---|
| `index.html` | Page shell; loads the styles, QR library and app |
| `app.js` | All app logic: home, host dashboard, participant screen, feedback, cleanup |
| `style.css` | Look and layout (works on phones and laptops) |
| `firebase-config.js` | Your Firebase project settings (public by design) |
| `database.rules.json` | Security rules: paste into Firebase → Realtime Database → Rules |
| `firebase.json` | Config for the Firebase CLI / local emulator (optional) |
| `qrcode.js` | QR code library |

### Data stored in Firebase
| Path | Contents | Who can read it |
|---|---|---|
| `admins/` | Emails allowed to host | Hosts on the list |
| `hostMeetings/<email>/` | Each host's list of their own meetings | That host only |
| `meetingIndex/` | Meeting creation times, used for 30-day cleanup | Hosts |
| `hostSecrets/` | Host keys | Nobody (checked by the rules only) |
| `meetings/<code>/info, categories, feedback` | Title, categories, options, feedback question | Anyone who has joined |
| `meetings/<code>/voters, ballots, responses, online` | Names, votes, feedback answers, who's online | That meeting's host. Participants can only read their own. |

### Free-plan limits (Firebase Spark)
- 100 connections at once (open pages, across all meetings)
- 1 GB stored
- 10 GB downloaded per month

## Setup (about 15 minutes, one time)

### 1. Create a Firebase project
1. Go to https://console.firebase.google.com and click **Create a project**. You can turn Google Analytics off.

### 2. Turn on anonymous sign-in
**Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**
Participants don't create accounts. This only gives each phone a hidden ID, so the app can allow one vote per person.

### 3. Create the database and add the security rules
1. **Build → Realtime Database → Create database.** Pick a location near you and choose **Start in locked mode**.
2. Open the **Rules** tab. Delete everything there, paste the full contents of `database.rules.json`, and click **Publish**.
   **Don't skip this step.** These rules are what stop people from voting twice, seeing other people's votes, or controlling your meeting.

### 4. Connect the app to your project
1. Click the gear icon, then **Project settings → General → Your apps**, then the **</>** (Web) icon. Give it any name and register it. You don't need Firebase Hosting.
2. Copy the `firebaseConfig = { ... }` values into `firebase-config.js`. Make sure the config includes `databaseURL`. If it's missing, you created the app before the database. Refresh the settings page and copy the config again.

### 5. Put it on GitHub Pages
1. Create a **public** repository on GitHub, for example `livevote`.
2. Click **Add file → Upload files** and upload every file in this folder.
3. Go to **Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.**
4. After about a minute, the app is live at `https://<your-username>.github.io/livevote/`.

## Who can host (Google sign-in)
Only people on the **host list** can create meetings. Everyone else can only join.
Participants never need an account.

**One-time setup:**
1. Firebase → **Authentication → Sign-in method → Add new provider → Google → Enable**. Pick your support email, then **Save**.
2. Firebase → **Authentication → Settings → Authorized domains → Add domain** → `sudheernookala.github.io`.
3. Firebase → **Realtime Database → Rules**: paste the latest `database.rules.json` → **Publish**.
4. Add yourself as the first host: **Realtime Database → Data** → hover the top line → **+**.
   - Key: your Gmail address with every `.` replaced by `,` (e.g. `john.smith@gmail.com` becomes `john,smith@gmail,com`). Use lowercase.
   - Value: `true`. Click **Add**.

**Adding more hosts later:** sign in on the site (the "Host sign-in" link at the bottom), then use the **Manage hosts** box:
type their Gmail address and click **Add host**. To remove someone, click **Remove**.
You can also do it in Firebase → Realtime Database → Data → `admins`, using the same `,` format.

Note: a host link (the private link shown on the dashboard) still gives full control of that one meeting,
to whoever has it, even without signing in. Use it to let a co-host run a meeting from another device.

## Past meetings and automatic deletion
- Signed-in hosts see **Your meetings** on the home page, with **Open** and **Delete** buttons.
  The list follows your Google account, so it works on any device.
- Meetings are **deleted automatically 30 days after creation**. Export the CSV first if you need the results.
- There's no server, so cleanup runs whenever any host opens the home page.
  If nobody visits for a while, old meetings are removed on the next visit.
- Meetings created before this feature was added aren't in the cleanup list. Delete them by hand under
  Realtime Database → Data → `meetings`.
- To change 30 days to another number: edit `KEEP_DAYS` in `app.js`, **and** change `2592000000` (30 days in
  milliseconds) in `database.rules.json`, then publish the rules again.

## Anonymous voting and multiple choice
- **Join anonymously:** participants can tick "Join anonymously" instead of typing a name. The host sees
  "Anonymous" (e.g. "Priya: Asha, 2 anonymous"). One vote per person still applies.
- **Multiple choice:** when creating a category, set "Each voter can choose" to "Up to N options" (2–10).
  Percentages then mean "share of voters who picked it", so they can add up to more than 100%.
  The security rules block more picks than allowed and block picking the same option twice.
- After pulling this update, publish the latest `database.rules.json` again.

## Deleting feedback
On the host dashboard, each feedback response has a **Delete** link, and each question has **Delete all**.
Only that meeting's host can delete. Participants can't delete anyone's feedback, including their own.
If feedback is still being collected, a person whose response you deleted is shown the form again.
Click **Stop collecting feedback** first if you don't want that.

## Using it
- **Host:** open the site, click **Host sign-in** at the bottom, then **Create meeting**. You'll see a QR code, a join code, and a private host link. Keep the host link private.
- **Participants:** scan the QR code, enter their name, and wait. Votes and feedback forms appear on their screen automatically.
- **Results:** bars, winner or tie, turnout, who voted for whom, and who hasn't voted. Use **Export results (CSV)** to download everything.

## Good to know
- Results are saved permanently in Firebase. The site never sleeps.
- "One vote per person" really means one vote per browser. Someone could vote again from a private window or a second phone. That's fine for internal events, but not for anything high-stakes.
- Names are not verified.
- Anyone with your host link can control your meeting.

## Troubleshooting
- **"Can't connect"**: Anonymous sign-in is not enabled (step 2).
- **Stuck on loading, or "Not allowed" errors**: the rules weren't published (step 3), or `databaseURL` is wrong (step 4).
- **"Setup needed"**: `firebase-config.js` still has the placeholder values.
