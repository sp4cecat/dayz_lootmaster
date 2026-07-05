Build the Lootmaster frontend for production.

Execute `npm run build` in the project root. This runs `vite build` and outputs to `dist/`.

After the build:
1. Report bundle size summary (Vite prints chunk sizes).
2. Flag any chunks over 500 kB — they may need code-splitting.
3. If the build fails on TypeScript errors, show the full tsc output; do not suppress errors with `// @ts-ignore` unless the user explicitly allows it.

Note: the backend (`server/index.js`) is not part of the Vite build — it runs as a plain Node.js process. A production deploy needs both `dist/` served as static files and the Node server running separately.
