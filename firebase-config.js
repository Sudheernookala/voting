// STEP: replace this whole object with the config from
// Firebase console → Project settings → General → Your apps → Web app → "SDK setup and configuration" → Config.
// Create the Realtime Database FIRST, so the config includes "databaseURL".
// These values are not secret — they are safe to commit. Security comes from database.rules.json.
export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  appId: "PASTE_YOUR_APP_ID",
};
