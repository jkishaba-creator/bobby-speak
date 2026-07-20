# Bobby Speak V2

The streaming rewrite of [Bobby Speak](https://github.com/jkishaba-creator/bobby-speak)
— same product, same Air OS design language, new wiring. Text appears while
you speak, and every AI component sits behind a provider interface.

Architecture spec and rationale: [ARCHITECTURE.md](ARCHITECTURE.md)
(based on [issue #4](https://github.com/jkishaba-creator/bobby-speak/issues/4)
by [@jR4dh3y](https://github.com/jR4dh3y)).

## Status: alpha

Working end to end: streaming pipeline, three ASR providers (Chrome built-in,
Cloudflare Whisper large-v3-turbo, Deepgram Flux), staged text processing with
v1 test parity (25 tests), overlay + injection, popup, settings page with
engine picker and history.
Everything from v1 is now ported, including the pop-out window (⌘⇧O) for dictating into other apps via the clipboard.

## Build

```bash
npm install
npm test            # 25 tests, must pass
npm run build       # → .output/chrome-mv3
```

Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
pick `.output/chrome-mv3`. For live-reload development: `npm run dev`.

## Contributing

Same rules as v1 — comment `.take` on an issue first, one thing per PR,
no telemetry ever. Layer boundaries are the contract: an ASR provider is one
file in `src/ai/providers/`, a processing stage is one pure function in
`src/processing/stages/`. If your change spans layers, open an issue first.

MIT — see the main repo's [LICENSE](https://github.com/jkishaba-creator/bobby-speak/blob/main/LICENSE).
