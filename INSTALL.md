# Installing Bobby Speak

**Humans:** follow the [Quick install](#quick-install) below.
**AI agents (Claude Code, Cursor, Copilot, etc.):** follow the
[AI agent install protocol](#ai-agent-install-protocol) — it is written for you.
This file is self-contained: everything needed to install is on this page.

One-link entry point (paste this into your AI assistant):

```
Install this Chrome extension: https://raw.githubusercontent.com/jkishaba-creator/bobby-speak/main/INSTALL.md
```

---

## Quick install

Bobby Speak is not on the Chrome Web Store yet, so it loads as an unpacked
extension:

1. `git clone https://github.com/jkishaba-creator/bobby-speak.git && cd bobby-speak`
2. `npm install && npm run build`
3. Open `chrome://extensions`, toggle **Developer mode** (top right)
4. Click **Load unpacked** → select the **`.output/chrome-mv3`** folder
5. The welcome page opens itself — three steps and you're dictating

---

## AI agent install protocol

You are an AI agent installing Bobby Speak for a user. Follow these steps in
order. Do not skip verification steps.

### Step 0 — Detect your environment

Determine which of these you are in, then follow the matching path:

| Environment | Test | Path |
|---|---|---|
| **Desktop with filesystem + the user's Chrome** (e.g. Claude Code on macOS/Windows/Linux) | You can run shell commands on the user's own machine | Continue to Step 1 |
| **Cloud sandbox / mobile session** (e.g. Claude Code on mobile or web, remote VM) | Your shell is a remote/ephemeral machine, not the user's computer | Go to [Sandbox path](#sandbox--mobile-path) |

### Step 1 — Verify prerequisites

Run each check; fix or report failures before continuing:

```bash
git --version          # any recent version
node -v                # need v20 or newer
npm -v                 # any recent version
```

- If Node is missing or older than v20: install via the user's preferred
  method (`brew install node` on macOS, or nvm: `nvm install --lts`).
- Chrome (or a Chromium-based browser that supports extensions) must be
  installed on the user's machine. On macOS check:
  `ls /Applications/ | grep -i chrome`

### Step 2 — Clone and build

```bash
git clone https://github.com/jkishaba-creator/bobby-speak.git
cd bobby-speak
npm install
npm run build
```

Expected result: the build completes without errors and produces
`.output/chrome-mv3/`.

### Step 3 — Verify the build (do not skip)

```bash
test -f .output/chrome-mv3/manifest.json && echo "BUILD OK" || echo "BUILD FAILED"
node -e "const m=require('./.output/chrome-mv3/manifest.json'); console.log(m.name, m.version, 'MV'+m.manifest_version)"
```

Expected output: `BUILD OK` and `Bobby Speak <version> MV3`.
If verification fails, see [Troubleshooting](#troubleshooting), fix, and
re-run Step 2.

### Step 4 — Hand the final step to the user

**Important — read before attempting anything clever:**

- You **cannot** automate this step. `chrome://extensions` is not scriptable
  or reachable by browser automation, by design.
- Do **not** try the `--load-extension` command-line flag: Google removed it
  from stable Chrome branded builds in 2025; it is silently ignored.
- Loading an unpacked extension is a deliberate human-in-the-loop security
  boundary in Chrome. This is expected, not a failure.

Print the absolute path of the build output, then give the user exactly this:

> The extension is built and verified. Three clicks to finish:
> 1. Open `chrome://extensions` in Chrome
> 2. Turn on **Developer mode** (toggle, top-right)
> 3. Click **Load unpacked** and select this folder:
>    `<ABSOLUTE_PATH>/bobby-speak/.output/chrome-mv3`
>
> Bobby Speak's welcome page will open itself and walk you through mic
> permission and setup.

### Step 5 — Confirm success

Ask the user to confirm the welcome (onboarding) page opened. If it did,
installation is complete. Default shortcut: **Ctrl+Shift+1**
(**⌘+Shift+1** on Mac) — press it, speak, and text lands at the cursor.

---

## Sandbox / mobile path

If you are running in a cloud sandbox or on a mobile device, you **cannot
install a Chrome extension from where you are**:

- Your shell is not the user's computer, so you can't place files on it.
- Chrome on Android and iOS does not support extensions at all — no
  extension can be installed on mobile Chrome, by anyone.

What to do instead:

1. Tell the user plainly: *"I can build and verify Bobby Speak here, but a
   Chrome extension can only be installed on a desktop browser. Here's what
   to do when you're at your computer."*
2. Optionally run Steps 1–3 in your sandbox to confirm the build is green.
3. Give the user the one-link entry point from the top of this file to paste
   into Claude Code on their desktop later.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `npm install` fails on native deps | Ensure Node ≥ 20 (`node -v`); delete `node_modules` and `package-lock.json` is **not** needed — just re-run `npm install` |
| `npm run build` fails | Run `npm run check` for diagnostics; ensure the clone is fresh and complete |
| `wxt: command not found` | Dependencies didn't install — re-run `npm install` from the repo root |
| Build OK but no `.output/chrome-mv3` | You're not in the repo root, or a stale partial build — `rm -rf .output && npm run build` |
| "Load unpacked" rejects the folder | Select `.output/chrome-mv3` itself (the folder containing `manifest.json`), not the repo root |
| Extension loads but mic doesn't work | The onboarding page requests mic permission — reopen it from the extension's options if dismissed |

## When Bobby Speak reaches the Chrome Web Store

Once published, all of the above collapses to a single store link and one
**Add to Chrome** click — this file will be updated to point there.
