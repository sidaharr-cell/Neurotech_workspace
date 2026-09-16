# neurotech-index

The NeuroBase application. **See [`../README.md`](../README.md) for what this is
and how to run it**, and [`../CLAUDE.md`](../CLAUDE.md) for the architecture and
the reasoning behind it.

Everything here runs from this directory:

```bash
npm ci
npm run dev      # http://localhost:5173, works with no credentials
npm run build
npm test
npm run lint
```

Copy `.env.example` to `.env` only when you want to rebuild the index against
your own Supabase project. Without it the app reads the JSON snapshots in
`src/data/`.
