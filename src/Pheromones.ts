import * as THREE from 'three'

export class Pheromones {
    scene: THREE.Scene
    camera: THREE.OrthographicCamera
    renderer: THREE.WebGLRenderer

    // Two render targets for double buffering (diffusion/evaporation)
    renderTargetA: THREE.WebGLRenderTarget
    renderTargetB: THREE.WebGLRenderTarget

    // Custom material for diffusion and evaporation
    diffusionMaterial: THREE.ShaderMaterial

    // Quad for rendering
    quad: THREE.Mesh

    constructor(renderer: THREE.WebGLRenderer, size: number = 512) {
        this.renderer = renderer
        this.scene = new THREE.Scene()
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

        const params = {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.FloatType
        }

        this.renderTargetA = new THREE.WebGLRenderTarget(size, size, params)
        this.renderTargetB = new THREE.WebGLRenderTarget(size, size, params)

        this.diffusionMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tPheromones: { value: null },
                uTexelSize: { value: new THREE.Vector2(1 / size, 1 / size) },
                uEvaporation: { value: 0.995 },
                uDiffusion: { value: 0.1 }
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
          
          // Simple 4-tap Laplace for diffusion
          vec4 sum = 
            texture2D(tPheromones, vUv + vec2(uTexelSize.x, 0.0)) +
            texture2D(tPheromones, vUv + vec2(-uTexelSize.x, 0.0)) +
            texture2D(tPheromones, vUv + vec2(0.0, uTexelSize.y)) +
            texture2D(tPheromones, vUv + vec2(0.0, -uTexelSize.y));
          
          vec4 diffused = mix(center, sum * 0.25, uDiffusion);
          gl_FragColor = diffused * uEvaporation;
          
          // Clamp to zero
          if(gl_FragColor.r < 0.001) gl_FragColor.r = 0.0;
          if(gl_FragColor.g < 0.001) gl_FragColor.g = 0.0;
          if(gl_FragColor.b < 0.001) gl_FragColor.b = 0.0;
          gl_FragColor.a = 1.0;
        }
      `
        })

        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.diffusionMaterial)
        this.scene.add(this.quad)
    }

    update() {
        // Swap targets
        const temp = this.renderTargetA
        this.renderTargetA = this.renderTargetB
        this.renderTargetB = temp

        this.diffusionMaterial.uniforms.tPheromones.value = this.renderTargetB.texture

        const currentTarget = this.renderer.getRenderTarget()
        this.renderer.setRenderTarget(this.renderTargetA)
        this.renderer.render(this.scene, this.camera)
        this.renderer.setRenderTarget(currentTarget)
    }

    // Points for depositing pheromones
    private depositPoints: THREE.Points | null = null
    private depositGeometry: THREE.BufferGeometry | null = null

    deposit(positions: Float32Array, colors: Float32Array, count: number) {
        if (!this.depositPoints) {
            this.depositGeometry = new THREE.BufferGeometry()
            const mat = new THREE.PointsMaterial({
                size: 1,
                sizeAttenuation: false,
                vertexColors: true,
                transparent: true,
                blending: THREE.AdditiveBlending
            })
            this.depositPoints = new THREE.Points(this.depositGeometry, mat)
            this.scene.add(this.depositPoints)
        }

        // Convert world space XZ to UV space [-1, 1] for the ortho camera
        const uvPositions = new Float32Array(count * 3)
        for (let i = 0; i < count; i++) {
            // World -50 to 50 -> Ortho -1 to 1
            uvPositions[i * 3 + 0] = positions[i * 3 + 0] / 50
            // World -50 to 50 -> Ortho 1 to -1 (Inverted for V alignment)
            uvPositions[i * 3 + 1] = -positions[i * 3 + 2] / 50
            uvPositions[i * 3 + 2] = 0
        }

        this.depositGeometry!.setAttribute('position', new THREE.BufferAttribute(uvPositions, 3))
        this.depositGeometry!.setAttribute('color', new THREE.BufferAttribute(colors, 3))

        const currentTarget = this.renderer.getRenderTarget()
        this.renderer.setRenderTarget(this.renderTargetA)
        this.renderer.render(this.scene, this.camera)
        this.renderer.setRenderTarget(currentTarget)

        // Clear for next frame
        this.depositGeometry!.deleteAttribute('position')
        this.depositGeometry!.deleteAttribute('color')
    }

    get texture() {
        return this.renderTargetA.texture
    }
}
