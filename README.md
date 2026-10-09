# abuse-wasm

**Abuse** (Crack dot Com, 1995), compiled to WebAssembly so it runs in a browser tab. This is
a port, not an emulator: the Abuse 0.8 SDL source tree is compiled with
[Emscripten](https://emscripten.org/), using Emscripten's built-in JavaScript implementation of
SDL 1.2 and SDL_mixer (`-sUSE_SDL=1`) and **Asyncify**. Asyncify lets the game keep its own
blocking loops (main loop, menus, dialogs) and yield to the browser inside them, so the game's
code did not have to be restructured around a browser frame callback. The directory holds only
the build tooling, a few small source patches and the page. You supply the source tarball.

## Prerequisites

- **Emscripten** via emsdk:

  ```bash
  git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
  cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest
  ```

  `build.sh` finds it on `PATH`, or at `$EMSDK` (default `~/emsdk`). Two host problems you may
  hit:
  - If the install fails on TLS certificate errors, point Python at the system CA bundle, e.g.
    `SSL_CERT_FILE=/etc/pki/tls/certs/ca-bundle.crt ./emsdk install latest`.
  - emsdk's bundled Node needs glibc 2.27 or newer. On an older host, set `NODE_JS` in
    `~/emsdk/.emscripten` to a system `node`.
- `python3`, to serve the page.
- A current desktop browser (WebAssembly, Web Audio, IndexedDB).
- The Abuse 0.8 source tarball, `abuse-0.8.tar.gz`, from
  <http://abuse.zoy.org/raw-attachment/wiki/download/abuse-0.8.tar.gz>. It contains both the
  source and the game data.

## Quick start

```bash
curl -LO http://abuse.zoy.org/raw-attachment/wiki/download/abuse-0.8.tar.gz
./build.sh abuse-0.8.tar.gz
./serve.sh            # http://localhost:8080/  (./serve.sh 9000 for another port)
```

Open the URL, wait for the game data to download, and click **Click to start**. The click gives
the game keyboard focus and starts audio, since browsers only allow audio after a user gesture.
Both scripts can be run from any directory. You can rebuild while `serve.sh` is running; reload
the page to pick up the new build.

The page has to be served over HTTP. Opening `dist/index.html` from disk does not work, because
the browser will not fetch `abuse.data` from a `file://` page.

**First run:** the game opens with a gamma dialog. Click the darkest grey you can still see,
then click the check mark. If you click the check mark without choosing a grey, the game keeps
the darkest setting and looks very dark. To get the dialog back, reset the saved settings (see
[Saves](#saves)).

### URL flags

`?args=` passes command-line flags to the game, separated by `+` or `%20`:

| URL | Effect |
|---|---|
| `?args=-nosound` | Start with sound disabled |
| `?args=-edit` | The original's built-in level editor (not exercised in the browser) |
| `?reset=1` | Wipe the stored settings and saves before starting (see [Saves](#saves)) |

**Fullscreen** (the button under the game) scales the game to fill the screen. Esc leaves
fullscreen; browsers reserve it for that.

## Controls

| Input | Action |
|---|---|
| Left / Right arrows (or keypad 4 / 6) | Move |
| Up (keypad 8) | Jump / climb |
| Down (keypad 2) | Crouch / use |
| Mouse | Aim (the crosshair) |
| Left mouse button or Space | Fire |
| Right mouse button | Special ability |
| Mouse wheel, `,` / `.`, Right Ctrl / Insert, Ctrl / Home / PageUp | Previous / next weapon |
| 1–7 | Pick a weapon you own |
| P | Pause (Space or Enter resumes) |
| Esc (hold briefly) | In-game menu |
| V | Volume window |
| Alt+X | Quit. The game asks "Are you sure?"; confirming ends the program and the page shows a Reload button |

In menus and dialogs, click a button, or hover over it and press Enter. The original game only
gives a widget keyboard focus after the mouse has hovered over it. The game reads its controls
once per game tick (15 per second), so a very short tap can be missed.

## Saves

Settings and save games are stored in your browser's IndexedDB. Open the page with `?reset=1` to
wipe them. The page then removes the flag from the address bar, so a later reload does not wipe
them again. If IndexedDB is unavailable, the game still runs normally, but nothing is kept
between visits.

## Sound

Sound effects play through Web Audio with stereo panning. Audio starts on the first click,
because of browser autoplay rules. Music is disabled: the game's music is MIDI (converted from
HMI), and browsers cannot play MIDI without a synthesizer. One possible future route is an
OPL/FM synthesizer compiled to WebAssembly, such as libADLMIDI.

## Why the game files are not in this repo

This repo ships only the port: `build.sh`, the patches, `config.h` and the page. The build
consumes your own copy of the tarball. It extracts the tarball into `build/`, patches and
compiles the source there, and packs the game data into `dist/abuse.data`. Both `build/` and
`dist/` are gitignored. The tarball's own licence files (`COPYING`, `COPYING.GPL`,
`COPYING.WTFPL`) apply to anything built from it.

## How it works

| Piece | What it does |
|---|---|
| `build.sh` | Extracts the tarball, applies `patches/*.patch` in sorted order, compiles the sources the original automake files list (minus the standalone tool), and links `dist/abuse.{js,wasm,data}` |
| `config.h` | Replaces the autotools-generated header |
| `web/index.html`, `web/style.css` | The page: loading progress, click-to-start, scaling, fullscreen, crash panel |
| `web/pre.js` | Turns `?args=` into the game's command line |
| `web/persist.js` | Mounts IndexedDB (IDBFS) over the save directory and holds `main()` until the saved files are copied in; syncs after writes and when the tab is hidden or closed |
| `web/audio.js` | `abuseUnlockAudio()`, which the start click calls to create or resume the AudioContext |
| `serve.sh` | `python3 -m http.server` on `dist/` |

Build decisions that are not visible in the patches:

- **The build must be optimised.** Unoptimised Asyncify stack frames are large enough that the
  recursive Lisp evaluator overflows the browser's stack while loading the game scripts.
- **`-fno-delete-null-pointer-checks`.** The Lisp engine's methods guard NULL receivers with
  `if (this)`. Clang deletes those checks, and in wasm address 0 is readable memory, so the
  evaluator otherwise fails with `eval on a bad cell`.
- **`stdint.h` and `ushort`** are supplied on the compiler command line. The native build got
  them indirectly from glibc's headers, which Emscripten's libc does not provide the same way.

### Patches

`patches/00-base.patch` contains the fixes the port needs before the game runs at all:

| File | Fix | Why |
|---|---|---|
| `lisp/lisp.cpp` | Start the Lisp heap spaces at 8 MB instead of 4 KB | The copying garbage collector ran constantly during load and hit an unrooted C++ pointer. This is a latent 0.8 bug: an unmodified native build crashes the same way |
| `lol/timer.cpp` | Use the `gettimeofday` timer path and wait with `emscripten_sleep` | The fallback path called `SDL_Init` on every poll (each call allocates in JS SDL) and ran out of memory; `usleep` busy-spins and never yields to the browser |
| `sdlport/event.cpp` | Skip `SDL_EventState` | Not implemented in JS SDL 1.2 |
| `sdlport/sound.cpp` | Fixed audio spec instead of `Mix_QuerySpec`; halt channels instead of `Mix_FadeOutGroup` | Both are missing or abort in JS SDL_mixer |
| `sdlport/video.cpp` | Copy the 8-bit frame into the locked window surface; `discardOnLock`; create the off-screen surface with `SDL_HWPALETTE` | JS SDL repaints a palettised window from its own buffer on unlock, which painted a black canvas; locking a palettised surface aborts unless copy-back is off; without `SDL_HWPALETTE` the off-screen surface gets 4 bytes per pixel, which drew a striped image |

The other patches:

- `10-input.patch` binds Fire to Space by default. The original only read that binding from
  `abuserc`, so on a first run there was no keyboard fire.
- `20-audio.patch` turns music off, guards against empty songs, plays no sound effects while
  audio is suspended, and remaps panning to Web Audio's range.

### The page

The canvas keeps the game's own resolution; only its CSS size changes. The page sizes the
canvas element itself to the game's aspect ratio, using the largest size that fits the window,
and letterboxes it. Pixels are scaled with `image-rendering: pixelated`. The canvas element must
be sized this way: Emscripten converts mouse positions to game pixels from
`canvas.getBoundingClientRect()`. If the canvas were stretched and the picture letterboxed
inside it (`object-fit`), every click would land in the wrong place. The browser pointer is
hidden over the canvas because the game draws its own.

"Click to start" is enabled only once every download and run dependency has resolved, just
before the game starts. That way, the click always happens after `audio.js` has loaded and can
unlock audio. If the runtime aborts, or an uncaught error or rejection escapes, a panel shows
the message and the last lines of the game's stderr instead of leaving a frozen canvas. A
rejected browser API call, such as a sound that fails to decode, is logged to the console
instead.

## Tests

```bash
cd test && npm install && npx playwright install chromium && npm test
```

This boots `dist/` in headless Chromium and fails on any page error or runtime abort, when the
first screen does not render, and when the game cannot be driven into a level where holding
Right scrolls the view.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Loading…" never finishes | The page was opened from disk, or `abuse.data` did not download. Serve it with `./serve.sh` and check the browser console |
| Black or extremely dark picture after the first dialog | The gamma setting is at its darkest. Open `?reset=1` and choose a lighter grey in the gamma dialog |
| Crash panel: `Maximum call stack size exceeded` | The build was not optimised. Keep `build.sh`'s `-O2`/`-O3` flags |
| The tab itself crashes (not the crash panel) as the game starts | On some hosts, V8's WebAssembly trap handler misbehaves. Start Chromium with `--js-flags=--no-wasm-trap-handler`; the headless test harnesses used for this port pass that flag |
| No sound | Click the page once; browsers keep audio suspended until a user gesture. Also check that the URL does not contain `-nosound` |
| Keys do nothing | Click the game once to give it keyboard focus |
| Settings or saves lost between visits | The browser blocked or cleared IndexedDB, for example in a private window. The game runs without persistence in that case |

## License

The port itself (the build script, patches, `config.h`, web page and tests) is released under
the [MIT License](LICENSE). The Abuse source and data are not included; their own licences
apply as described above.
