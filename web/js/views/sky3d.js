// The night sky inside a three.js scene (Orbit and Multiverse): the nebula as
// a small background texture, since it is soft anyway, and the stars as points
// a pixel or two wide, so they stay sharp at any zoom. Each view passes in its
// own copy of three.js.

import { nebulaCanvas, starField } from '../sky.js'

export function nebulaTexture(THREE) {
  const texture = new THREE.CanvasTexture(nebulaCanvas())
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** The stars on a sphere of `radius` (inside the camera's far plane); keep its position on the camera's, so they stay at infinity. */
export function starPoints(THREE, radius = 1000) {
  const { positions, colors } = starField()
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(
      positions.map(v => v * radius),
      3,
    ),
  )
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }),
  )
  points.raycast = () => {}
  points.frustumCulled = false
  return points
}
