// The night sky every view draws on: a faint nebula and a field of stars,
// rendered once per page load and reused. The page shows it behind the bar
// and behind the 3D and 2D graphs, which draw on a transparent canvas. Orbit
// and Multiverse take the nebula alone as a small scene background and the
// stars as points (views/sky3d.js), since a star stretched from an image goes
// blurry up close. Drawing it once is what keeps it free.

import { BACKGROUND } from './palette.js'

const WIDTH = 2048
const HEIGHT = 1024
/** The nebula alone, for a scene's background: soft, so small is enough. */
const NEBULA_WIDTH = 1024
const NEBULA_HEIGHT = 512
const STARS = 4200

const VERTEX = 'attribute vec2 p; varying vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }'

/** The nebula, per pixel of an equirectangular map (longitude across, latitude down). */
const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  float lon = (uv.x - 0.5) * 6.2831853;
  float lat = (uv.y - 0.5) * 3.1415926;
  vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon));
  float violet = fbm(dir * 2.2);
  float teal = fbm(dir * 4.0 + 7.0);
  vec3 color = vec3(0.016, 0.024, 0.047);
  color += vec3(0.16, 0.06, 0.26) * smoothstep(0.5, 0.85, violet) * 0.55;
  color += vec3(0.03, 0.12, 0.2) * smoothstep(0.55, 0.9, teal) * 0.5;
  gl_FragColor = vec4(color, 1.0);
}`

/** The nebula through one short-lived WebGL context, freed straight after; false when WebGL is off. */
function paintNebula(ctx, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false })
  if (!gl) return false
  const shader = (type, source) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, source)
    gl.compileShader(s)
    return s
  }
  const program = gl.createProgram()
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  // One triangle that covers the whole canvas.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const at = gl.getAttribLocation(program, 'p')
  gl.enableVertexAttribArray(at)
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)
  gl.viewport(0, 0, width, height)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  ctx.drawImage(canvas, 0, 0)
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return true
}

/** Without WebGL: the same two clouds as soft gradients. */
function paintGradients(ctx, width, height) {
  ctx.fillStyle = BACKGROUND
  ctx.fillRect(0, 0, width, height)
  for (const [x, y, r, color] of [
    [0.3, 0.4, 0.45, 'rgba(70, 30, 110, 0.35)'],
    [0.72, 0.6, 0.38, 'rgba(15, 55, 85, 0.3)'],
  ]) {
    const g = ctx.createRadialGradient(x * width, y * height, 0, x * width, y * height, r * width)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, width, height)
  }
}

/**
 * The stars, the same every load: spread evenly over the sphere (so not
 * crowded at a map's poles), each with a latitude, a longitude (0–1 around),
 * a hue, a lightness and an opacity, and a few with a glow.
 */
function stars() {
  let seed = 11
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  return Array.from({ length: STARS }, () => ({
    lat: Math.asin(2 * random() - 1),
    lon: random(),
    light: 70 + random() * 25,
    isGlowing: random() < 0.02,
    size: 0.5 + random() * 0.8,
    hue: 210 + random() * 40,
    alpha: 0.35 + random() * 0.6,
  }))
}

function paintStars(ctx) {
  for (const star of stars()) {
    const { lat } = star
    const x = star.lon * WIDTH
    const y = (0.5 - lat / Math.PI) * HEIGHT
    const glow = star.isGlowing
    const size = glow ? 1.6 : star.size
    const color = `hsla(${star.hue}, 45%, ${star.light}%, ${star.alpha})`
    if (glow) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 6)
      g.addColorStop(0, color)
      g.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = g
      ctx.fillRect(x - 6, y - 6, 12, 12)
    }
    ctx.fillStyle = color
    ctx.beginPath()
    // Wider toward the poles, as the map stretches them back when wrapped on a sphere.
    ctx.ellipse(x, y, size / Math.max(0.2, Math.cos(lat)), size, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

let sky
let nebula
let url

/** The sky as an equirectangular canvas, drawn the first time it is asked for. */
export function skyCanvas() {
  if (sky) return sky
  sky = document.createElement('canvas')
  sky.width = WIDTH
  sky.height = HEIGHT
  const ctx = sky.getContext('2d')
  if (!paintNebula(ctx, WIDTH, HEIGHT)) paintGradients(ctx, WIDTH, HEIGHT)
  paintStars(ctx)
  return sky
}

/** The nebula alone, small, for a scene's background. */
export function nebulaCanvas() {
  if (nebula) return nebula
  nebula = document.createElement('canvas')
  nebula.width = NEBULA_WIDTH
  nebula.height = NEBULA_HEIGHT
  const ctx = nebula.getContext('2d')
  if (!paintNebula(ctx, NEBULA_WIDTH, NEBULA_HEIGHT)) paintGradients(ctx, NEBULA_WIDTH, NEBULA_HEIGHT)
  return nebula
}

/** The stars as unit directions and colours (brightness folded in), for points in a scene. */
export function starField() {
  const list = stars()
  const positions = new Float32Array(list.length * 3)
  const colors = new Float32Array(list.length * 3)
  for (const [k, star] of list.entries()) {
    const lon = star.lon * Math.PI * 2
    positions.set([Math.cos(star.lat) * Math.sin(lon), Math.sin(star.lat), Math.cos(star.lat) * Math.cos(lon)], k * 3)
    // HSL to RGB, at 45% saturation, dimmed by the star's opacity.
    const l = star.light / 100
    const a = 0.45 * Math.min(l, 1 - l)
    const channel = n => {
      const h = (n + star.hue / 30) % 12
      return (l - a * Math.max(-1, Math.min(h - 3, 9 - h, 1))) * (star.isGlowing ? 1 : star.alpha)
    }
    colors.set([channel(0), channel(8), channel(4)], k * 3)
  }
  return { positions, colors }
}

/** The sky as an image URL, for a CSS background (the page behind the bar and the graphs). */
export function skyUrl() {
  url ??= new Promise(resolve => skyCanvas().toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : ''), 'image/jpeg', 0.9))
  return url
}

/** Paints an element's background with the sky once it is ready; the flat night colour shows meanwhile. */
export function paintSky(el) {
  skyUrl().then(src => {
    if (src) el.style.backgroundImage = `url("${src}")`
  })
}
