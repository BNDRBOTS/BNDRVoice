# Visual review artifacts

Prior-pass Playwright captures for release `3.2.0` (landing + app). This ship loop could not relaunch Chromium (`libnspr4.so` missing; Playwright/Puppeteer/apt downloads ECONNRESET). DOM-level gates live in `tests/dom-gates.test.mjs`.

- `landing-desktop.png`
- `landing-mobile.png`
- `app-complete-desktop.png`
- `app-mobile.png`
- `sharp-test-voice_machine.json`

The fixture intentionally contains inert HTML-like strings to verify that model output is escaped rather than executed.
