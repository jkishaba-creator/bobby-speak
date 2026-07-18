# Contributing to Bobby Speak

This is a community project with a single maintainer. Contributions are very
welcome — and every change is reviewed and merged by
[@jkishaba-creator](https://github.com/jkishaba-creator) before it ships.

## The short version

That's genuinely all you need. Everything below is detail for when you want it.

1. Pick an [open issue](../../issues) (or open one) and comment **`.take`** so
   nobody doubles up on it.
2. Fork, make your change, run **`node test/run-tests.js`**, and actually try
   it in Chrome.
3. Open a PR. Keep it to one thing, no new dependencies.

## Claiming work, so we don't collide

The worst outcome for everyone is two people building the same thing in
parallel and one of them throwing an evening away. So there's one rule:

**Before you start writing code, comment `.take` on the issue.**

A bot assigns it to you, labels it **in progress**, and posts to Discord so
everyone can see it's taken. That's the whole protocol.

| You want to | Comment | What happens |
|---|---|---|
| Start work on an issue | `.take` | Assigned to you, announced in Discord |
| Hand it back | `.drop` | Unassigned, announced as free again |

A few things worth knowing:

- **If an issue is already assigned, it's taken.** The bot will tell you so
  rather than reassigning it. Pick something else, or comment to ask how it's
  going — offering to help is always welcome.
- **Claims expire.** If a claimed issue goes quiet for 10 days you'll get a
  friendly nudge, and at 14 days it's released automatically. This isn't a
  judgement, it's just how the board stays honest. Any comment resets the
  clock, and you can always re-claim.
- **Open a draft PR early.** Even a half-finished one. It links back to the
  issue and shows people where you've got to, which is far better than
  silence.
- **Nothing is claimable that isn't an issue.** If you want to work on
  something that doesn't have one, open one first — that's what creates the
  thing other people can see.

Every Monday a summary goes to Discord: what's being worked on, what's waiting
on review, and what's free to pick up.

## Before you write code

**Open an issue first for anything non-trivial.** A typo fix or an obvious bug
can go straight to a PR. A new feature, a new engine, a refactor, or anything
touching the audio pipeline should start as an issue or a
[Discussion](../../discussions) so we can agree on the approach before you
spend an evening on it. Nothing is more discouraging than a well-built PR that
gets closed because it went the wrong direction.

Look for issues labelled **good first issue** if you want somewhere to start.

## Setting up

There is no build step and there are no dependencies. You need Node (for the
tests) and Chrome.

```bash
git clone https://github.com/jkishaba-creator/bobby-speak.git
cd bobby-speak
node test/run-tests.js     # should print "All N checks passed."
```

To load your working copy in Chrome: `chrome://extensions` → **Developer
mode** → **Load unpacked** → pick the folder. After editing, hit the reload
button on the extension card. Reload the web page too if you changed
`content.js`.

## Making a change

1. **Fork** the repo and create a branch: `git checkout -b fix-flux-timeout`
2. Make your change.
3. **Run the tests**: `node test/run-tests.js`. Add cases for anything you fix
   or add — `test/run-tests.js` is a plain script, just append a `check(...)`.
4. **Actually try it in Chrome.** Load the extension and dictate something.
   Tests catch broken logic; they cannot catch a broken microphone flow.
5. Push and open a pull request against `main`.

## What gets merged

Things that make a PR easy to say yes to:

- **It does one thing.** A PR that fixes a bug *and* reformats three files is
  hard to review and slow to merge.
- **The tests pass**, and new behavior has a test.
- **It matches the surrounding style.** Plain JavaScript, no frameworks, no
  build step, no new dependencies. If you think the project genuinely needs a
  dependency, open an issue about it first — the zero-dependency property is
  deliberate.
- **It respects the privacy promise.** Nothing may send audio, transcripts, or
  usage data anywhere except a speech provider the user explicitly configured.
  No analytics, no telemetry, no phone-home. This is not negotiable.
- **The UI stays consistent.** Use the tokens and components in `ui.css`
  rather than introducing new colors or one-off styles.

Things that will get a PR sent back:

- Reformatting or restyling unrelated code.
- New tracking, new remote endpoints, or new required permissions in
  `manifest.json` without a clear justification in the PR description.
- Large generated diffs, or code that was clearly not run.

## Where things live

| Area | Files |
|---|---|
| State machine, message routing | `background.js` |
| Microphone, engines, level meter | `offscreen.js`, `lib/engines.js` |
| Page overlay + text insertion | `content.js` |
| Pop-out window | `popout.html`, `popout.js` |
| Settings | `options.html`, `options.js` |
| Grammar and cleanup rules | `lib/textCleanup.js` |
| Design tokens and components | `ui.css` |

Adding a speech engine means implementing one interface in `lib/engines.js`
(`start(stream, audioCtx)` / `stop()`, plus the `onTentative` / `onSegment` /
`onDone` / `onError` callbacks) and adding a row to the picker in
`options.html`. You should not need to touch anything else.

## Staying in the loop

Repository activity — new issues, pull requests, releases — is mirrored into
the project Discord. Releases and issues labelled **good first issue** or
**help wanted** get called out there specifically, so Discord is the easiest
place to find something to pick up.

## Reporting bugs

Use the [bug report template](../../issues/new/choose). The single most useful
thing you can include for a dictation bug is **what you said and what you
got** — plus which engine you were using and which site you were on.

## Security

Please do not open a public issue for a security problem. See
[SECURITY.md](SECURITY.md).

## Licensing

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE), the same as the rest of the project.
