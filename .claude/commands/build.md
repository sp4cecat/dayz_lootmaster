Build the Lootmaster frontend for production.

Execute `npm run build` in the project root. This runs `vite build` and outputs to `dist/`.

After the build:
1. Report bundle size summary (Vite prints chunk sizes).
2. Flag any chunks over 500 kB — they may need code-splitting.
3. If the build fails on TypeScript errors, show the full tsc output; do not suppress errors with `// @ts-ignore` unless the user explicitly allows it.

Note: the backend (`server/index.js`) is not part of the Vite build — it runs as a plain Node.js process. A production deploy needs both `dist/` served as static files and the Node server running separately.

Packaged app: `launch.bat` serves the built `dist/` — frontend fixes are invisible until `npm run build` runs.

Staging deploy (`\\Desktop-ibg0ev5\c\dayz_lootmaster`):
1. Copy `dist/` atomically: copy to `dist.new`, then swap (`mv dist dist.old && mv dist.new dist && rm -rf dist.old`). Picked up on browser refresh — no restart.
2. Copy any changed `server/*.js` alongside. Server changes need a backend **restart on the staging box** — WinRM is unavailable, so the user must restart it (they are usually RDP'd in).
3. The staging frontend is `vite preview` on `:4173` and 403s non-localhost hostnames; verify remotely via the backend API on `http://Desktop-ibg0ev5:4317` instead (e.g. `GET /api/cftools/status`).
