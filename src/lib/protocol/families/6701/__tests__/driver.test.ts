/**
 * Family 6701: shared conformance suite (docs/FAMILIES.md §5.3). While the driver is a stub this
 * checks the registry contract only; the family package adds gates / preconditions here.
 */
import { describeDriverConformance } from '../../../core/conformance'
import { driver } from '..'

describeDriverConformance(driver)
