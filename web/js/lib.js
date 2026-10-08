// Small helpers every part of the page uses: libraries from the CDN, colours,
// HTML escaping, and the geometry the views share.

/** The graph libraries, pinned; loaded only when a view needs them. */
export const CDN = {
  '3d': 'https://cdn.jsdelivr.net/npm/3d-force-graph@1.80.1',
  '2d': 'https://cdn.jsdelivr.net/npm/force-graph@1.52.0',
  marked: 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  purify: 'https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js',
}

/**
 * ES modules for the orbit view. three-globe's build imports three from this
 * exact URL, so importing three and its controls from it too gives one copy.
 */
export const ESM = {
  three: 'https://cdn.jsdelivr.net/npm/three@0.180.0/+esm',
  controls: 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/controls/OrbitControls.js/+esm',
  globe: 'https://cdn.jsdelivr.net/npm/three-globe@2.45.0/+esm',
}

const scripts = {}

/** Adds a classic script once; resolves when it has run. */
export function loadScript(url) {
  scripts[url] ||= new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = url
    tag.onload = resolve
    tag.onerror = () => reject(new Error(`Could not load ${url}`))
    document.head.appendChild(tag)
  })
  return scripts[url]
}

export const deg = radians => (radians * 180) / Math.PI

/** Tokens as the pane writes them: 840, 1.2k, 18k. */
export const formatTokens = n => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(Math.round(n)))

/** A colour (`#rrggbb`, or `rgb(r,g,b)` as mixHex gives) at opacity `a`. */
export const alpha = (color, a) => {
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', `,${a})`)
  const n = Number.parseInt(color.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

export const mixHex = (a, b, t) => {
  const x = Number.parseInt(a.slice(1), 16)
  const y = Number.parseInt(b.slice(1), 16)
  const channel = shift => Math.round(((x >> shift) & 255) + (((y >> shift) & 255) - ((x >> shift) & 255)) * t)
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ENTITIES[c])

/** The point `distance` radians from (lat, lon) along `bearing`, on a unit sphere. */
export function destination(lat, lon, bearing, distance) {
  const toLat = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing))
  return [
    toLat,
    lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(toLat)),
  ]
}

/** A d3 force pulling each node toward a centre of its own, so groups stay together. */
export function clusterForce(centreOf, strength) {
  let nodes = []
  const force = a => {
    for (const node of nodes) {
      const c = centreOf(node)
      node.vx += (c.x - node.x) * strength * a
      node.vy += (c.y - node.y) * strength * a
      if (c.z !== undefined && node.vz !== undefined) node.vz += (c.z - node.z) * strength * a
    }
  }
  force.initialize = list => {
    nodes = list
  }
  return force
}

/** Whether the screen is narrow enough for the phone layout (matches the CSS breakpoint). */
export const isNarrow = () => window.matchMedia('(max-width: 760px)').matches
