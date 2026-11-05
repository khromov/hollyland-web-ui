/**
 * Read-only bench probe for Hollyland receivers over node-hid.
 *
 *   npx tsx scripts/probe.ts <subcommand> [options]
 *
 * Subcommands (all READ-ONLY):
 *   list               HID collections of VID 0x3547 / 0x4417 (no device I/O)
 *   info               versions + serial numbers of RX/TX1/TX2, device info (0x16)
 *   status             heartbeat (0x10), decoded
 *   battery            heartbeat -> battery / charging summary
 *   settings           heartbeat + every GET-only setting
 *   sweep              every catalogued read-only command once (diagnostic)
 *   device             run HollylandDevice.connect() (probe + background reads) and print state
 *   listen [seconds]   passively print every input report
 *   raw <hex>          send one frame; anything not catalogued as read-only is refused unless --force
 *
 * Options:
 *   --timeout <ms>     reply timeout per request (default 400)
 *   --pid <n>          product id (default: first Hollyland device)
 *   --xor              append the iOS XOR byte after the payload
 *   --unpadded         send only 6+LEN bytes instead of 64 (the A2 treats this as invalid)
 *   --no-diag          do not read macOS HID driver counters (IORegistry)
 *   --json             machine-readable output
 *   --force            (raw only) allow non-read-only commands. Do not use on hardware you care about.
 */
import {
  COMMANDS, Cmd, FrameAssembler, Requests, Target, TARGET_NAMES, commandName, decodeFrame, describePayload, encodeRequest,
  fromHex, isReadOnlyCommand, lookupProduct, parseHeartbeat, toHexTrimmed, HollylandDevice,
  type DecodedFrame, type Family, type RequestFrame,
} from '../src/lib/protocol/index.ts'
import { NodeHidTransport, listHollylandHid, readDarwinHidCounters, type DarwinHidCounters } from './node-hid-transport.ts'

interface Opts {
  timeout: number
  pid?: number
  xor: boolean
  unpadded: boolean
  diag: boolean
  json: boolean
  force: boolean
}

function parseArgs(argv: string[]): { cmd: string; rest: string[]; opts: Opts } {
  const opts: Opts = { timeout: 400, xor: false, unpadded: false, diag: true, json: false, force: false }
  const rest: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--timeout') opts.timeout = Number(argv[++i])
    else if (a === '--pid') opts.pid = Number(argv[++i])
    else if (a === '--xor') opts.xor = true
    else if (a === '--unpadded') opts.unpadded = true
    else if (a === '--no-diag') opts.diag = false
    else if (a === '--json') opts.json = true
    else if (a === '--force') opts.force = true
    else rest.push(a)
  }
  return { cmd: rest.shift() ?? 'help', rest, opts }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Exchange {
  name: string
  target: string
  tx: string
  rx: string[]
  decoded: string | null
  frame: DecodedFrame | null
  driver: { inputReports: number; setReports: number } | null
  note?: string
}

class Session {
  readonly t: NodeHidTransport
  readonly opts: Opts
  readonly family: Family
  private readonly asm = new FrameAssembler('packet')
  private inbox: Uint8Array[] = []
  readonly log: Exchange[] = []

  constructor(t: NodeHidTransport, opts: Opts) {
    this.t = t
    this.opts = opts
    const info = t.info
    this.family = (info && lookupProduct(info.vendorId, info.productId)?.family) || '6118'
    t.onPacket((p) => this.inbox.push(p))
  }

  counters(): DarwinHidCounters | null {
    return this.opts.diag ? readDarwinHidCounters(this.t.info?.vendorId, this.t.info?.productId) : null
  }

  async exchange(frame: RequestFrame): Promise<Exchange> {
    const packet = encodeRequest(frame, { appendXor: this.opts.xor, pad: !this.opts.unpadded })
    return this.exchangeRaw(packet)
  }

  async exchangeRaw(packet: Uint8Array): Promise<Exchange> {
    const req = decodeFrame(packet)
    const before = this.counters()
    this.inbox = []
    await this.t.send(packet)
    const deadline = Date.now() + this.opts.timeout
    let reply: DecodedFrame | null = null
    const rx: string[] = []
    while (Date.now() < deadline && !reply) {
      await sleep(10)
      for (const p of this.inbox.splice(0)) {
        rx.push(toHexTrimmed(p))
        for (const f of this.asm.push(p)) if (!reply && req && f.cmd === req.cmd) reply = f
      }
    }
    await sleep(30) // collect a possible duplicate report
    for (const p of this.inbox.splice(0)) rx.push(toHexTrimmed(p))
    const after = this.counters()
    const driver = before && after ? { inputReports: after.inputReports - before.inputReports, setReports: after.setReports - before.setReports } : null
    const ex: Exchange = {
      name: req ? commandName(req.cmd) : 'raw',
      target: req ? TARGET_NAMES[req.target] : '-',
      tx: toHexTrimmed(packet),
      rx,
      frame: reply,
      decoded: reply ? `${TARGET_NAMES[reply.target]} ${describePayload(reply.cmd, 'response', reply.payload, this.family)}` : null,
      driver,
    }
    if (!reply && driver && driver.inputReports > 0) {
      ex.note = `device answered (${driver.inputReports} interrupt-IN report(s) reached the macOS HID driver) but IOHIDFamily dropped them: report id 0xBB is not declared in the descriptor`
    } else if (!reply) {
      ex.note = `no reply within ${this.opts.timeout} ms`
    }
    this.log.push(ex)
    this.print(ex)
    return ex
  }

  print(ex: Exchange): void {
    if (this.opts.json) return
    console.log(`TX  ${ex.tx}    ${ex.name} -> ${ex.target}`)
    for (const r of ex.rx) console.log(`RX  ${r}`)
    if (ex.decoded) console.log(`    = ${ex.decoded}`)
    if (ex.driver) console.log(`    macOS HID driver: +${ex.driver.setReports} SetReport, +${ex.driver.inputReports} InputReport`)
    if (ex.note) console.log(`    ! ${ex.note}`)
  }
}

async function withSession<T>(opts: Opts, fn: (s: Session) => Promise<T>): Promise<T> {
  const t = new NodeHidTransport({ productId: opts.pid })
  await t.open()
  const e = t.entryInfo
  if (!opts.json) {
    const prod = e ? lookupProduct(e.vendorId, e.productId) : undefined
    console.log(
      `# ${e?.product} [${e?.manufacturer}] VID 0x${e?.vendorId.toString(16)} PID 0x${e?.productId.toString(16).padStart(4, '0')} ` +
        `serial ${e?.serialNumber} -> ${prod?.name ?? 'unknown'} (family ${prod?.family ?? '-'}), collection usagePage 0x${(e?.usagePage ?? 0).toString(16)}`,
    )
    console.log(`# platform ${process.platform}; transport receive capability: ${t.capabilities.receive}; ${new Date().toISOString()}`)
  }
  const s = new Session(t, opts)
  try {
    return await fn(s)
  } finally {
    await t.close()
    if (opts.json) console.log(JSON.stringify(s.log, (k, v) => (k === 'frame' ? undefined : v), 2))
  }
}

const READS_INFO = (fam: Family): RequestFrame[] => [
  Requests.heartbeat(),
  Requests.versionFor(fam, Target.RX), Requests.serial(Target.RX),
  Requests.versionFor(fam, Target.TX1), Requests.serial(Target.TX1),
  Requests.versionFor(fam, Target.TX2), Requests.serial(Target.TX2),
  Requests.deviceInfo(),
]

const READS_SETTINGS = (fam: Family): RequestFrame[] => {
  const l = [Requests.heartbeat(), Requests.noiseLevelGet(), Requests.volumeGet(), Requests.speakerGet(), Requests.voiceLockGet()]
  if (fam === '6118') l.push(Requests.micRecognitionGet(), Requests.smartBatteryGet())
  if (fam === '6302') l.push(Requests.buttonColorsGet())
  return l
}

function printHeartbeat(s: Session, ex: Exchange, mode: 'status' | 'battery'): void {
  if (!ex.frame || s.opts.json) return
  const hb = parseHeartbeat(s.family, ex.frame.payload)
  if (mode === 'battery') {
    hb.tx.forEach((t, i) =>
      console.log(`TX${i + 1}: ${t.online ? `online, ${t.battery}%${t.charging ? ', charging' : ''}${t.muted ? ', muted' : ''}` : 'offline'}`))
    if (hb.family === '6118') console.log(`RX (camera only): ${hb.rxCamera.battery}%${hb.rxCamera.charging ? ', charging' : ''}`)
  } else {
    console.log(JSON.stringify(hb, null, 2))
  }
}

async function main(): Promise<void> {
  const { cmd, rest, opts } = parseArgs(process.argv.slice(2))
  switch (cmd) {
    case 'list': {
      const l = listHollylandHid()
      if (opts.json) console.log(JSON.stringify(l, null, 2))
      else for (const d of l) {
        const p = lookupProduct(d.vendorId, d.productId)
        console.log(`${d.path}  VID 0x${d.vendorId.toString(16)} PID 0x${d.productId.toString(16).padStart(4, '0')} if ${d.interface} ` +
          `usagePage 0x${(d.usagePage ?? 0).toString(16)} usage 0x${(d.usage ?? 0).toString(16)}  ${d.product} -> ${p?.name ?? 'unknown'}`)
      }
      if (!l.length) console.log('no Hollyland HID devices found')
      return
    }
    case 'status':
    case 'battery':
      await withSession(opts, async (s) => printHeartbeat(s, await s.exchange(Requests.heartbeat()), cmd))
      return
    case 'info':
      await withSession(opts, async (s) => {
        for (const f of READS_INFO(s.family)) await s.exchange(f)
      })
      return
    case 'settings':
      await withSession(opts, async (s) => {
        for (const f of READS_SETTINGS(s.family)) await s.exchange(f)
      })
      return
    case 'sweep':
      await withSession(opts, async (s) => {
        for (const info of Object.values(COMMANDS)) {
          if (info.safety !== 'read' || !info.families.includes(s.family)) continue
          for (const t of info.targets) {
            const f: RequestFrame = info.id === Cmd.DEVICE_ID_GET ? Requests.deviceId(t) : { cmd: info.id, target: t, payload: [] }
            await s.exchange(f)
          }
        }
      })
      return
    case 'device':
      await withSession(opts, async (s) => {
        const dev = new HollylandDevice(s.t, { probeTimeoutMs: opts.timeout, requestTimeoutMs: opts.timeout, heartbeatIntervalMs: null, appendXor: opts.xor })
        dev.onTraffic((e) => !opts.json && console.log(`${e.direction === 'tx' ? 'TX' : 'RX'}  ${e.hex || '-'}    ${e.summary}${e.note ? ` [${e.note}]` : ''}`))
        const st = await dev.connect()
        await sleep(opts.timeout * 4)
        console.log(JSON.stringify({ rx: st.rx, units: dev.state.units, settings: dev.state.settings, product: dev.product.name }, null, 2))
        await dev.disconnect()
      })
      return
    case 'listen': {
      const secs = Number(rest[0] ?? 10)
      const t = new NodeHidTransport({ productId: opts.pid })
      await t.open()
      const c0 = opts.diag ? readDarwinHidCounters() : null
      let n = 0
      t.onPacket((p) => {
        n++
        const f = decodeFrame(p)
        console.log(`${new Date().toISOString()}  RX  ${toHexTrimmed(p)}${f ? `    ${describePayload(f.cmd, f.direction, f.payload)}` : ''}`)
      })
      console.log(`listening ${secs} s (nothing is sent)…`)
      await sleep(secs * 1000)
      await t.close()
      const c1 = opts.diag ? readDarwinHidCounters() : null
      console.log(`${n} input report(s) delivered to user space` + (c0 && c1 ? `; macOS HID driver saw +${c1.inputReports - c0.inputReports}` : ''))
      return
    }
    case 'raw': {
      const hex = rest.join('')
      if (!hex) throw new Error('usage: raw <hex>, e.g. raw "aa dd 10 40 00 00"')
      let packet = fromHex(hex)
      const f = decodeFrame(packet)
      const readOnly = !!f && f.direction === 'request' && isReadOnlyCommand(f.cmd)
      if (!readOnly && !opts.force) {
        const what = f ? `${commandName(f.cmd)} (${COMMANDS[f.cmd]?.safety ?? 'uncatalogued'})` : 'a packet that is not an AA DD request'
        console.error(`refused: ${what} is not marked read-only. Re-run with --force only if you know exactly what it does.`)
        process.exitCode = 2
        return
      }
      if (!opts.unpadded && packet.length < 64) {
        const p = new Uint8Array(64)
        p.set(packet)
        packet = p
      }
      await withSession(opts, async (s) => {
        await s.exchangeRaw(packet)
      })
      return
    }
    default:
      console.log(`usage: npx tsx scripts/probe.ts <list|info|status|battery|settings|sweep|device|listen [s]|raw <hex>> [--timeout ms] [--pid n] [--xor] [--unpadded] [--no-diag] [--json] [--force]`)
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e)
  process.exitCode = 1
})
