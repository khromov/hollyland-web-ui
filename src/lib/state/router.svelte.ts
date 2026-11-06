/**
 * Tiny hash router: #/overview, #/audio, #/device, #/settings, #/console, and the pages only some
 * products have: #/mixer (MELO P1), #/timecode and #/monitoring (LARK MAX 2). See session.extraPages.
 */

export type Route = 'overview' | 'audio' | 'settings' | 'device' | 'console' | 'mixer' | 'timecode' | 'monitoring'

const ROUTES: Route[] = ['overview', 'audio', 'settings', 'device', 'console', 'mixer', 'timecode', 'monitoring']

function parse(hash: string): Route {
  const r = hash.replace(/^#\/?/, '').split(/[/?]/)[0] as Route
  return ROUTES.includes(r) ? r : 'overview'
}

class Router {
  route: Route = $state(parse(typeof location !== 'undefined' ? location.hash : ''))

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('hashchange', () => {
        this.route = parse(location.hash)
      })
    }
  }

  go(route: Route) {
    if (location.hash !== `#/${route}`) location.hash = `#/${route}`
    this.route = route
  }
}

export const router = new Router()
