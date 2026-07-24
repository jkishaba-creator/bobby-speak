# Android final parity captures

Pixel 7 AVD, 1080 × 2400 px at 420 dpi.

- `activity-idle.png` — responsive activity orb, transcript card, selected
  Summarize Type, selected Confident Tone, and raised Clear/Save/Copy controls.
- `activity-recording.png` — orange dotted ring, top marker, level row, and
  Listening state.
- `keyboard-idle.png` — Bobby active in Android Settings with the compact orb
  on the right and QWERTY rows aligned below the transcript card.
- `keyboard-recording.png` — outside-app Listening state with orange compact
  orb ring and level row.
- `keyboard-quick-settings.png` — grey settings controls with black reserved
  for the selected Type and Tone.

Temporary placeholder Cloudflare values were used only to expose recording UI
states. They were removed from the emulator after capture, were never added to
the repository, and were not used to fabricate a successful transcription.

Behavior evidence is provided separately by Android unit tests, the connected
controller tests, and `scripts/verify-emulator.sh`. A successful live
transcription still requires user-provided Cloudflare credentials.
