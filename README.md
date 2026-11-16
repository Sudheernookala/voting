# LiveVote: live meeting voting and feedback (GitHub Pages + Firebase, free)

No server needed. GitHub Pages hosts the screens, and Firebase stores votes and sends live updates.
Free limits (Firebase Spark plan): **100 people connected at the same time**, 1 GB of data, 10 GB of downloads a month.

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
