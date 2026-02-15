import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import RAPIER from '@dimforge/rapier3d-compat'
import { Terrain } from './Terrain'
import { Pheromones } from './Pheromones'
import { Ants } from './Ants'
import { Obstacles } from './Obstacles'
import { defaultPheromoneConfig } from './PheromoneConfig'

async function init() {
  // Initialize Rapier
  await RAPIER.init()
  const world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 })

  // Scene setup
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e) // Slightly brighter navy
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.01)

  // Camera setup
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.set(20, 30, 40)

  // Renderer setup
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  document.body.appendChild(renderer.domElement)

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI / 2.1 // Prevent looking under floor

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5)
  directionalLight.position.set(40, 60, 40)
  directionalLight.castShadow = true
  directionalLight.shadow.mapSize.width = 2048
  directionalLight.shadow.mapSize.height = 2048
  directionalLight.shadow.camera.left = -60
  directionalLight.shadow.camera.right = 60
  directionalLight.shadow.camera.top = 60
  directionalLight.shadow.camera.bottom = -60
  scene.add(directionalLight)

  // Secondary point lights for better visibility in valleys
  const homeLight = new THREE.PointLight(0x0088ff, 40, 35)
  scene.add(homeLight)

  const foodLight = new THREE.PointLight(0xffaa00, 80, 50)
  foodLight.position.set(0, 15, 0)
  scene.add(foodLight)

  // System Setup
  const pheromoneConfig = { ...defaultPheromoneConfig }
  const pheromones = new Pheromones(renderer, pheromoneConfig, 1024)
  const terrain = new Terrain(100, 256)

  // Apply pheromone texture to terrain material
  const terrainMaterial = terrain.mesh.material as THREE.MeshStandardMaterial
  terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.tPheromones = { value: pheromones.texture }

    // Inject custom varying to dodge standard UV logic
    shader.vertexShader = `varying vec2 vPheromoneUv;\n` + shader.vertexShader;
    shader.fragmentShader = `uniform sampler2D tPheromones;\nvarying vec2 vPheromoneUv;\n` + shader.fragmentShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      '#include <uv_vertex>\nvPheromoneUv = uv;'
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      #include <map_fragment>
      vec4 pData = texture2D(tPheromones, vPheromoneUv);
      // r = food (red), b = home (blue)
      vec3 foodGlow = vec3(1.0, 0.4, 0.0) * pData.r;
      vec3 homeGlow = vec3(0.0, 0.6, 1.0) * pData.b;
      
      diffuseColor.rgb += (foodGlow * 0.8 + homeGlow * 0.4);

      // Grid lines logic
      vec2 gridUv = vPheromoneUv * 50.0;
      vec2 gridLines = abs(fract(gridUv - 0.5) - 0.5) / (fwidth(gridUv) + 0.001);
      float gridStrength = 1.0 - smoothstep(0.0, 1.5, min(gridLines.x, gridLines.y));
      vec3 gridLineColor = vec3(1.0) * 0.5; // Bright white/grey
      diffuseColor.rgb += gridLineColor * gridStrength;

      // Ensure we don't go pitch black
      diffuseColor.rgb += 0.02; 
      `
    )
  }

  // Force UVs even without a map
  terrain.mesh.geometry.attributes.uv.needsUpdate = true

  scene.add(terrain.mesh)
  terrain.createPhysicsCollider(world)

  // Overlap-free placement: home, foods, obstacles must not overlap
  const entities: { pos: THREE.Vector3; rad: number }[] = []
  function findSafePosition(radius: number): THREE.Vector3 {
    for (let i = 0; i < 200; i++) {
      const pos = new THREE.Vector3((Math.random() - 0.5) * 85, 0, (Math.random() - 0.5) * 85)
      if (!entities.some(e => new THREE.Vector2(pos.x, pos.z).distanceTo(new THREE.Vector2(e.pos.x, e.pos.z)) < radius + e.rad + 3)) {
        entities.push({ pos, rad: radius })
        return pos
      }
    }
    return new THREE.Vector3((Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80)
  }

  // 1. Home (smaller)
  const homePos = findSafePosition(2)
  const homeMarker = new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.35, 16, 32),
    new THREE.MeshStandardMaterial({ color: 0x0088ff, emissive: 0x0044ff })
  )
  homeMarker.rotation.x = Math.PI / 2
  homeMarker.position.set(homePos.x, terrain.getHeight(homePos.x, homePos.z) + 0.1, homePos.z)
  scene.add(homeMarker)
  homeLight.position.set(homePos.x, 10, homePos.z)

  // 2. Foods (5, smaller, orange, depletable)
  const foodPositions: THREE.Vector3[] = []
  const foodMeshes: THREE.Mesh[] = []
  const foodQuantities: number[] = []
  const foodMat = new THREE.MeshStandardMaterial({ color: 0xff8800, emissive: 0xff4400 })
  for (let j = 0; j < 5; j++) {
    const fp = findSafePosition(1.8)
    foodPositions.push(fp)
    foodQuantities.push(100)
    const foodMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 16, 16),
      foodMat
    )
    foodMesh.position.set(fp.x, terrain.getHeight(fp.x, fp.z) + 0.9, fp.z)
    scene.add(foodMesh)
    foodMeshes.push(foodMesh)
  }

  // 3. Obstacles (consume entities list for placement)
  const obstacles = new Obstacles(scene, camera, renderer.domElement, world, controls, terrain, entities)

  const ants = new Ants(500, terrain, pheromones, obstacles, foodPositions, homePos, (foodIdx) => {
    if (foodQuantities[foodIdx] > 0) foodQuantities[foodIdx]--
  }, foodQuantities)
  scene.add(ants.mesh)

  // Clock
  const clock = new THREE.Clock()

  // UI
  const guiDiv = document.createElement('div')
  guiDiv.id = 'gui'
  guiDiv.innerHTML = `
    <h1>Ant Colony 3D</h1>
    <div class="stat">Ants: 500</div>
    <div id="status" class="stat">Status: Simulating...</div>
    <div class="params-panel">
      <h3>Pheromone params</h3>
      <label>Deposit (search): <input type="number" id="depositSearch" min="1" max="15" step="0.5" value="${pheromoneConfig.depositRateSearch}"></label>
      <label>Deposit (return): <input type="number" id="depositReturn" min="2" max="25" step="0.5" value="${pheromoneConfig.depositRateReturn}"></label>
      <label>Evaporation: <input type="number" id="evaporation" min="0.001" max="0.1" step="0.005" value="${pheromoneConfig.evaporationRate}"></label>
      <label>Diffusion: <input type="number" id="diffusion" min="0.01" max="0.2" step="0.01" value="${pheromoneConfig.diffusionStrength}"></label>
      <label>Sensing radius: <input type="number" id="sensing" min="5" max="25" step="1" value="${pheromoneConfig.sensingRadius}"></label>
      <label>Antennae noise: <input type="number" id="antennaeNoise" min="0" max="0.8" step="0.05" value="${pheromoneConfig.antennaeNoise}"></label>
      <label>Min trail strength: <input type="number" id="minTrailStrength" min="0.1" max="1" step="0.05" value="${pheromoneConfig.minTrailStrength}"></label>
    </div>
  `
  document.body.appendChild(guiDiv)

  ;['depositSearch', 'depositReturn', 'evaporation', 'diffusion', 'sensing', 'antennaeNoise', 'minTrailStrength'].forEach((id) => {
    const el = document.getElementById(id) as HTMLInputElement
    if (el) el.addEventListener('input', () => {
      pheromoneConfig.depositRateSearch = parseFloat((document.getElementById('depositSearch') as HTMLInputElement).value)
      pheromoneConfig.depositRateReturn = parseFloat((document.getElementById('depositReturn') as HTMLInputElement).value)
      pheromoneConfig.evaporationRate = parseFloat((document.getElementById('evaporation') as HTMLInputElement).value)
      pheromoneConfig.diffusionStrength = parseFloat((document.getElementById('diffusion') as HTMLInputElement).value)
      pheromoneConfig.sensingRadius = parseFloat((document.getElementById('sensing') as HTMLInputElement).value)
      pheromoneConfig.antennaeNoise = parseFloat((document.getElementById('antennaeNoise') as HTMLInputElement).value)
      pheromoneConfig.minTrailStrength = parseFloat((document.getElementById('minTrailStrength') as HTMLInputElement).value)
      pheromones.setConfig(pheromoneConfig)
    })
  })

  function animate() {
    requestAnimationFrame(animate)
    const dt = Math.min(clock.getDelta(), 0.1)

    pheromones.update()
    ants.update(dt)
    obstacles.update()
    world.step()

    for (let i = 0; i < foodQuantities.length; i++) {
      const q = foodQuantities[i]
      foodMeshes[i].scale.setScalar(Math.max(0.15, q / 100))
      if (q <= 0) {
        const oldX = foodPositions[i].x
        const oldZ = foodPositions[i].z
        const idx = entities.findIndex(e => e.pos.x === oldX && e.pos.z === oldZ)
        if (idx >= 0) entities.splice(idx, 1)
        const np = findSafePosition(1.8)
        foodPositions[i].set(np.x, 0, np.z)
        foodMeshes[i].position.set(np.x, terrain.getHeight(np.x, np.z) + 0.9, np.z)
        foodQuantities[i] = 100
      }
    }

    controls.update()
    renderer.render(scene, camera)
  }

  animate()

  // Handle resize
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })
}

init()
