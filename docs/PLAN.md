# F-key CW macro transmit — implementation plan

## Goal
Assign short canned text (CQ, reports, 73…) to keyboard function keys (F1–F12). Pressing a key sends that text as CW. DeepCW is currently decode-only, so a CW sender has to be added.

## Current state (from code review)
- No transmit/keyer code, no global key handlers (only canvas/pointer listeners).
- Settings pattern: `usePersistedState` (localStorage). Output device listing and `setSinkId` check already exist in `useAudioPassthrough.ts`.
- `tsc -b` and `eslint` are clean on `main` (baseline).

## Design

### 1. Keyer core (pure, `src/tx/morse.ts`)
- Text → element schedule using standard timing: dit = 1.2/WPM s, dah = 3 dit, element gap 1, letter gap 3, word gap 7.
- Table for A–Z, 0–9, `, . / ?` plus prosigns in `<AR>`, `<SK>`, `<BT>`, `<KN>` form. Unknown chars are skipped. Japanese (wabun) table as a later option, since the decoder has a JA mode.
- Pure function `textToSchedule(text, wpm) → {on, durationMs}[]`, so it can be unit-checked without audio.

### 2. Audio output (`src/tx/CwSender.ts`, `src/hooks/useCwTransmit.ts`)
- Web Audio `OscillatorNode` → `GainNode`, scheduled with `AudioParam` ramps (~5 ms attack/release to avoid key clicks), tone frequency configurable (default 700 Hz).
- Routed to a user-selected output device via `AudioContext.setSinkId` (same capability check as passthrough) — works for rigs connected through a USB audio interface (SSB/DATA mode audio-based CW) or for sidetone/practice.
- Abort: Esc stops and cancels the queue; sending a new macro while sending either queues or restarts (decide, see questions).
- Phase 2 (optional): real keying via Web Serial (DTR/RTS) for rigs with a keying line — Chromium only, behind a feature check.

### 3. Macro settings & UI (`src/MacroPanel.tsx`)
- 12 slots (F1–F12): label + text, persisted with `usePersistedState` under a `deepcw.tx.*` key prefix. Sensible defaults (e.g. F1 `CQ CQ CQ DE <MYCALL> <MYCALL> K`).
- Variables: `{MYCALL}`, `{HISCALL}`, `{RST}` substituted at send time; settings fields for My call / WPM / tone Hz / output device.
- Buttons for each slot (also clickable on touch devices), a Stop button, and a currently-sending indicator.
- Collapsible panel placed below the existing controls in `Decoder.tsx`; minimal edit there.

### 4. Keyboard handling
- `keydown` on `window` for `F1`–`F12`; `preventDefault()` (F1 help, F5 reload, F11 fullscreen, F12 devtools conflict).
- Ignore while editing macro text fields; ignore `e.repeat`. Note macOS: F-keys often need `fn` unless "Use F1, F2 etc. as standard function keys" is on — mention in README. Also allow Shift+F-key or a fallback binding if browsers/OS steal keys.

### 5. Interaction with decoding
- Optional "mute decoder while sending" so the sidetone is not decoded as received text (or mark it as TX). Default: do not feed TX audio to the decoder (sidetone goes to a separate output context, not the input stream).

### 6. Docs / PR
- README section describing the feature and key setup; keep the diff additive for upstream review.
- Before PR: open an issue on `e04/web-deep-cw-decoder` to ask if they want TX at all (the project is decoder-focused), then PR from a feature branch.

## Milestones
1. Branch `feature/fkey-macros`; add `src/tx/morse.ts` + schedule check script.
2. `CwSender` audio + temporary test button; verify timing by ear and by decoding it with DeepCW itself (loopback).
3. `MacroPanel` + persistence + F-key handling.
4. Polish (stop/abort, variables, prosigns), README, lint/tsc/build clean.
5. (Optional) Web Serial DTR/RTS keying; Japanese table.
6. Push to fork; ask the user before opening the upstream issue/PR.

## Decisions (from the user)
- TX methods are selectable at runtime: **Audio**, **Serial DTR/RTS (Web Serial)**, **rigctld CAT**.
- Pressing a key/button while sending **queues it** after the current transmission (changed from "replace"); Esc/Stop clears the queue.
- Japanese (wabun) is **later**.
- **Fork-only for now**; upstream PR decided later. Keep the diff additive anyway.
- UI: F1–F12 keys (send immediately, no Send button) + on-screen F1–F12 buttons (click) + a free-text form with a **Send** button (Enter also sends).

## Implemented (branch `feature/fkey-macros`)
- `src/tx/morse.ts` timing/expansion, `src/tx/transmitters.ts` (Audio / Serial / Rigctld), `src/hooks/useCwTransmit.ts`, `src/MacroPanel.tsx`, one insertion in `Decoder.tsx`.
- `tools/rigctld-bridge.mjs`: zero-dependency local HTTP→TCP relay (browsers cannot open rigctld's TCP port). Uses `\stop_morse`, `L KEYSPD`, `\send_morse`. Placed in `tools/` because `server/` is gitignored.

## Still to verify on real hardware
- Serial keying jitter/timing on the actual rig; DTR/RTS polarity and whether the rig needs PTT.
- rigctld: `send_morse` support depends on the rig backend (check `rigctl -m <model> -u`); prosigns are rig-dependent.
- Audio output to the rig's USB codec.
- macOS: F-keys need `fn` unless "Use F1, F2, etc. keys as standard function keys" is enabled.
- Browser may reserve some keys; Esc stops TX.
- Wabun table; optional "mute decoder during TX".

## rigctld notes
- Hamlib `send_morse` on Yaesu (newcat, e.g. FT-991): a 1-character message is a memory number (1-5), not text; `RigctldTransmitter` appends a space to such messages. Longer text is stored in keyer memory 1 and played; Hamlib truncates it at ~50 characters, so keep macros short on Yaesu rigs.
- `send_morse` fails (RPRT -1) unless the rig is in CW/CWR mode.
