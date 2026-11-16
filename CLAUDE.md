# CLAUDE.md

DeepCW (web-deep-cw-decoder): browser-based real-time Morse decoder (React 19 + Mantine 8 + onnxruntime-web, Vite 7, deployed on Cloudflare via wrangler). Decoding runs in a Web Worker.

## Repos / remotes
- `origin` = fork `JF9SOM/web-deep-cw-decoder` (push here)
- `upstream` = `e04/web-deep-cw-decoder` (original; the final PR target)
- Work on feature branches (e.g. `feature/fkey-macros`), never on `main`. Keep `main` in sync with `upstream/main`.
- Never push to `upstream`. Do not push or open a PR without the user's explicit OK.

## Commands
- `npm ci` — install (Node 26 / npm 11 on this Mac works)
- `npm run dev` — Vite dev server (microphone/getUserMedia works on localhost)
- `npm run build` — `tsc -b && vite build`
- `npm run lint` — ESLint. Run both lint and `npx tsc -b` before every commit; baseline is clean.
- No test framework exists. Verify behavior manually in the dev server; if adding pure logic (e.g. Morse timing), keep it in `src/utils/` as pure functions so it is testable.
- `preview`/`deploy` need wrangler/Cloudflare — do not run them.

## Layout
- `src/App.tsx` header/footer; `src/Decoder.tsx` (617 lines) main screen: owns mic stream, device selection, settings state
- `src/hooks/` — audio/decoding hooks; `usePersistedState` = localStorage-backed state (use it for all new settings, namespaced keys)
- `src/hooks/useAudioPassthrough.ts` — already handles output device list and `AudioContext.setSinkId` support detection; reuse for TX audio routing
- `src/utils/` — pure helpers; `src/workers/inferenceWorker.ts` — ONNX inference
- `src/const.ts` — constants (SAMPLE_RATE 9600, vocab, freq limits)
- `public/models/` — model files; do not modify

## Conventions
- TypeScript strict, functional components + hooks, Mantine components for UI (dark theme). Match existing style (double quotes, semicolons, 2-space indent).
- Keep the change additive and small: new code in new files (`src/tx/…`, `src/hooks/useCwTransmit.ts`, `src/MacroPanel.tsx`), with minimal edits to `Decoder.tsx`. This keeps the upstream PR easy to review.
- Don't touch decoding, model, or PWA/vite config unless required.
- Keep UI strings English (upstream is English). Discuss with the user in Japanese.

## Current feature: F-key CW macros (transmit)
Implemented on branch `feature/fkey-macros`; see `docs/PLAN.md` (decisions, status, hardware checklist).
- TX methods: Audio / Web Serial DTR-RTS / rigctld via `tools/rigctld-bridge.mjs` (`node tools/rigctld-bridge.mjs` after starting `rigctld -t 4532`).
- New send always stops and replaces the current one. Fields marked `data-no-fkey` ignore F-key shortcuts.
- Fork-only for now: don't open an upstream issue/PR unless the user asks.
- Never key a real transmitter while testing without the user present; test with Audio mode or a dummy rig (`rigctld -m 1`).
