Start the Lootmaster development environment.

Run `npm run dev` in the project root (`F:\Dayz Dev\web\lootmaster`). This uses `concurrently` to launch both:
- **Backend**: `node server/index.js --dev` on port 4317
- **Frontend**: Vite dev server (typically port 5173)

After launching, confirm both processes started without errors. If the backend exits immediately, check `server/index.js` for startup errors (missing `server/profiles.json` is a common cause — the file should exist even if empty `{}`).

The frontend proxies API calls to `http://localhost:4317`. The UI's API base can be overridden in localStorage under key `dayz-editor:apiBase`.
