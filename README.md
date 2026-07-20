# Bobby Speak

JOIN OUR DISCORD TO CONTRIUBTE https://discord.gg/YdmPAYpR

**Voice dictation for the browser — free, open source, and private.**
Press a shortcut on any page, speak, and cleaned-up text lands at your cursor.
Or open the pop-out and dictate for *any* app on your machine: your words stay
preloaded on the clipboard, so you just paste.

No account, no subscription, no server. Everything runs in your browser.

<sub>MIT licensed · Manifest V3 · zero dependencies · zero build step</sub>

---

## Why

Paid dictation apps (Wispr Flow, Superwhisper, Willow) charge $8–15/month, and
the open-source alternatives all fight over the desktop — where they need
signed installers and accessibility permissions before you can say a word.

Bobby Speak takes the other path: it lives in Chrome. One click to install, no
permissions theater, and the browser hands us context those desktop apps have
to fight for. Where it can't reach — native apps, canvas editors — the pop-out
covers it with an always-loaded clipboard.

## What it does

- **Dictate into any web page** — Gmail, Notion, GitHub, LinkedIn, X. Text is
  inserted at your cursor, including in React-controlled fields.
- **Dictate for other apps** — the pop-out window keeps your cleaned transcript
  on the clipboard as you speak. Talk here, `⌘V` into Slack, Word, anywhere.
- **Real punctuation** — auto-capitalization, terminal punctuation, `i` → `I`,
  plus spoken punctuation: say *"period"*, *"comma"*, *"question mark"*,
  *"new line"*, *"new paragraph"*.
- **Cleanup that reads like writing** — filler words (*um*, *uh*, *you know*)
  and stutters removed automatically.
- **Custom vocabulary** — add names and jargon; near-misses are fuzzy-corrected
  to your spelling.
- **Three speech engines, one selector** — Chrome's built-in engine (free,
  zero setup), or bring your own Cloudflare account for
  `@cf/openai/whisper-large-v3-turbo` (best accuracy, batch) and
  `@cf/deepgram/flux` (live streaming with smart end-of-phrase detection).
- **Optional on-device AI polish** — uses Chrome's built-in model (Gemini Nano)
  for a final grammar pass when available. Silently skipped when it isn't.
  Nothing is ever sent to a server.
- **Local history** — recent transcriptions, kept in your browser profile.

## Install

Not on the Web Store yet — load it unpacked:

1. Clone or download this repo.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the folder.
5. Click the Bobby Speak icon → **Start** and allow the microphone once.

## Use

| Action | Shortcut |
|---|---|
| Start / stop dictation on a page | `⌘⇧Space` · `Ctrl+Shift+Space` |
| Open the pop-out (for other apps) | `⌘⇧O` · `Ctrl+Shift+O` |

Change either at `chrome://extensions/shortcuts`.

**On a web page:** click into a text field, hit the shortcut, talk, hit it
again. A pill appears at the bottom of the page with a live waveform.

**For other apps:** open the pop-out, click the orb, and talk. Every finished
phrase is cleaned and copied automatically — switch to any app and paste. The
transcript is editable, and edits re-copy too.

## Privacy

- Audio is captured in your browser and passed to Chrome's built-in speech
  service — the same engine behind web speech input.
- Transcripts, settings, and history stay in your local Chrome profile.
- The optional AI polish runs **on-device**. There is no Bobby Speak server, no
  analytics, and no account.

## How it's built

Plain JavaScript, no framework and no build step — clone it and it runs.

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest: commands, offscreen, storage, content script |
| `background.js` | Service worker — dictation state machine + message router |
| `offscreen.html/.js` | Mic capture, level meter, speech engine |
| `content.js` | In-page overlay pill + insertion at the cursor |
| `popout.html/.js` | Pop-out window — dictate for other apps, clipboard preloaded |
| `popup.html/.js` | Toolbar popup — the orb, status, last transcription |
| `options.html/.js` | Settings — language, cleanup, custom words, history |
| `permission.html/.js` | One-time microphone grant |
| `lib/textCleanup.js` | Grammar pipeline: fillers, spoken punctuation, capitalization, fuzzy custom words |
| `lib/engines.js` | Engine layer: Chrome / CF Whisper / Deepgram Flux behind one interface |
| `lib/grammarPolish.js` | Optional on-device AI polish (feature-detected) |
| `ui.css` | Shared design tokens |

### Speech engines

All engines sit behind one interface (`lib/engines.js`) shared by the
offscreen document and the pop-out:

| Engine | Type | Setup |
|---|---|---|
| **Chrome built-in** (default) | streaming | none — works instantly |
| **Whisper large-v3-turbo** (`@cf/openai/whisper-large-v3-turbo`) | batch REST — transcribes on stop | Cloudflare Account ID + API token with Workers AI permission |
| **Deepgram Flux** (`@cf/deepgram/flux`) | streaming WebSocket with end-of-turn detection | the above + a free [AI Gateway](https://developers.cloudflare.com/ai-gateway/) name |

Pick one in **Settings → Speech engine** and use **Test connection** to verify
credentials. The Cloudflare engines run on *your* account (Workers AI has a
free daily allowance, then usage pricing); the token is stored only in your
local Chrome profile and requests go directly from your browser to Cloudflare.
Flux connects through AI Gateway because browsers can't set WebSocket auth
headers — the token rides the `cf-aig-authorization` subprotocol instead.

A fully local Whisper engine (transformers.js + WebGPU) remains the next
milestone and plugs into the same interface.

## Known limits

- Types into web pages only — not `chrome://` pages or the Web Store.
- Google Docs renders text to a canvas, so it falls back to copy-to-clipboard
  with a paste hint.
- Toggle mode only. Chrome's command API has no key-up event, so there's no
  push-to-talk.
- Saying the word *"period"* mid-sentence is treated as punctuation. Turn off
  **Spoken punctuation** in Settings if that bites you.
- Clipboard auto-copy in the pop-out needs that window focused (a Chrome
  rule); it re-copies the moment you focus it again.

## Roadmap

- [x] Engine selector with Cloudflare Workers AI (Whisper large-v3-turbo, Deepgram Flux)
- [ ] Local Whisper via transformers.js + WebGPU (fully offline recognition)
- [ ] Per-site tone profiles — casual in Slack, formal in Gmail
- [ ] Streaming text in the overlay as you speak
- [ ] Push-to-talk inside the page
- [ ] Chrome Web Store listing

## Contributing

Community project, contributions welcome. Three steps:

1. Comment **`.take`** on an [issue](../../issues) so we don't double up.
2. Make your change and run `node test/run-tests.js` (no dependencies, no build).
3. Open a PR — one thing at a time.

Details in [CONTRIBUTING.md](CONTRIBUTING.md). Ideas go in
[Discussions](../../discussions); everything is announced in the project
Discord. Every change is reviewed and merged by the maintainer.

## Credits

The text-cleanup approach and recording state machine are JavaScript
reimplementations of ideas from [Handy](https://github.com/cjpais/Handy) by
CJ Pais (MIT). No Handy source is included — the concepts were ported from
Rust to the browser. See [LICENSE](LICENSE).

## License

MIT — see [LICENSE](LICENSE).
