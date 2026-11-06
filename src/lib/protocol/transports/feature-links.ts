/**
 * Registry helpers of the feature-report link (LARK A1, a1-6108.md §2.1), without the transport
 * (webhid-feature.ts): the app builds the USB chooser filters and picks the link before it loads
 * WebHidFeatureTransport with import() (core/loader.ts). webhid-feature.ts re-exports everything here.
 */
import { PRODUCTS, isConnectableProduct, linksOf, lookupProduct, type ProductInfo } from '../models'
import type { WebHidFeatureLinkSpec } from '../core/types'

/** The A1 link (a1-6108.md §2.1), used when neither the options nor the registry give one. */
export const A1_FEATURE_LINK: WebHidFeatureLinkSpec = { kind: 'webhid-feature', reportId: 5, size: 64, otaReportId: 6 }

/** The registry's feature link of a VID/PID, if any. */
export function featureLinkFor(vendorId: number, productId: number): WebHidFeatureLinkSpec | undefined {
  const p = lookupProduct(vendorId, productId)
  return p ? featureLinkOf(p) : undefined
}

/** A product row's feature-report link, if any. */
export function featureLinkOf(p: ProductInfo): WebHidFeatureLinkSpec | undefined {
  return linksOf(p).find((l): l is WebHidFeatureLinkSpec => l.kind === 'webhid-feature')
}

/**
 * `{ vendorId, productId }` chooser filters for rows with a feature-report link. By default only connectable rows
 * (their driver is past the stub); `includeRecognised` adds recognised-only rows (hardware checks, diagnostics).
 */
export function featureLinkFilters(products: readonly ProductInfo[] = PRODUCTS, o: { includeRecognised?: boolean } = {}): HIDDeviceFilter[] {
  return products
    .filter((p) => p.idKind !== 'app' && !!featureLinkOf(p) && (o.includeRecognised || isConnectableProduct(p)))
    .map((p) => ({ vendorId: p.vendorId, productId: p.productId }))
}
