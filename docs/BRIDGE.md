# Local USB bridge

The bridge is an optional helper that runs on your own computer. On macOS the browser can only send
settings to the receiver. The bridge gives Hollyland Web UI full read **and** write access.

The quickest way to start it is with Node.js 20 or newer:

```
npx hollyland-web-ui
```

That serves Hollyland Web UI on <http://127.0.0.1:47320>, starts the bridge (it asks for your password),
opens the page and connects. You don't need to clone anything. From a clone of this repository, run
`npm run bridge` instead and press **Connect through local bridge**.

> **Coming soon.** The `hollyland-web-ui` package isn't on npm yet, so the `npx` commands on this page don't
> work today. Until it is published, use a clone of this repository and `npm run bridge`
> ([below](#from-a-clone-npm-run-bridge)).

**While the bridge runs, the receiver's USB audio is paused.** See [below](#usb-audio-pauses-while-it-runs).

## Why it exists

- **The receiver does answer.** It replies to every request with an input report whose ID is `0xBB`.
- **macOS drops the replies.** The HID descriptor does not declare report ID `0xBB`, so the macOS HID stack
  (IOHIDFamily) drops every reply before Chrome can see it. Windows probably does the same.
- **The page can still send settings there.** It can't read battery levels, mic status or the current
  values. That is the "write-only" mode (see [PROTOCOL.md §2.4](PROTOCOL.md)).
- **Linux and ChromeOS deliver the replies.** Chrome there gets full read/write and does not need the bridge.

A root libusb capture on macOS (2026-11-05, LARK A2) got exactly one `BB DD …` reply for every `AA DD …`
request on interface 0. The bridge uses that path:

```
Hollyland Web UI page  ──ws://127.0.0.1:47321/hid──▶  bridge (root, libusb)  ──interrupt OUT 0x03──▶  receiver
                       ◀── binary 64-byte packets ──                         ◀── interrupt IN 0x82 ───
```

It relays packets byte for byte and doesn't interpret them. The protocol logic stays in the page
(`HollylandDevice` over `BridgeTransport`, `src/lib/protocol/bridge.ts`).

It was checked on a LARK A2 with macOS and Chrome on 2026-11-05:

- **Live state:** battery, mic online state, noise cancellation, volume and the other settings were all
  live through the bridge.
- **Changes made on the hardware showed up on the next heartbeat (1 s):** a press of the mic button and
  docking a mic. See [PROTOCOL.md §11.7](PROTOCOL.md).

## With npx (`npx hollyland-web-ui`)

*Coming soon: the package isn't on npm yet.*

The `hollyland-web-ui` npm package contains the built web UI, a bundled copy of the bridge and a small
launcher (`cli/hollyland-web-ui.mjs`).

```
npx hollyland-web-ui
```

1. **It serves the UI.** The web UI runs on `http://127.0.0.1:47320`, reachable only from this computer.
2. **It starts the bridge, on macOS.** The bridge is started through `sudo`, which asks for the password you
   log in with: "Password for <you> (Hollyland Web UI needs it to start the USB bridge)".
   - It runs under the same Node binary as npx (absolute path), so nvm, fnm and Volta installs work.
   - If you're already root, no sudo is needed.
3. **It waits until the bridge answers.** Only then does it open the browser, so the browser doesn't take
   focus away from the password prompt.
4. **The page connects by itself.** It opens `http://127.0.0.1:47320/?bridge=auto` and connects through the
   bridge. The header shows **Connected · bridge**. If the receiver isn't plugged in yet, the page waits for it.
5. **Ctrl+C stops everything.** It prints "Stopping the USB bridge…", the bridge hands the receiver back to
   macOS, and USB audio returns a second or two later.

When the bridge can't start, Hollyland Web UI keeps serving the UI in write-only mode and says why. That
covers a declined or wrong password, no terminal to ask in, or the port being taken by another program.
If a bridge is already running on the port (for example `npm run bridge` in another terminal), the launcher
uses it and leaves it running when you stop.

| Option | Meaning |
| --- | --- |
| `--no-bridge` | Don't start the bridge (WebHID only; write-only on macOS, USB audio keeps working). |
| `--bridge` | Start the bridge on Linux too. It starts by default only on macOS. Windows can't run it. |
| `--bridge-only` | Start only the bridge, for the [hosted page](#hosted-page-github-pages), which it then also accepts. No web server, no browser. |
| `-p`, `--port <n>` | Web UI port (default 47320). |
| `--bridge-port <n>` | Bridge port (default 47321). The page is opened with `?bridge=<n>&auto=1`. |
| `--no-open` | Don't open a browser; the address is printed. |
| `--verbose` | The bridge prints every packet in hex. |
| `-v`, `--version`, `-h`, `--help` | Version, help. |

## Hosted page (GitHub Pages)

The hosted Hollyland Web UI at <https://khromov.github.io/hollyland-web-ui/> can use the bridge too:

```
npx hollyland-web-ui --bridge-only
```

Until the package is on npm, start it from a clone of this repository (after `npm install`):

```
npm run bridge -- --allow-origin https://khromov.github.io
```

Then open the address it prints, <https://khromov.github.io/hollyland-web-ui/?bridge=auto>, or press
**Connect through local bridge** on the hosted page.

- **Origin.** The bridge accepts the hosted page only when it is started for it: `--bridge-only` passes
  `--allow-origin https://khromov.github.io` to the bridge, and from a clone you add it yourself. A plain
  `npx hollyland-web-ui` or `npm run bridge` accepts only pages served from this computer. See
  [Security model](#security-model).
- **Chrome's local network permission.** Chrome treats a public https page that connects to `127.0.0.1` as
  local network access. The first time, it asks whether the site may access apps and devices on your local
  network or this computer. **Allow it.** If it is blocked, the WebSocket fails even though the bridge is
  running; the page checks the permission and says "Browser didn't allow the bridge" instead of "Bridge not
  reachable", and stops retrying. To fix that, open the site settings (the icon left of the address) and
  allow local network access, or reset the permission and reload.
- **Mixed content.** `ws://127.0.0.1` from an https page is allowed, because browsers treat loopback as
  secure.
- **No permission prompt with npx.** Pages served by `npx hollyland-web-ui` or `npm run dev` are on loopback
  themselves, so Chrome doesn't ask.

## From a clone (`npm run bridge`)

From the Hollyland Web UI project folder (after `npm install`):

```
npm run bridge
```

- **It asks for your password.** Only root may take a USB device away from macOS.
- **Don't type `sudo npm run bridge`.** `npm run bridge` re-launches itself as
  `sudo <your node> --import tsx scripts/bridge.ts`, using the **absolute path** of the Node that runs npm.
  That avoids `sudo: node: command not found` with nvm, fnm or Volta.
- **What it prints.** The WebSocket URL, which pages it accepts, and `captured LARK A2 …` once it holds the
  receiver. If the receiver isn't plugged in yet, it waits for it.
- **Connect from the page.** In Hollyland Web UI (e.g. `npm run dev`), press **Connect through local bridge**.
  - The button is on the connect screen.
  - It is also in the "Connection lost" banner, which appears when the bridge takes the receiver away from a
    write-only session.
  - The header then shows **Connected · bridge**.
- **Stopping.** Press **Ctrl+C** in the terminal. The bridge always hands the receiver back to macOS.

Options (pass them after `--`):

| Option | Meaning |
| --- | --- |
| `--port <n>` | WebSocket port on 127.0.0.1 (default 47321). Open the page with `?bridge=<n>` to match. |
| `--allow-origin <origin>` | Also accept pages from this exact origin, e.g. `https://mic.example.com`. Repeatable. |
| `--allow-no-origin` | Accept clients that send no `Origin` header (Node scripts using `BridgeTransport`). |
| `--iap2` | Also relay the vendor bulk interface on `/iap2` (experimental, see below). |
| `--iap2-interface <n>` | Interface number for `--iap2` (default 7). |
| `--pid <n>` | Only capture this USB product ID (decimal or `0x…`). |
| `--verbose` | Print every packet in hex. |
| `--embedded` | Short banner and log lines marked `bridge` (used by `npx hollyland-web-ui`). |
| `--help` | Show the options. |

Example: `npm run bridge -- --port 47400 --verbose`, then open `http://localhost:5173/?bridge=47400`.

## Page URL parameters

| Parameter | Effect |
| --- | --- |
| `?bridge=<port>` | Use the bridge on that port when you press **Connect through local bridge**. |
| `?bridge=auto` | Connect through the bridge on the default port as soon as the page loads. |
| `?bridge=<port>&auto=1` | The same on another port. |

- **Retries.** In auto mode the page keeps trying for 20 seconds while the bridge isn't up yet (for example,
  sudo is still waiting for the password). It stops at once if Chrome's local network permission is denied.
- **The receiver.** Once the bridge answers, the page waits on that connection until the bridge has
  captured the receiver.
- **Plain visits.** A visit without these parameters behaves as before.

## USB audio pauses while it runs

**Why the whole device.** On macOS, a program can only use the receiver's control interface after macOS lets
go of the device. libusb does that by asking macOS to re-enumerate the device and *capture* it. That takes
root and hands the **whole** USB device to the bridge, every interface included. The receiver's audio
interfaces go with it, so its microphone input disappears from the system until the bridge stops. The bridge can't avoid
this. Seizing only the HID interface through IOUSBHost fails even as root (the interface belongs to a
DriverKit driver and needs a restricted entitlement), and every user-space HID path loses the replies
([PROTOCOL.md §11.2](PROTOCOL.md)).

**What stops working.** Live meters, recording, monitoring and voice effects use that audio input, so they
won't work while you're connected through the bridge. On macOS the Audio card then says "USB audio paused".

**A typical session.**

1. Start the bridge and connect.
2. Change and check settings.
3. Press Ctrl+C. Audio comes back a second or two later.

If you mainly want audio, use `npx hollyland-web-ui --no-bridge` (or the hosted page) and accept write-only control.

**On Linux** the bridge only detaches the HID driver from interface 0, so audio keeps working. Linux doesn't
need the bridge anyway.

## Security model

The bridge runs as root and gives a web page full control of the receiver, including factory reset. So it is
deliberately narrow:

- **Loopback only.** It binds to `127.0.0.1`. Other computers on the network can't reach it.
- **Origin allow list.** WebSocket upgrades are accepted only from these pages:
  - pages served at `http(s)://localhost[:port]`, `http(s)://127.0.0.1[:port]` or `http(s)://[::1][:port]`;
  - exact origins passed with `--allow-origin`. `npx hollyland-web-ui --bridge-only` passes the origin of
    the hosted Hollyland Web UI, `https://khromov.github.io`; no other launch accepts it.

  Other websites you visit can't use it. A refused page is closed with code 4003 so Hollyland Web UI can show
  what to do, and nothing it sends is ever read.
- **The hosted origin covers more than Hollyland Web UI.** An origin is a whole host. `https://khromov.github.io`
  covers every GitHub Pages site of that account, not only `/hollyland-web-ui/`, and the bridge relays every
  command, factory reset included. That is why it is accepted only in `--bridge-only` mode (or with an
  explicit `--allow-origin`), never by default.
- **Host check.** The `Host` header must be a loopback name with the bridge's port. That stops DNS-rebinding
  tricks.
- **One client at a time.** A second page or tab is refused with code 4001 ("another client is already
  connected to the bridge").
- **No Origin, no entry.** Clients without an `Origin` header (non-browser programs) are refused unless you
  pass `--allow-no-origin`.
- **Fixed packet size.** On `/hid` only binary messages of exactly 64 bytes reach the receiver. Anything else
  gets a JSON `error` reply and is dropped.
- **Nothing else.** It doesn't serve files or proxy anything, and it keeps no state on disk. It answers a
  plain `GET /` with a one-line banner (`Hollyland Web UI bridge …`), which `npx hollyland-web-ui` uses to
  see whether a bridge is already running.

Only add `--allow-origin` for a deployment you trust. Any page on that origin gets full control of the
receiver while the bridge runs.

The npx launcher's own web server listens on 127.0.0.1 only. It serves only the files in the package's
`cli/dist/web`: no directory listings, no dotfiles, no `..` paths, and no symlinks that point outside that
folder.

## Wire protocol

Path `/hid`, see `src/lib/protocol/bridge.ts`:

| Direction | Frame | Content |
| --- | --- | --- |
| page → bridge | binary | one 64-byte interrupt-OUT packet (`AA DD cmd dst lenHi lenLo payload…`) |
| bridge → page | binary | one interrupt-IN packet as read (`BB DD cmd src …`, 64 bytes) |
| bridge → page | text | `{"type":"hello","device":{vendorId,productId,productName,manufacturer,serialNumber} \| null,"bridge":{"version":"1.0.0","iap2":false},"channel":"hid"}` on connect |
| bridge → page | text | `{"type":"unplugged"}` when the receiver leaves (unplug, RX restart) |
| bridge → page | text | `{"type":"replugged","device":{…}}` once it is captured again |
| bridge → page | text | `{"type":"error","message":"…"}` for a rejected message |

Close codes:

| Code | Meaning |
| --- | --- |
| `4001` | another client is connected |
| `4003` | origin refused |
| `4004` | channel switched off |
| `1001` | bridge stopped |

**`BridgeTransport.connect(url?, timeoutMs?)`**

- **Resolves** once `hello` has arrived and the bridge holds a receiver.
- **Rejects** with a `BridgeError` whose `kind` is `not-running`, `in-use`, `origin`, `timeout`, `no-device`,
  `blocked` or `closed`. Each kind has a short `title` and a message that says what to do.
- **Runs** in browsers and in Node 22+ (it uses `globalThis.WebSocket`). For Node clients, start the bridge
  with `--allow-no-origin`.

**After `unplugged`** the socket stays open. Hollyland Web UI shows "Connection lost" and reattaches automatically
on `replugged`. That also covers the restart after "External speaker without unplugging".

## iAP2 relay (`--iap2`, experimental)

The A2 also exposes interface 7: vendor class `0xFF`/`0xF0`, with bulk IN `0x83` and bulk OUT `0x02`. That is
the iAP2 accessory channel the iOS app uses. With `--iap2` the bridge also claims it and relays raw bytes on
`ws://127.0.0.1:47321/iap2`:

- **binary page → bridge:** any length, written to bulk OUT as is (no ZLP handling)
- **binary bridge → page:** each completed bulk IN transfer (one USB packet, up to 64 bytes)
- **the same rules:** the same `hello` / `unplugged` / `replugged` text messages, and the same origin and
  one-client rules

The bridge does **not** implement iAP2 (link synchronization, authentication, sessions). It is only a pipe
for experiments. If interface 7 can't be claimed, the bridge logs that and `/iap2` stays silent; `/hid` is
unaffected.

## Troubleshooting

The page names the command that fits where it is served from. On a page from this computer that is
`npm run bridge` (in the project folder); on the hosted page it is `npm run bridge -- --allow-origin
https://khromov.github.io` from a clone. Once the package is on npm, both say `npx hollyland-web-ui --bridge-only`
(`NPM_PACKAGE_PUBLISHED` in `src/lib/protocol/bridge.ts`).

### Starting the bridge

| Symptom | Fix |
| --- | --- |
| `npx hollyland-web-ui` says the bridge didn't start after the password prompt | sudo gave up after three wrong passwords. Hollyland Web UI keeps running write-only and opens the plain page; run it again to retry. (Ctrl+C at the prompt stops Hollyland Web UI altogether.) |
| "sudo can only ask for your password in a terminal" | Run `npx hollyland-web-ui` in a terminal window, not from a script or an IDE task without a TTY. |
| "The bridge needs root" | From a clone, run `npm run bridge`, not `node scripts/bridge.ts` or `npx tsx …`. With the package, use `npx hollyland-web-ui`. |
| `sudo: node: command not found` / `sudo: npm: command not found` | Use `npm run bridge` without `sudo`; it passes the full Node path to sudo. `npx hollyland-web-ui` does the same. |
| "Could not load the "usb" package" | From a clone: `npm install`. With the package: `npx --yes hollyland-web-ui@latest`. |
| "Port 47320 … already in use" (`npx hollyland-web-ui`) | Hollyland Web UI is already running in another terminal. Stop it, or use `--port <n>`. |
| "port 47321 is in use by another program" | Something other than the bridge holds that port. Use `--bridge-port <n>` (or `--port <n>` with `npm run bridge`, then open the page with `?bridge=<n>`). |
| "Port 47321 … already in use" (`npm run bridge`) | Another bridge is running (stop it), or pick `--port <n>` and open the page with `?bridge=<n>`. |
| Windows: "The bridge does not run on Windows" | Expected. Windows can't detach its HID driver from one interface without replacing the driver (e.g. with WinUSB through Zadig), and that would break the receiver's normal use. Use write-only mode, or Chrome on Linux/ChromeOS. |

### Connecting the page

| Symptom | Fix |
| --- | --- |
| "Browser didn't allow the bridge" on the **hosted** page | Chrome's local network permission is blocked for the site. Allow it in the site settings and reload ([details](#hosted-page-github-pages)). |
| "Bridge not reachable" otherwise | The bridge isn't running, or it uses another port. Open the page with `?bridge=<port>`. |
| "Waiting for the local bridge…" then a timeout (`?bridge=auto`) | The bridge didn't come up within 20 s. Check the terminal (password prompt, error), keep `npx hollyland-web-ui` running, then press **Connect through local bridge**. |
| "Bridge refused this page" | The bridge wasn't started for this page. For the hosted page use `npx hollyland-web-ui --bridge-only` (or `npm run bridge -- --allow-origin https://khromov.github.io`); for another site, `npm run bridge -- --allow-origin <origin shown in the message>`. |
| "Bridge already in use" | Another tab is connected. Disconnect there or close it, then retry. |
| "No receiver on the bridge" / bridge says "waiting for a receiver" | Plug the receiver in (data cable), or unplug and re-plug it. With an unusual PID use `--pid`. |
| "could not capture the receiver: … in use by another program" | Quit other tools that opened the receiver (another bridge, a probe script), then re-plug. |
| Chrome asks whether the page may access apps or devices on your local network / this device | Allow it; the bridge runs on this computer (127.0.0.1). |
| The page shows "Connection lost" after you start the bridge | Expected: the bridge took the receiver away from WebHID. Press **Connect through local bridge** in that banner. |

### Audio and the hardware

| Symptom | Fix |
| --- | --- |
| No meters, recording or monitoring while connected through the bridge; "USB audio paused" | Expected on macOS: the bridge holds the whole receiver. Stop it (Ctrl+C) to get audio back. |
| **Audio doesn't come back after stopping** | Unplug and re-plug the receiver. This can happen if the bridge was killed hard before it could re-attach the macOS drivers, for example with `kill -9` or by closing the laptop lid mid-capture. |
| A mic shows "Not connected" although it is on | Docked mics report offline. Take it out of the charging case, turn it on, or check its pairing. |
| Pressing the button on an A2 mic switches noise cancellation instead of muting | That is what the A2's button does ([PROTOCOL.md §11.7](PROTOCOL.md)). The Receiver card follows within a second. |

## Files

- `scripts/bridge.ts`: CLI, root check, USB capture (libusb via the `usb` package), hot-plug, clean-up.
  - node-usb's `Interface.claim()` passes the interface *index*. The A2's interfaces are numbered 0, 1, 3, 7,
    so the bridge calls the device methods with the real interface number.
- `scripts/bridge-server.ts`: WebSocket relay, Origin and Host checks, the one-client rule. It has no USB code
  and is unit-tested.
- `scripts/bridge-launch.mjs`: `npm run bridge`, re-launch under sudo with the current Node and tsx.
- `cli/hollyland-web-ui.mjs`, `cli/lib/`: the `npx hollyland-web-ui` launcher and its loopback static server.
  - `npm run build:cli` (run by `npm pack`) builds the UI into `cli/dist/web`.
  - It also bundles the bridge into `cli/dist/bridge.mjs`.
- `src/lib/protocol/bridge.ts`: `BridgeTransport`, `BridgeError`, wire types.
- `src/lib/protocol/__tests__/bridge.test.ts`: the real relay server with a fake receiver replaying the live
  A2 capture.
