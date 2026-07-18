# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/jkishaba-creator/bobby-speak/security/advisories/new).

You should get a first response within a week.

## What counts

Bobby Speak handles a microphone, page content, and API credentials, so the
things worth reporting are:

- Anything that could send audio, transcripts, or credentials somewhere the
  user did not configure.
- A way for a web page to read the extension's stored settings or tokens.
- A way for a web page to trigger dictation or insertion without the user
  starting it.
- Cross-site scripting through transcript text — for example, dictated text
  being injected as HTML rather than as text.

## What the project promises

- No analytics, no telemetry, no phone-home.
- Transcripts, settings, and history stay in the local Chrome profile.
- Audio only ever goes to a speech provider the user explicitly selected and
  configured with their own credentials.
- The optional AI polish uses Chrome's on-device model and sends nothing over
  the network.

If you find a change that breaks one of these promises, that is a security
bug, even if nothing is technically "exploitable".
