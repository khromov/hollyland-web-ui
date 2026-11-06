/**
 * Legacy `AA DD` families (6118 / 6301 / 6302 / 6501) behind MicDevice, plus the developer option
 * that forces a 6501 profile on a connected receiver (profiles.ts). runtime.ts is what the app loads
 * (core/loader.ts, without the simulators of driver.ts).
 * Owner: W0, then W1 (docs/FAMILIES.md §3.7).
 */
export { LegacyMicDevice, legacyAvailability, legacyValues, toMicState } from './adapter'
export { legacyControls } from './controls'
export { LEGACY_DRIVERS, LegacySimulator, legacyCatalogue, legacyDriver, legacyMockTransport } from './driver'
export { LEGACY_RUNTIMES, legacyRuntime } from './runtime'
export {
  LEGACY_PROFILES, createProfiledMicDevice, forceProfileOptions, legacyProfile, profileFromSearch, profilesFor,
  type LegacyProfile,
} from './profiles'
