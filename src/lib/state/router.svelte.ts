/** Tiny hash router: #/overview, #/audio, #/device, #/settings, #/console */

export type Route = 'overview' | 'audio' | 'settings' | 'device' | 'console'

const ROUTES: Route[] = ['overview', 'audio', 'settings', 'device', 'console']

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
