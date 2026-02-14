import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import RAPIER from '@dimforge/rapier3d-compat'
import { Terrain } from './Terrain'
import { Pheromones } from './Pheromones'
import { Ants } from './Ants'
import { Obstacles } from './Obstacles'

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
  const homeLight = new THREE.PointLight(0x0088ff, 50, 40)
  homeLight.position.set(0, 10, 0)
  scene.add(homeLight)

  const foodLight = new THREE.PointLight(0xffaa00, 100, 60)
  foodLight.position.set(30, 15, 35)
  scene.add(foodLight)

  // System Setup
  const pheromones = new Pheromones(renderer, 512)
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

  // Obstacles
  const obstacles = new Obstacles(scene, camera, renderer.domElement, world, controls, terrain)

  // Markers for Home and Food
  const homeMarker = new THREE.Mesh(
    new THREE.TorusGeometry(3, 0.5, 16, 32),
    new THREE.MeshStandardMaterial({ color: 0x0088ff, emissive: 0x0044ff })
  )
  homeMarker.rotation.x = Math.PI / 2
  homeMarker.position.y = terrain.getHeight(0, 0) + 0.1
  scene.add(homeMarker)

  const foodMarker = new THREE.Mesh(
    new THREE.SphereGeometry(3, 32, 32),
    new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff5500 })
  )
  foodMarker.position.set(30, terrain.getHeight(30, 35) + 3, 35)
  scene.add(foodMarker)

  // Ants
  const ants = new Ants(100, terrain, pheromones, obstacles)
  scene.add(ants.mesh)

  // Clock
  const clock = new THREE.Clock()

  // UI
  const guiDiv = document.createElement('div')
  guiDiv.id = 'gui'
  guiDiv.innerHTML = `
    <h1>Ant Colony 3D</h1>
    <div class="stat">Ants: 100</div>
    <div id="status" class="stat">Status: Simulating...</div>
  `
  document.body.appendChild(guiDiv)

  // Animation loop
  function animate() {
    requestAnimationFrame(animate)
    const dt = Math.min(clock.getDelta(), 0.1)

    // Update Systems
    pheromones.update()
    ants.update(dt)
    obstacles.update()
    world.step()

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
