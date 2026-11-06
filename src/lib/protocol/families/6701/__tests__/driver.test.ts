/**
 * Family 6701: the shared conformance suite (docs/FAMILIES.md §5.3) for
 *  - the registered driver (createMax2Driver() on the registry rows since Phase 3, W9), and
 *  - createMax2Driver() (USB RX 1026 / 1027 and BLE BOX 101 against the simulator), plus the BOX behind the
 *    real WebBluetoothTransport and a fake GATT peripheral at MTU 23 and MTU 185 (transports/fake-bluetooth.ts).
 */
import { describe, expect, it } from 'vitest'
import { describeDriverConformance, type ConformanceOptions } from '../../../core/conformance'
import { DRIVERS, canConnect } from '../../../core/registry'
import { bleBridgedDriver } from '../../../transports/fake-bluetooth'
import { createMax2Driver, driver, max2FrameLength, MAX2_APP_PRODUCTS, MAX2_CONTROL, MAX2_PRODUCTS, type Max2Simulator } from '..'

describe('registered MAX 2 driver (Phase 3)', () => {
  it('is createMax2Driver() on the registry rows: RX 1026 / 1027 and the BOX 101 connectable, OWS 102 recognised', () => {
    expect(DRIVERS['6701']).toBe(driver)
    expect(driver.status).toBe('experimental')
    expect(driver.products).toEqual([...MAX2_PRODUCTS, ...MAX2_APP_PRODUCTS])
    for (const p of driver.products) {
      expect(canConnect(p), p.name).toBe(p.productId !== 102)
      expect(p.support?.hardware).toBe('untested')
    }
  })
})

const max2 = createMax2Driver()
const row = (pid: number) => max2.products.find((p) => p.productId === pid)!

const MAX2_CONFORMANCE: ConformanceOptions = {
  // 1 = byte by byte; 20 = BLE MTU 23; 64 = one full-speed HID report; 13 splits right before the XOR byte of a 1-byte ack.
  chunkSizes: [1, 7, 13, 20, 64],
  // The app only ever writes 24bit (0) to "USB Output" (A HLBleDeviceActivity initView lambda 18). USB Output is
  // disruptive (it restarts the RX, iOS), so check 3 skips it; session.test.ts writes it with confirm.
  writeValues: { [MAX2_CONTROL.USB_OUTPUT]: 0 },
  gates: [
    { name: '4 Mic & 1 RX below 3.0.0.50 is unavailable', product: row(1026), sim: { rxVersion: '3.0.0.49' }, control: MAX2_CONTROL.FOUR_MIC, expect: 'unavailable' },
    { name: '4 Mic & 1 RX at 3.0.0.50 (inclusive) is available', product: row(1026), sim: { rxVersion: '3.0.0.50' }, control: MAX2_CONTROL.FOUR_MIC, expect: 'ok' },
    { name: '4 Mic & 1 RX above 3.0.0.50 ("v" prefix stripped)', product: row(1027), sim: { rxVersion: 'V3.0.1.2' }, control: MAX2_CONTROL.FOUR_MIC, expect: 'ok' },
    { name: 'RX Pairing Mode below 3.0.0.50 is unavailable', product: row(1026), sim: { rxVersion: '3.0.0.9' }, control: MAX2_CONTROL.RX_PAIR, expect: 'unavailable' },
    { name: 'RX Pairing Mode at 3.0.0.50', product: row(1026), sim: { rxVersion: '3.0.0.50' }, control: MAX2_CONTROL.RX_PAIR, expect: 'ok' },
    { name: 'Wireless Monitoring below 3.0.0.50 is unavailable', product: row(1026), sim: { rxVersion: '2.9.9.99' }, control: MAX2_CONTROL.WIRELESS, expect: 'unavailable' },
    { name: 'Wireless Monitoring at 3.0.0.50', product: row(1026), sim: { rxVersion: '3.0.0.50' }, control: MAX2_CONTROL.WIRELESS, expect: 'ok' },
    { name: 'Wireless Monitoring is not offered in 4 Mic & 1 RX mode', product: row(1026), sim: { profile: '4mic' }, control: MAX2_CONTROL.WIRELESS, expect: 'unavailable' },
  ],
  preconditions: [
    { name: 'NC needs a mic online', sim: { online: ['rx', 'box'] }, control: MAX2_CONTROL.NOISE_ENABLED, value: false, reason: 'mic-disconnected' },
    { name: 'NC depth needs NC on', arrange: (s) => ((s as Max2Simulator).ncOn = false), control: MAX2_CONTROL.NOISE_DEPTH, value: 4, reason: 'noise-off' },
    { name: 'bit depth refused while TX recording is on', sim: { params: { recording: true } }, product: row(1026), control: MAX2_CONTROL.BIT_DEPTH, value: 0, reason: 'recording-on' },
    { name: 'USB Output 32bit float: "Only supports Apple devices."', control: MAX2_CONTROL.USB_OUTPUT, value: 1, reason: 'apple-only' },
    { name: 'safety track only through the charging case (USB mobile RX)', product: row(1026), control: MAX2_CONTROL.CHANNEL_MODE, value: 2, reason: 'box-only' },
    { name: 'safety track only through the charging case (USB camera RX)', product: row(1027), control: MAX2_CONTROL.CHANNEL_MODE, value: 2, reason: 'box-only' },
    { name: 'stereo refused with TC on in Mode 1 (camera RX)', product: row(1027), sim: { params: { tc: true, tcMode: 0 } }, control: MAX2_CONTROL.CHANNEL_MODE, value: 1, reason: 'timecode-on' },
    { name: 'safety track refused with TC on in Mode 2 (BOX)', product: row(101), sim: { params: { tc: true, tcMode: 1 } }, control: MAX2_CONTROL.CHANNEL_MODE, value: 2, reason: 'timecode-on' },
    { name: 'mic 3 gain only in 4 Mic & 1 RX mode', product: row(1026), control: MAX2_CONTROL.MIC_GAIN, unit: 'tx3', value: 10, reason: 'two-mic-mode' },
    // The OWS preconditions need the RX version (gate 3.0.0.50) first: tested with identity reads in session.test.ts.
  ],
}

describeDriverConformance(max2, MAX2_CONFORMANCE)

// The BOX behind WebBluetoothTransport → fake GATT (FEE7 / FEC1, write without response): MTU 23 with 20-byte
// writes joined again by the peripheral, and MTU 185 (CoreBluetooth's usual) with whole frames.
// The fake GATT stack delivers every notification in its own task: longer timeouts than the suite's 40 ms.
const boxOnly: ConformanceOptions = {
  ...MAX2_CONFORMANCE, products: [row(101)], gates: [], deviceOptions: { requestTimeoutMs: 600, probeTimeoutMs: 600 },
  preconditions: MAX2_CONFORMANCE.preconditions!.filter((p) => !p.product || p.product === row(101)),
}
describeDriverConformance(bleBridgedDriver(max2, { mtu: 23, frameLength: max2FrameLength, transport: { writeChunkSize: 20 } }), boxOnly)
describeDriverConformance(bleBridgedDriver(max2, { mtu: 185, frameLength: max2FrameLength, transport: { writeChunkSize: 182 } }), boxOnly)
