import * as THREE from 'three'
import { Pheromones } from './Pheromones'
import { Terrain } from './Terrain'
import { Obstacles } from './Obstacles'

export enum AntState {
    EXPLORING,
    RETURNING
}

export class Ants {
    count: number
    mesh: THREE.InstancedMesh
    dummy = new THREE.Object3D()

    positions: Float32Array
    velocities: Float32Array
    states: Uint8Array
    terrain: Terrain
    pheromones: Pheromones
    obstacles: Obstacles
    foodPositions: THREE.Vector3[]
    homePosition: THREE.Vector3

    constructor(count: number, terrain: Terrain, pheromones: Pheromones, obstacles: Obstacles, foodPositions: THREE.Vector3[], homePosition: THREE.Vector3) {
        this.count = count
        this.terrain = terrain
        this.pheromones = pheromones
        this.obstacles = obstacles
        this.foodPositions = foodPositions
        this.homePosition = homePosition
        // ... rest of constructor ... (keep arrays and mesh init)

        this.positions = new Float32Array(count * 3)
        this.velocities = new Float32Array(count * 3)
        this.states = new Uint8Array(count)

        const geometry = new THREE.ConeGeometry(0.1, 0.4, 4)
        geometry.rotateX(Math.PI / 2) // Points forward along Z

        const material = new THREE.MeshStandardMaterial({ color: 0xffffff })
        this.mesh = new THREE.InstancedMesh(geometry, material, count)
        this.mesh.castShadow = true

        for (let i = 0; i < count; i++) {
            this.positions[i * 3 + 0] = this.homePosition.x + (Math.random() - 0.5) * 4
            this.positions[i * 3 + 1] = 0
            this.positions[i * 3 + 2] = this.homePosition.z + (Math.random() - 0.5) * 4

            const angle = Math.random() * Math.PI * 2
            const slowInit = 0.04
            this.velocities[i * 3 + 0] = Math.cos(angle) * slowInit
            this.velocities[i * 3 + 1] = 0
            this.velocities[i * 3 + 2] = Math.sin(angle) * slowInit

            this.states[i] = AntState.EXPLORING
        }
    }

    update(dt: number) {
        const depositPositions = new Float32Array(this.count * 3)
        const depositColors = new Float32Array(this.count * 3)

        for (let i = 0; i < this.count; i++) {
            const i3 = i * 3
            const state = this.states[i]

            // 1. Boundaries
            const halfSize = this.terrain.size / 2 - 2
            if (Math.abs(this.positions[i3 + 0]) > halfSize) this.velocities[i3 + 0] *= -1
            if (Math.abs(this.positions[i3 + 2]) > halfSize) this.velocities[i3 + 2] *= -1

            // 2. State Logic (Home <-> Food)
            const dxHome = this.positions[i3 + 0] - this.homePosition.x
            const dzHome = this.positions[i3 + 2] - this.homePosition.z
            const distSqToHome = dxHome * dxHome + dzHome * dzHome
            if (state === AntState.RETURNING && distSqToHome < 9) {
                this.states[i] = AntState.EXPLORING
                this.velocities[i3 + 0] *= -1
                this.velocities[i3 + 2] *= -1
            }

            if (state === AntState.EXPLORING) {
                for (const fp of this.foodPositions) {
                    const dx = this.positions[i3 + 0] - fp.x
                    const dz = this.positions[i3 + 2] - fp.z
                    if (dx * dx + dz * dz < 4) {
                        this.states[i] = AntState.RETURNING
                        this.velocities[i3 + 0] *= -1
                        this.velocities[i3 + 2] *= -1
                        break
                    }
                }
            }

            // 3. Movement
            this.positions[i3 + 0] += this.velocities[i3 + 0]
            this.positions[i3 + 2] += this.velocities[i3 + 2]

            // 3.5 Obstacle Repulsion
            for (let j = 0; j < this.obstacles.objects.length; j++) {
                const rock = this.obstacles.objects[j]
                const dx = this.positions[i3 + 0] - rock.position.x
                const dz = this.positions[i3 + 2] - rock.position.z
                const distSq = dx * dx + dz * dz

                const { w, d } = this.obstacles.dims[j]
                const radius = Math.max(w, d) / 1.5 // Sphere approximation
                const radSq = radius * radius

                if (distSq < radSq) {
                    const dist = Math.sqrt(distSq)
                    const push = (radius - dist) / dist
                    this.positions[i3 + 0] += dx * push
                    this.positions[i3 + 2] += dz * push

                    // Bounce velocity
                    const nx = dx / dist
                    const nz = dz / dist
                    const dot = this.velocities[i3 + 0] * nx + this.velocities[i3 + 2] * nz
                    this.velocities[i3 + 0] -= 2 * dot * nx
                    this.velocities[i3 + 2] -= 2 * dot * nz
                }
            }

            // Terrain Height
            const groundY = this.terrain.getHeight(this.positions[i3 + 0], this.positions[i3 + 2])
            this.positions[i3 + 1] = groundY + 0.1

            // 4. Deposit Pheromones
            depositPositions[i3 + 0] = this.positions[i3 + 0]
            depositPositions[i3 + 1] = this.positions[i3 + 1]
            depositPositions[i3 + 2] = this.positions[i3 + 2]

            if (state === AntState.EXPLORING) {
                // Return-to-home trail: Use Blue channel
                depositColors[i3 + 0] = 0.0
                depositColors[i3 + 1] = 0.0
                depositColors[i3 + 2] = 0.8
            } else {
                // Return-to-food trail: Use Red channel
                depositColors[i3 + 0] = 0.8
                depositColors[i3 + 1] = 0.0
                depositColors[i3 + 2] = 0.0
            }

            // 5. Update Matrix & Orientation
            this.dummy.position.set(this.positions[i3 + 0], this.positions[i3 + 1] + 0.05, this.positions[i3 + 2])

            // Tilt based on normal
            const normal = this.terrain.getNormal(this.positions[i3 + 0], this.positions[i3 + 2])
            this.dummy.up.copy(normal)

            this.dummy.lookAt(
                this.positions[i3 + 0] + this.velocities[i3 + 0],
                this.positions[i3 + 1] + 0.05,
                this.positions[i3 + 2] + this.velocities[i3 + 2]
            )
            this.dummy.updateMatrix()
            this.mesh.setMatrixAt(i, this.dummy.matrix)

            // Random wander
            const wander = 0.03
            this.velocities[i3 + 0] += (Math.random() - 0.5) * wander
            this.velocities[i3 + 2] += (Math.random() - 0.5) * wander

            // Normalize speed (slower)
            const speed = 0.04
            const mag = Math.sqrt(this.velocities[i3 + 0] ** 2 + this.velocities[i3 + 2] ** 2)
            this.velocities[i3 + 0] = (this.velocities[i3 + 0] / mag) * speed
            this.velocities[i3 + 2] = (this.velocities[i3 + 2] / mag) * speed
        }

        this.pheromones.deposit(depositPositions, depositColors, this.count)
        this.mesh.instanceMatrix.needsUpdate = true
    }
}
