# Security

Dead Pedal is a browser game. It is a static site with no server component, no accounts, and
nothing to log into. That keeps this document short, and I would rather it stayed short and true
than got longer and vaguer.

## What it touches

The game runs entirely in the tab. While it is running it will:

- **Fetch its own audio files** over the network, from the same origin it was served from —
  `audio/<name>.opus` and `audio/<name>.ogg`. That is the only network traffic the game generates.
- **Read your keyboard and gamepad.** There is no text input anywhere in the game, so nothing you
  type is ever read as content.

That is the whole list.

## What it never touches

- **No storage of any kind.** No `localStorage`, no `sessionStorage`, no cookies, no IndexedDB.
  Nothing persists between sessions, including your vehicle choice and your sound setting.
- **No third-party requests.** No CDN, no fonts, no analytics, no telemetry, no error reporting.
  `index.html` loads exactly one script, and it is local.
- **No camera, microphone, clipboard, or location.**
- **No `eval` and no `new Function`.**

## Checking that yourself

Every claim above is a grep away, which is the point of making them specific:

```bash
# Every network call in the game. Should be two same-origin audio fetches.
grep -rn "fetch(" src/

# Storage, cookies, sockets, device APIs. Should print nothing.
grep -rnE "localStorage|sessionStorage|indexedDB|document\.cookie|XMLHttpRequest|WebSocket|navigator\.(geolocation|clipboard|mediaDevices)" src/

# Dynamic code execution. Should print nothing.
grep -rnE "\beval\(|new Function" src/

# Everything the page loads.
grep -nE "src=|href=|https?://" index.html
```

You can also just open the network tab and play it.

## The development tooling

`npm run sim`, `npm run record`, `npm run botmatch` and `npm run refsheet` run on your machine
rather than in the browser, so they are worth calling out separately. They read the project's own
source and write only inside the repository — replay fixtures to `tests/replay/fixtures/` and
rendered reference images to `_art/reference/`. Nothing in `tools/` reaches outside the project
directory or makes network requests. `npm run refsheet` and `npm run test:e2e` drive a headless
Chromium via Playwright against a local dev server.

## Supported versions

There is one version: whatever is currently on `main`. This is a pre-1.0 toy in beta and I do not
backport anything. If you are running a fork or an old checkout, update it first.

## Reporting something

Open an issue: **https://github.com/yeahitsmejayyy/dead-pedal/issues**

If you think you have found a vulnerability rather than a bug, please say so in the **title** and
leave the details out of the issue body. There is no private channel set up for this project yet,
so a public issue is currently the only route in — say enough that I know to get in touch, and we
can move somewhere private before you share specifics.

## Honest scope

I am not a game developer and I am not a security engineer, and this project exists because I
wanted to learn something rather than because I knew how. The surface here is genuinely small — a
static page that draws triangles and plays sounds — but "small" is not the same as "audited", and
nobody has audited it. If you are going to fork this and put it somewhere real, read it first.
