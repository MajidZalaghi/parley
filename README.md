# Parley

Personal spaced-repetition trainer for BIM meeting English. iPhone PWA, offline-first, FSRS scheduling.
Design documents live in `docs/` on the owner's PC only; they are excluded from this repository.

## Commands

```bash
npm ci            # install the exact pinned versions from package-lock.json
npm test          # unit tests (parser, scheduler, import, queue, backup, AI adapter)
npm run dev       # dev server at http://localhost:5173/parley/
npm run build     # type-check and build to dist/
npm run preview   # serve dist/ at http://localhost:4173/parley/
node scripts/make-icons.mjs   # regenerate app icons
```

## Structure

| Folder | Content |
|---|---|
| `src/parser` | English in Action line parser (data-model §5) |
| `src/bim` | BIM import diff, archive and rename suggestions |
| `src/schedule` | ts-fsrs wrapper and deterministic log replay |
| `src/review` | Daily queue and session presets |
| `src/backup` | Backup file, hash check and restore merge |
| `src/general` | Inbox prompt and AI reply preview |
| `src/ai` | Provider interface, Gemini adapter, guards, validators |
| `src/store` | IndexedDB schema, settings, `secrets` store |
| `src/ui` | Screens (plain TypeScript and DOM) |
| `spikes/` | iOS test page (`/parley/spikes/`) for spikes S1 to S6 |

## Deploy (GitHub Pages)

1. Create a public repository named `parley` and push this folder.
2. In the repository settings, go to Pages and choose Source: **GitHub Actions**.
3. Each push to `main` runs `.github/workflows/deploy.yml` (tests, build, deploy).
4. Open `https://<your-user>.github.io/parley/` in Safari on the iPhone, then use Share → Add to Home Screen.

## Rules

- Never commit an API key, a backup file or real vault content (see `.gitignore`).
- The Gemini key is entered on the phone in Settings and stays only in IndexedDB (`secrets` store).
