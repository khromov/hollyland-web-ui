# Local USB bridge

The bridge is an optional helper you run on your own computer. It gives Mic Console full read **and**
write access to the receiver on macOS, where the browser can only send settings.

```
npm run bridge
```

Then press **Connect through local bridge** in Mic Console.

## Why it exists

The receiver answers every request with an input report whose ID is `0xBB`. Its HID descriptor
does not declare that ID, so the macOS HID stack (IOHIDFamily) drops every reply before Chrome
can see it. Windows probably does the same. The page can still *send* settings there, but it
can't read battery levels, mic status or the current values: the "write-only" mode
(see [PROTOCOL.md §2.4](PROTOCOL.md)). Linux and ChromeOS deliver the replies, so Chrome there
gets full read/write and does not need the bridge.

The receiver *does* answer: a root libusb capture on macOS (2026-11-05, LARK A2) got exactly one
`BB DD …` reply for every `AA DD …` request on interface 0. The bridge uses that path:

```
Mic Console page  ──ws://127.0.0.1:47321/hid──▶  bridge (root, libusb)  ──interrupt OUT 0x03──▶  receiver
                  ◀── binary 64-byte packets ──                         ◀── interrupt IN 0x82 ───
```

It relays packets byte for byte and doesn't interpret them. The protocol logic stays in the
page (`HollylandDevice` over `BridgeTransport`, `src/lib/protocol/bridge.ts`).

## Running it

From the Mic Console project folder (after `npm install`):

```
npm run bridge
```

- It asks for your password: only root may take a USB device away from macOS.
- `npm run bridge` re-launches itself as `sudo <your node> --import tsx scripts/bridge.ts`, using
  the **absolute path** of the Node that runs npm. That avoids `sudo: node: command not found`
  with nvm, fnm or Volta. Don't type `sudo npm run bridge`.
- It prints the WebSocket URL, which pages it accepts, and `captured LARK A2 …` once it holds the
  receiver. If the receiver isn't plugged in yet, it waits for it.
- Then, in Mic Console: **Connect through local bridge**. That button is on the connect screen
  and in the "Connection lost" banner that appears when the bridge takes the receiver away from a
  write-only session. The header then shows **Connected · bridge**.
- Press **Ctrl+C** in the terminal to stop. The bridge always hands the receiver back to macOS.

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
| `--help` | Show the options. |

Example: `npm run bridge -- --port 47400 --verbose`, then open `http://localhost:5173/?bridge=47400`.

## USB audio pauses while it runs

On macOS, detaching the drivers from one interface captures the **whole** receiver. Its USB
audio input disappears from the system until the bridge stops. Live meters, recording and voice
effects in Mic Console (which use that audio) won't work while you're connected through the bridge.

A typical session: start the bridge, connect, change and check settings, press Ctrl+C. Audio comes
back a second or two later.

On Linux the bridge only detaches the HID driver from interface 0, so audio keeps working. But
Linux doesn't need the bridge anyway.

## Security model

The bridge runs as root and gives a web page full control of the receiver (including factory
reset), so it is deliberately narrow:

- **Loopback only.** It binds to `127.0.0.1`. Other computers on the network can't reach it.
- **Origin allow list.** WebSocket upgrades are accepted only from pages served at
  `http(s)://localhost[:port]`, `http(s)://127.0.0.1[:port]` or `http(s)://[::1][:port]`, plus
  exact origins passed with `--allow-origin`. Other websites you visit can't use it. A refused page
  is closed with code 4003 so Mic Console can show what to do; nothing it sends is ever read.
- **Host check.** The `Host` header must be a loopback name with the bridge's port. That stops
  DNS-rebinding tricks.
- **One client at a time.** A second page or tab is refused with code 4001
  ("another client is already connected to the bridge").
- **No Origin, no entry.** Clients without an `Origin` header (non-browser programs) are refused
  unless you pass `--allow-no-origin`.
- **Fixed packet size.** On `/hid` only binary messages of exactly 64 bytes reach the receiver.
  Anything else gets a JSON `error` reply and is dropped.
- It doesn't serve files or proxy anything, and it keeps no state on disk.

Only add `--allow-origin` for a deployment you trust. Any page on that origin gets full control of
the receiver while the bridge runs.

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

Close codes: `4001` another client is connected, `4003` origin refused, `4004` channel switched off,
`1001` bridge stopped.

`BridgeTransport.connect(url?, timeoutMs?)` resolves once `hello` arrived and the bridge holds a
receiver. It rejects with a `BridgeError` whose `kind` is `not-running`, `in-use`, `origin`,
`timeout`, `no-device`, `blocked` or `closed`; each one has a short `title` and a message that says
what to do. It works in browsers and in Node 22+ (it uses `globalThis.WebSocket`; start the bridge
with `--allow-no-origin` for Node clients).

After `unplugged` the socket stays open. Mic Console shows "Connection lost" and reattaches
automatically on `replugged`. That covers the restart after "External speaker without unplugging",
too.

## iAP2 relay (`--iap2`, experimental)

The A2 also exposes interface 7 (vendor class `0xFF`/`0xF0`, bulk IN `0x83`, bulk OUT `0x02`).
That is the iAP2 accessory channel the iOS app uses. With `--iap2` the bridge also claims it and
relays raw bytes on `ws://127.0.0.1:47321/iap2`:

- binary page → bridge: any length, written to bulk OUT as is (no ZLP handling)
- binary bridge → page: each completed bulk IN transfer (one USB packet, up to 64 bytes)
- the same `hello` / `unplugged` / `replugged` text messages and the same origin and one-client rules

The bridge does **not** implement iAP2 (link synchronization, authentication, sessions). It is only
a pipe for experiments. If interface 7 can't be claimed, the bridge logs that and `/iap2` stays
silent; `/hid` is unaffected.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "The bridge needs root" | Run `npm run bridge`, not `node scripts/bridge.ts` or `npx tsx …`. |
| `sudo: node: command not found` / `sudo: npm: command not found` | Use `npm run bridge` without `sudo`; it passes the full Node path to sudo. |
| "Bridge not reachable" in the page | The bridge isn't running, or it uses another port: open the page with `?bridge=<port>`. |
| "Bridge refused this page" | The page isn't served from localhost. Restart with `npm run bridge -- --allow-origin <origin shown in the message>`. |
| "Bridge already in use" | Another tab is connected. Disconnect there or close it, then retry. |
| "No receiver on the bridge" / bridge says "waiting for a receiver" | Plug the receiver in (data cable), or unplug and re-plug it. With an unusual PID use `--pid`. |
| "could not capture the receiver: … in use by another program" | Quit other tools that opened the receiver (another bridge, a probe script), then re-plug. |
| "Port 47321 … already in use" | Another bridge is running (stop it), or pick `--port <n>` and open the page with `?bridge=<n>`. |
| Chrome asks whether the page may access devices on your local network | Allow it; the bridge runs on this computer (127.0.0.1). |
| **Audio doesn't come back after stopping** | Unplug and re-plug the receiver. This can happen if the bridge was killed hard (`kill -9`, closed laptop lid mid-capture) before it could re-attach the macOS drivers. |
| The page shows "Connection lost" after you start the bridge | Expected: the bridge took the receiver away from WebHID. Press **Connect through local bridge** in that banner. |
| Live meters/recording stop while connected through the bridge | Expected: USB audio is paused while the bridge holds the receiver. Stop the bridge to get it back. |

Windows: not supported. Windows can't detach its HID driver from one interface without replacing
the driver (e.g. with WinUSB through Zadig), and that would break the receiver's normal use.

## Files

- `scripts/bridge.ts`: CLI, root check, USB capture (libusb via the `usb` package), hot-plug, clean-up.
  Note: node-usb's `Interface.claim()` passes the interface *index*; the A2's interfaces are numbered
  0, 1, 3, 7, so the bridge calls the device methods with the real interface number.
- `scripts/bridge-server.ts`: WebSocket relay, Origin and Host checks, one-client rule (no USB code; unit-tested).
- `scripts/bridge-launch.mjs`: `npm run bridge`, re-launch under sudo with the current Node and tsx.
- `src/lib/protocol/bridge.ts`: `BridgeTransport`, `BridgeError`, wire types.
- `src/lib/protocol/__tests__/bridge.test.ts`: the real relay server with a fake receiver replaying the live A2 capture.
