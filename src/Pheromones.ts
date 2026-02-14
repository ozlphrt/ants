import * as THREE from 'three'
import type { PheromoneConfig } from './PheromoneConfig'

export class Pheromones {
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  renderer: THREE.WebGLRenderer
  config: PheromoneConfig

  renderTargetA: THREE.WebGLRenderTarget
  renderTargetB: THREE.WebGLRenderTarget
  cpuSize: number
  cpuGrid: Float32Array
  cpuGridNext: Float32Array
  diffusionMaterial: THREE.ShaderMaterial
  quad: THREE.Mesh

  constructor(
    renderer: THREE.WebGLRenderer,
    config: PheromoneConfig,
    size: number = 512
  ) {
    this.renderer = renderer
    this.config = config
    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const params = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
    }

    this.renderTargetA = new THREE.WebGLRenderTarget(size, size, params)
    this.renderTargetB = new THREE.WebGLRenderTarget(size, size, params)

    this.cpuSize = 256
    this.cpuGrid = new Float32Array(this.cpuSize * this.cpuSize * 4)
    this.cpuGridNext = new Float32Array(this.cpuSize * this.cpuSize * 4)

    this.diffusionMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tPheromones: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / size, 1 / size) },
        uEvaporation: { value: 1 - config.evaporationRate },
        uDiffusion: { value: config.diffusionStrength },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tPheromones;
        uniform vec2 uTexelSize;
        uniform float uEvaporation;
        uniform float uDiffusion;

        void main() {
          vec4 center = texture2D(tPheromones, vUv);
          vec4 sum =
            texture2D(tPheromones, vUv + vec2(uTexelSize.x, 0.0)) +
            texture2D(tPheromones, vUv + vec2(-uTexelSize.x, 0.0)) +
            texture2D(tPheromones, vUv + vec2(0.0, uTexelSize.y)) +
            texture2D(tPheromones, vUv + vec2(0.0, -uTexelSize.y));
          vec4 diffused = mix(center, sum * 0.25, uDiffusion);
          gl_FragColor = diffused * uEvaporation;
          if(gl_FragColor.r < 0.001) gl_FragColor.r = 0.0;
          if(gl_FragColor.g < 0.001) gl_FragColor.g = 0.0;
          if(gl_FragColor.b < 0.001) gl_FragColor.b = 0.0;
          gl_FragColor.a = 1.0;
        }
      `,
    })

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.diffusionMaterial)
    this.scene.add(this.quad)
  }

  setConfig(config: Partial<PheromoneConfig>) {
    this.config = { ...this.config, ...config }
    this.diffusionMaterial.uniforms.uEvaporation.value = 1 - this.config.evaporationRate
    this.diffusionMaterial.uniforms.uDiffusion.value = this.config.diffusionStrength
  }

  update() {
    const s = this.cpuSize
    const evap = 1 - this.config.evaporationRate
    const diff = this.config.diffusionStrength

    for (let row = 0; row < s; row++) {
      for (let col = 0; col < s; col++) {
        const i = (row * s + col) * 4
        const r =
          (this.cpuGrid[i] ?? 0) * (1 - diff) +
          ((row > 0 ? this.cpuGrid[((row - 1) * s + col) * 4] : this.cpuGrid[i]) +
            (row < s - 1 ? this.cpuGrid[((row + 1) * s + col) * 4] : this.cpuGrid[i]) +
            (col > 0 ? this.cpuGrid[(row * s + (col - 1)) * 4] : this.cpuGrid[i]) +
            (col < s - 1 ? this.cpuGrid[(row * s + (col + 1)) * 4] : this.cpuGrid[i])) *
            0.25 *
            diff
        const b =
          (this.cpuGrid[i + 2] ?? 0) * (1 - diff) +
          ((row > 0 ? this.cpuGrid[((row - 1) * s + col) * 4 + 2] : this.cpuGrid[i + 2]) +
            (row < s - 1 ? this.cpuGrid[((row + 1) * s + col) * 4 + 2] : this.cpuGrid[i + 2]) +
            (col > 0 ? this.cpuGrid[(row * s + (col - 1)) * 4 + 2] : this.cpuGrid[i + 2]) +
            (col < s - 1 ? this.cpuGrid[(row * s + (col + 1)) * 4 + 2] : this.cpuGrid[i + 2])) *
            0.25 *
            diff
        this.cpuGridNext[i] = Math.max(0, r * evap)
        this.cpuGridNext[i + 1] = this.cpuGrid[i + 1] ?? 0
        this.cpuGridNext[i + 2] = Math.max(0, b * evap)
        this.cpuGridNext[i + 3] = 1
      }
    }
    const tmp = this.cpuGrid
    this.cpuGrid = this.cpuGridNext
    this.cpuGridNext = tmp

    const temp = this.renderTargetA
    this.renderTargetA = this.renderTargetB
    this.renderTargetB = temp
    this.diffusionMaterial.uniforms.tPheromones.value = this.renderTargetB.texture
    this.diffusionMaterial.uniforms.uEvaporation.value = evap
    this.diffusionMaterial.uniforms.uDiffusion.value = diff

    const currentTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.renderTargetA)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(currentTarget)
  }

  private depositPoints: THREE.Points | null = null
  private depositGeometry: THREE.BufferGeometry | null = null

  deposit(
    positions: Float32Array,
    searchAmounts: Float32Array,
    returnAmounts: Float32Array,
    count: number
  ) {
    if (!this.depositPoints) {
      this.depositGeometry = new THREE.BufferGeometry()
      const mat = new THREE.PointsMaterial({
        size: 1,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
      })
      this.depositPoints = new THREE.Points(this.depositGeometry, mat)
      this.scene.add(this.depositPoints)
    }

    const s = this.cpuSize
    const rateSearch = this.config.depositRateSearch
    const rateReturn = this.config.depositRateReturn

    const uvPositions = new Float32Array(count * 3)
    const gpuColors = new Float32Array(count * 3)

    const spreadRadius = 1
    const spreadFactor = 0.3
    const clampMax = 1000

    for (let i = 0; i < count; i++) {
      const x = positions[i * 3 + 0]
      const z = positions[i * 3 + 2]
      uvPositions[i * 3 + 0] = x / 50
      uvPositions[i * 3 + 1] = -z / 50
      uvPositions[i * 3 + 2] = 0

      const search = searchAmounts[i] ?? 0
      const ret = returnAmounts[i] ?? 0
      const amtSearch = search * rateSearch
      const amtReturn = ret * rateReturn
      gpuColors[i * 3 + 0] = amtReturn
      gpuColors[i * 3 + 1] = 0
      gpuColors[i * 3 + 2] = amtSearch

      const u = Math.max(0, Math.min(1, (x + 50) / 100))
      const v = Math.max(0, Math.min(1, (50 - z) / 100))
      const col = Math.floor(u * (s - 1e-6))
      const row = Math.floor(v * (s - 1e-6))

      const idx0 = (row * s + col) * 4
      this.cpuGrid[idx0] = Math.min(clampMax, (this.cpuGrid[idx0] ?? 0) + amtReturn)
      this.cpuGrid[idx0 + 2] = Math.min(clampMax, (this.cpuGrid[idx0 + 2] ?? 0) + amtSearch)

      for (let dc = -spreadRadius; dc <= spreadRadius; dc++) {
        for (let dr = -spreadRadius; dr <= spreadRadius; dr++) {
          const dist = Math.sqrt(dc * dc + dr * dr)
          if (dist > 0 && dist <= spreadRadius) {
            const nc = col + dc
            const nr = row + dr
            if (nc >= 0 && nc < s && nr >= 0 && nr < s) {
              const spreadAmt = spreadFactor * (1 - dist / spreadRadius)
              const idx = (nr * s + nc) * 4
              this.cpuGrid[idx] = Math.min(clampMax, (this.cpuGrid[idx] ?? 0) + amtReturn * spreadAmt)
              this.cpuGrid[idx + 2] = Math.min(clampMax, (this.cpuGrid[idx + 2] ?? 0) + amtSearch * spreadAmt)
            }
          }
        }
      }
    }

    this.depositGeometry!.setAttribute('position', new THREE.BufferAttribute(uvPositions, 3))
    this.depositGeometry!.setAttribute('color', new THREE.BufferAttribute(gpuColors, 3))

    const currentTarget = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.renderTargetA)
    this.renderer.render(this.scene, this.camera)
    this.renderer.setRenderTarget(currentTarget)

    this.depositGeometry!.deleteAttribute('position')
    this.depositGeometry!.deleteAttribute('color')
  }

  /** Sample pheromone at position. Channel: 'food' (return trail) or 'home' (exploration trail). */
  sample(x: number, z: number, channel: 'food' | 'home'): number {
    return this.sampleAt(x, z, 0, 0, channel)
  }

  /** Antennae-style forward cone detection (vibeants). Returns direction + strength or null. */
  getAntennaePheromoneDirection(
    x: number,
    z: number,
    channel: 'food' | 'home',
    velX: number,
    velZ: number
  ): { gx: number; gz: number; strength: number } | null {
    const detectionRange = this.config.sensingRadius * 6
    const noiseLevel = this.config.antennaeNoise
    const currentAngle = Math.atan2(velZ, velX) || 0

    const samples: { gx: number; gz: number; strength: number }[] = []
    for (let angle = -Math.PI / 3; angle <= Math.PI / 3; angle += Math.PI / 12) {
      const sampleAngle = currentAngle + angle
      let sx = x + Math.cos(sampleAngle) * detectionRange
      let sz = z + Math.sin(sampleAngle) * detectionRange
      sx += (Math.random() - 0.5) * noiseLevel * detectionRange
      sz += (Math.random() - 0.5) * noiseLevel * detectionRange

      const strength = this.sample(sx, sz, channel)
      const dist = Math.hypot(sx - x, sz - z)
      const falloff = Math.max(0, 1 - dist / detectionRange)
      const adjustedStrength = strength * falloff
      samples.push({ gx: sx - x, gz: sz - z, strength: adjustedStrength })
    }

    let best = samples[0]
    for (const s of samples) {
      if (s.strength > best.strength) best = s
    }
    if (best.strength < this.config.minTrailStrength) return null

    const mag = Math.hypot(best.gx, best.gz) || 0.001
    const gx = best.gx / mag
    const gz = best.gz / mag
    const noise = (Math.random() - 0.5) * noiseLevel
    const ca = Math.cos(noise)
    const sa = Math.sin(noise)
    return {
      gx: gx * ca - gz * sa,
      gz: gx * sa + gz * ca,
      strength: best.strength,
    }
  }

  /** 8-directional gradient toward higher pheromone. Returns { gx, gz } normalized, or null if no signal. */
  gradient(x: number, z: number, channel: 'food' | 'home'): { gx: number; gz: number } | null {
    const delta = this.config.sensingRadius * 0.6
    const right = this.sampleAt(x, z, delta, 0, channel)
    const left = this.sampleAt(x, z, -delta, 0, channel)
    const down = this.sampleAt(x, z, 0, delta, channel)
    const up = this.sampleAt(x, z, 0, -delta, channel)
    const ur = this.sampleAt(x, z, delta * 0.7, -delta * 0.7, channel)
    const ul = this.sampleAt(x, z, -delta * 0.7, -delta * 0.7, channel)
    const dr = this.sampleAt(x, z, delta * 0.7, delta * 0.7, channel)
    const dl = this.sampleAt(x, z, -delta * 0.7, delta * 0.7, channel)
    const gx = (right - left) * 0.5 + (ur - ul + dr - dl) * 0.25
    const gz = (down - up) * 0.5 + (dr - ur + dl - ul) * 0.25
    const mag = Math.hypot(gx, gz)
    if (mag < 0.08) return null
    return { gx: gx / mag, gz: gz / mag }
  }

  /** Sample pheromone at offset from position. Channel: 'food' (return trail) or 'home' (exploration trail). */
  sampleAt(x: number, z: number, dx: number, dz: number, channel: 'food' | 'home'): number {
    const s = this.cpuSize
    const u = Math.max(0, Math.min(1, ((x + dx) + 50) / 100))
    const v = Math.max(0, Math.min(1, (50 - (z + dz)) / 100))
    const col = Math.floor(u * (s - 1e-6))
    const row = Math.floor(v * (s - 1e-6))
    const idx = (row * s + col) * 4
    return (channel === 'food' ? this.cpuGrid[idx] : this.cpuGrid[idx + 2]) ?? 0
  }

  get texture() {
    return this.renderTargetA.texture
  }
}
