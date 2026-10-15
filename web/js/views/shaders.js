// The shaders Orbit and Multiverse share: a thin iridescent skin that glows at
// its edges (a universe's bubble, the star's rim), the wormhole tube between
// two agents, and the soft round stars. Plain GLSL strings for three.js's
// ShaderMaterial, so this module imports nothing.

/** A skin that glows where it turns away from the camera, with a slow shimmer and an optional ripple. */
export const MEMBRANE = {
  vertexShader: `
    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vLocal;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      vLocal = normalize(position);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uTint;
    uniform float uTime;
    uniform float uHover;
    uniform float uLevel;
    uniform float uRippleAt;
    uniform vec3 uRippleDir;
    varying vec3 vNormal;
    varying vec3 vView;
    varying vec3 vLocal;
    void main() {
      float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.6);
      vec3 shimmer = 0.5 + 0.5 * cos(6.2832 * (rim * 0.9 + uTime * 0.03 + vLocal.y * 0.25 + vec3(0.0, 0.33, 0.67)));
      vec3 color = mix(uTint, shimmer, 0.38);
      float age = uTime - uRippleAt;
      float ring = 0.0;
      if (age > 0.0 && age < 2.2) {
        float d = distance(vLocal, uRippleDir);
        ring = exp(-pow((d - age * 1.1) * 9.0, 2.0)) * (1.0 - age / 2.2);
      }
      float a = (rim * 0.85 + 0.035) * uLevel * (1.0 + uHover * 0.9) + ring * 1.4;
      gl_FragColor = vec4(color * a, a);
    }`,
}

/** Uniforms for MEMBRANE; `time` is shared so every skin shimmers together. */
export const membraneUniforms = (THREE, tint, time) => ({
  uTime: time,
  uTint: { value: new THREE.Color(tint) },
  uHover: { value: 0 },
  uLevel: { value: 1 },
  uRippleAt: { value: -10 },
  uRippleDir: { value: new THREE.Vector3(0, 1, 0) },
})

/** A tube coloured from one agent's tint to the other's, with bands flowing along it; `uv.x` runs along its length. */
export const WORMHOLE = {
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vUv = uv;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uFrom;
    uniform vec3 uTo;
    uniform float uTime;
    uniform float uLit;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.6);
      float flow = fract(vUv.x * 7.0 - uTime * 0.35);
      float band = smoothstep(0.0, 0.15, flow) * smoothstep(1.0, 0.45, flow);
      float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
      float a = (0.12 + band * 0.38 + rim * 0.35) * (0.75 + uLit * 1.2) * ends;
      gl_FragColor = vec4(mix(uFrom, uTo, vUv.x) * a, a);
    }`,
}

export const wormholeUniforms = (THREE, from, to, time) => ({
  uTime: time,
  uFrom: { value: new THREE.Color(from) },
  uTo: { value: new THREE.Color(to) },
  uLit: { value: 0 },
})

/** Round, soft points sized in world units; `aFlare` (0–1) brightens and grows one. */
export const STARS = {
  vertexShader: `
    attribute float aSize;
    attribute float aFlare;
    attribute vec3 color;
    uniform float uScale;
    uniform float uDim;
    varying vec3 vColor;
    varying float vFlare;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vColor = color;
      vFlare = aFlare;
      gl_PointSize = min(72.0, aSize * (1.0 + aFlare * 3.0) * uScale / -mv.z);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uDim;
    varying vec3 vColor;
    varying float vFlare;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d);
      float core = smoothstep(0.18, 0.0, d);
      vec3 c = mix(vColor, vec3(1.0), core * 0.55 + vFlare * 0.6);
      float level = mix(uDim, 1.0, clamp(vFlare * 2.0, 0.0, 1.0));
      gl_FragColor = vec4(c * a * (1.0 + vFlare * 2.2) * level, a * level);
    }`,
}

/** Settings every glowing material uses: drawn added onto what is behind, never hiding it. */
export const glowing = THREE => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
