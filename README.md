# Bobby Speak

**Voice dictation for the browser — free, open source, and private.**
Press one shortcut, speak, and clean, punctuated text lands at your cursor —
streaming onto the page while you talk. Works in Chrome, and — via the
pop-out and clipboard mode — with every other app on your machine.

No account, no subscription, no telemetry, no server of ours. Ever.

<sub>MIT licensed · Manifest V3 · WXT + Svelte 5 + TypeScript</sub>

---

## What it does

- **One shortcut everywhere** — `⌘⇧1` / `Ctrl+Shift+1` starts and stops
  dictation. On a web page it types at your cursor; with the pop-out focused
  it fills the pop-out; from **any other app** it records in the background
  (audible start/stop chimes) and puts the finished text on your clipboard,
  ready to paste.
- **Streaming** — text appears in the overlay while you're still speaking,
  not after.
- **Smart formatting** — an optional AI pass punctuates and capitalizes by
  grammar, so you can just talk without saying "comma". Two providers:
  Chrome's built-in Gemini Nano (free, on-device) or a Workers AI model on
  your own Cloudflare account (best quality, works on any machine).
- **Three speech engines** — Chrome built-in (free, zero setup),
  `@cf/openai/whisper-large-v3-turbo` (best accuracy, batch), or
  `@cf/deepgram/flux` (streaming with smart end-of-phrase detection), the
  Cloudflare pair on your own account.
- **Cleanup that reads like writing** — fillers and stutters removed, spoken
  punctuation ("period", "new line") honored, fuzzy custom-word correction
  for names and jargon.
- **Pop-out window** — a small always-available surface that keeps your
  clipboard preloaded as you speak: dictate there, paste anywhere. One-tap AI
  action chips — **Clean**, **Summarize**, **Sharpen**, and **Ask** — sit
  under the transcript, each with an Undo.
- **First-run onboarding** — mic permission, shortcut check, and a try-it box,
  all up front. After that page, it just works.
- **Local history** — recent transcriptions on this device only, capped,
  clearable, and `0` genuinely keeps nothing.

## On mobile

The same pipeline runs as an installable web app — no store, no approval:

```bash
npm run build:web     # → .output/web  (host it anywhere static)
npm run dev:web       # local development
```

Open it on a phone, **Add to Home Screen**, and it behaves like an app: tap
the orb, talk, and the cleaned text is already on your clipboard — paste into
any app. Underneath the transcript, one-tap AI actions — **Clean**,
**Summarize**, **Sharpen**, and **Ask** (a question about what you just said)
— each with an Undo. Android can use the free built-in engine; iOS needs Cloudflare keys
(Safari has no Web Speech API). It shares `src/` with the extension, so
there's one pipeline, one set of design tokens, two shells.

The AI actions call Cloudflare through a same-origin `/api/ai` Pages
Function to stay CORS-safe, so the web build needs to be hosted somewhere
that runs it — Cloudflare Pages — rather than any static file host.
Mobile PRs touching `mobile/android/**` also get a debug APK built
automatically as a downloadable CI artifact, for sideload testing.

## Install (Chrome extension)

Not on the Web Store yet — load it unpacked:

1. Clone this repo, then `npm install && npm run build`
2. Open `chrome://extensions`, enable **Developer mode**
3. **Load unpacked** → select **`.output/chrome-mv3`**
4. The welcome page opens itself — three steps and you're set

**Using an AI assistant?** Paste this into Claude Code (or any coding agent)
and it will build everything and hand you the final click:

```
Install this Chrome extension: https://raw.githubusercontent.com/jkishaba-creator/bobby-speak/main/INSTALL.md
```

Full details (including troubleshooting) in [INSTALL.md](INSTALL.md).

## Privacy

- Audio goes only to the speech engine **you** selected — Chrome's built-in
  service by default, or your own Cloudflare account. There is no Bobby Speak
  server.
- Smart formatting runs on-device (Gemini Nano) or on your Cloudflare
  account. Your API token is stored only in your local Chrome profile.
- History and settings live in `chrome.storage.local` — never synced,
  never transmitted.

## How it's built

A real-time streaming pipeline — see [ARCHITECTURE.md](ARCHITECTURE.md),
which grew out of community issue
[#4](https://github.com/jkishaba-creator/bobby-speak/issues/4) by
[@jR4dh3y](https://github.com/jR4dh3y):

```
Mic ─ frames ─▶ ASR provider ─ events ─▶ staged processing ─▶ overlay/inject
     src/audio/   src/ai/                src/processing/       src/output/
```

Every layer is pluggable: an ASR engine is one file implementing
`AsrProvider`, a text processor is one pure function. 78 tests cover the
pipeline, the grammar stages, the audio math, and the workflow files.

```bash
npm install
npm test          # vitest
npm run check     # svelte-check
npm run dev       # live-reload development
npm run build     # → .output/chrome-mv3
```

## Contributing

Community project, contributions welcome. Three steps:

1. Comment **`.take`** on an [issue](../../issues) so we don't double up.
2. Make your change; `npm test` must pass — and actually dictate with it.
3. Open a PR — one thing at a time.

Details in [CONTRIBUTING.md](CONTRIBUTING.md). Ideas go in
[Discussions](../../discussions); everything is announced in the
[project Discord](https://discord.gg/YdmPAYpR) — come say hi. Every change
is reviewed and merged by the maintainer.

## Known limits

- Chrome must be running (background is fine) — an extension can't outlive
  its browser.
- Native apps are reached via the clipboard (chime → talk → chime → paste);
  no Chrome extension can type keystrokes into another app.
- Google Docs draws its editor on a canvas: falls back to copy-to-clipboard
  with a paste hint.
- Global shortcuts are restricted by Chrome to `Ctrl/⌘+Shift+0–9`.

## Version history

- **v2 (current)** — streaming pipeline architecture, one global shortcut,
  smart formatting, onboarding. This line.
- **v1** — the original no-build vanilla-JS extension, preserved on the
  [`v1` branch](../../tree/v1).

## Credits

The text-cleanup approach and recording state machine trace back to ideas
from [Handy](https://github.com/cjpais/Handy) by CJ Pais (MIT), reimagined
twice over — see [LICENSE](LICENSE). The v2 architecture spec came from the
community. The literal-punctuation guard came from
[@jpachec0](https://github.com/jpachec0)'s v1 PR.

## License

MIT — see [LICENSE](LICENSE).
