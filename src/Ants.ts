import * as THREE from 'three'
import { Pheromones } from './Pheromones'
import { Terrain } from './Terrain'
import { Obstacles } from './Obstacles'

export const AntState = { EXPLORING: 0, RETURNING: 1 } as const
export type AntState = (typeof AntState)[keyof typeof AntState]

export class Ants {
  count: number
  mesh: THREE.InstancedMesh
  dummy = new THREE.Object3D()

  positions: Float32Array
  velocities: Float32Array
  momentum: Float32Array
  states: Uint8Array
  terrain: Terrain
  pheromones: Pheromones
  obstacles: Obstacles
  foodPositions: THREE.Vector3[]
  homePosition: THREE.Vector3
  onFoodCollected?: (foodIndex: number) => void
  foodQuantities?: number[]

  constructor(
    count: number,
    terrain: Terrain,
    pheromones: Pheromones,
    obstacles: Obstacles,
    foodPositions: THREE.Vector3[],
    homePosition: THREE.Vector3,
    onFoodCollected?: (foodIndex: number) => void,
    foodQuantities?: number[]
  ) {
    this.count = count
    this.terrain = terrain
    this.pheromones = pheromones
    this.obstacles = obstacles
    this.foodPositions = foodPositions
    this.homePosition = homePosition
    this.onFoodCollected = onFoodCollected
    this.foodQuantities = foodQuantities

    this.positions = new Float32Array(count * 3)
    this.velocities = new Float32Array(count * 3)
    this.momentum = new Float32Array(count * 2)
    this.states = new Uint8Array(count)

    const geometry = new THREE.ConeGeometry(0.1, 0.4, 4)
    geometry.rotateX(Math.PI / 2)
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff })
    this.mesh = new THREE.InstancedMesh(geometry, material, count)
    this.mesh.castShadow = true

    for (let i = 0; i < count; i++) {
      this.positions[i * 3 + 0] = this.homePosition.x + (Math.random() - 0.5) * 4
      this.positions[i * 3 + 1] = 0
      this.positions[i * 3 + 2] = this.homePosition.z + (Math.random() - 0.5) * 4

      const angleToNest = Math.atan2(
        this.positions[i * 3 + 2] - this.homePosition.z,
        this.positions[i * 3 + 0] - this.homePosition.x
      )
      const angle = angleToNest + (Math.random() - 0.5) * Math.PI
      const initSpeed = 0.05
      this.velocities[i * 3 + 0] = Math.cos(angle) * initSpeed
      this.velocities[i * 3 + 1] = 0
      this.velocities[i * 3 + 2] = Math.sin(angle) * initSpeed

      this.momentum[i * 2 + 0] = this.velocities[i * 3 + 0]
      this.momentum[i * 2 + 1] = this.velocities[i * 3 + 2]
      this.states[i] = AntState.EXPLORING
    }
  }

  update(dt: number) {
    const cfg = this.pheromones.config
    const depositPositions = new Float32Array(this.count * 3)
    const searchAmounts = new Float32Array(this.count)
    const returnAmounts = new Float32Array(this.count)

    const targetSpeedReturn = 0.042
    const targetSpeedExplore = 0.05
    const maxTurnReturn = 0.3
    const maxTurnExplore = 0.4
    const dtScale = Math.min(dt * 60, 2)
    const halfSize = this.terrain.size / 2 - 2
    const gridSize = 2
    const foodVisualRange = 33
    const nestCloseRange = 17

    const grid = new Map<string, number[]>()
    for (let i = 0; i < this.count; i++) {
      const gx = Math.floor(this.positions[i * 3 + 0] / gridSize)
      const gz = Math.floor(this.positions[i * 3 + 2] / gridSize)
      const key = `${gx},${gz}`
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key)!.push(i)
    }

    const rand = () => {
      const a = Math.random() * Math.PI * 2
      return new THREE.Vector2(Math.cos(a), Math.sin(a))
    }

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3
      const i2 = i * 2
      const state = this.states[i]
      const px = this.positions[i3 + 0]
      const pz = this.positions[i3 + 2]
      let dirX = 0
      let dirZ = 0

      // 1. Boundaries
      if (Math.abs(px) > halfSize) this.velocities[i3 + 0] *= -1
      if (Math.abs(pz) > halfSize) this.velocities[i3 + 2] *= -1

      // 2. State transitions
      const distToHome = Math.hypot(px - this.homePosition.x, pz - this.homePosition.z)
      if (state === AntState.RETURNING && distToHome < 0.4) {
        this.states[i] = AntState.EXPLORING
      }
      if (state === AntState.EXPLORING) {
        for (let fi = 0; fi < this.foodPositions.length; fi++) {
          if (this.foodQuantities && this.foodQuantities[fi] <= 0) continue
          const fp = this.foodPositions[fi]
          const d = Math.hypot(px - fp.x, pz - fp.z)
          if (d < 0.4) {
            this.states[i] = AntState.RETURNING
            this.onFoodCollected?.(fi)
            break
          }
        }
      }

      // 3. Desired direction (vibeants: antennae + direct + random)
      const vx = this.velocities[i3 + 0]
      const vz = this.velocities[i3 + 2]

      if (state === AntState.RETURNING) {
        const directToNestX = (this.homePosition.x - px) / (distToHome || 0.001)
        const directToNestZ = (this.homePosition.z - pz) / (distToHome || 0.001)
        if (distToHome < nestCloseRange) {
          const directBias = Math.min(0.8, (nestCloseRange - distToHome) / nestCloseRange)
          const r = rand()
          dirX = directToNestX * directBias + r.x * (1 - directBias)
          dirZ = directToNestZ * directBias + r.y * (1 - directBias)
        } else {
          const antennae = this.pheromones.getAntennaePheromoneDirection(px, pz, 'home', vx, vz)
          if (antennae && antennae.strength > 0.5) {
            const att = Math.min(2, antennae.strength)
            dirX = antennae.gx * att + directToNestX * 0.5
            dirZ = antennae.gz * att + directToNestZ * 0.5
          } else {
            const r = rand()
            dirX = directToNestX * 0.7 + r.x * 0.3
            dirZ = directToNestZ * 0.7 + r.y * 0.3
          }
        }
        this.momentum[i2] *= 0.3
        this.momentum[i2 + 1] *= 0.3
      } else {
        let nearestFood: THREE.Vector3 | null = null
        let nearestDist = Infinity
        for (let fi = 0; fi < this.foodPositions.length; fi++) {
          if (this.foodQuantities && this.foodQuantities[fi] <= 0) continue
          const fp = this.foodPositions[fi]
          const d = Math.hypot(px - fp.x, pz - fp.z)
          if (d < foodVisualRange && d < nearestDist) {
            nearestDist = d
            nearestFood = fp
          }
        }
        if (nearestFood) {
          const directX = (nearestFood.x - px) / nearestDist
          const directZ = (nearestFood.z - pz) / nearestDist
          const directBias = Math.min(0.8, (foodVisualRange - nearestDist) / foodVisualRange)
          const r = rand()
          dirX = directX * directBias + r.x * (1 - directBias)
          dirZ = directZ * directBias + r.y * (1 - directBias)
          if (nearestDist < 5) {
            dirX *= 1.2
            dirZ *= 1.2
          }
        } else {
          const antennae = this.pheromones.getAntennaePheromoneDirection(px, pz, 'food', vx, vz)
          if (antennae && antennae.strength > 0.5) {
            const att = Math.min(3, antennae.strength)
            const r = rand()
            dirX = antennae.gx * att + r.x * 0.3
            dirZ = antennae.gz * att + r.y * 0.3
          } else {
            const r = rand()
            dirX = r.x + this.momentum[i2] * 0.4
            dirZ = r.y + this.momentum[i2 + 1] * 0.4
          }
        }
      }

      // Obstacle avoidance — only steer when very close (ants can approach closely)
      for (let j = 0; j < this.obstacles.objects.length; j++) {
        const rock = this.obstacles.objects[j]
        const w = this.obstacles.dims[j].w
        const d = this.obstacles.dims[j].d
        const rad = Math.sqrt(w * w + d * d) / 2 + 0.08 // Box footprint + ant clearance
        const dx = px - rock.position.x
        const dz = pz - rock.position.z
        const dist = Math.hypot(dx, dz)
        if (dist < rad + 0.25 && dist > 0.001) {
          const avoid = Math.max(0.3, 1.5 / (dist - rad + 0.05))
          dirX += (dx / dist) * avoid * 0.6
          dirZ += (dz / dist) * avoid * 0.6
        }
      }

      const dm = Math.hypot(dirX, dirZ) || 0.001
      dirX /= dm
      dirZ /= dm

      // Momentum blend (vibeants)
      const momStr = state === AntState.RETURNING ? 0.4 : 0.5
      this.momentum[i2] = this.momentum[i2] * 0.7 + dirX * 0.3
      this.momentum[i2 + 1] = this.momentum[i2 + 1] * 0.7 + dirZ * 0.3
      const momMag = Math.hypot(this.momentum[i2], this.momentum[i2 + 1]) || 0.001
      dirX = dirX * (1 - momStr) + (this.momentum[i2] / momMag) * momStr
      dirZ = dirZ * (1 - momStr) + (this.momentum[i2 + 1] / momMag) * momStr
      const dm2 = Math.hypot(dirX, dirZ) || 0.001
      dirX /= dm2
      dirZ /= dm2

      // Turn rate limit
      const currAngle = Math.atan2(vz, vx)
      const targetAngle = Math.atan2(dirZ, dirX)
      let angleDiff = targetAngle - currAngle
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
      const maxTurn = state === AntState.RETURNING ? maxTurnReturn : maxTurnExplore
      const capped = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), maxTurn)
      const newAngle = currAngle + capped
      const spd = state === AntState.RETURNING ? targetSpeedReturn : targetSpeedExplore
      this.velocities[i3 + 0] = Math.cos(newAngle) * spd
      this.velocities[i3 + 2] = Math.sin(newAngle) * spd

      // 4. Ant–ant repulsion — small radius so they can get close (explorers yield to returners)
      const gx = Math.floor(px / gridSize)
      const gz = Math.floor(pz / gridSize)
      const avoidRad = 0.35
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const neighbors = grid.get(`${gx + ox},${gz + oz}`)
          if (!neighbors) continue
          for (const j of neighbors) {
            if (j === i) continue
            const j3 = j * 3
            const dx = px - this.positions[j3 + 0]
            const dz = pz - this.positions[j3 + 2]
            const distSq = dx * dx + dz * dz
            if (distSq < avoidRad * avoidRad && distSq > 0.0001) {
              const dist = Math.sqrt(distSq)
              let f = (avoidRad - dist) / dist * 0.08
              if (state === AntState.EXPLORING && this.states[j] === AntState.RETURNING) f *= 2
              else if (state === AntState.RETURNING && this.states[j] === AntState.EXPLORING) f *= 0.5
              this.velocities[i3 + 0] += (dx / dist) * f
              this.velocities[i3 + 2] += (dz / dist) * f
            }
          }
        }
      }
      const vm = Math.hypot(this.velocities[i3 + 0], this.velocities[i3 + 2]) || 0.001
      this.velocities[i3 + 0] = (this.velocities[i3 + 0] / vm) * spd
      this.velocities[i3 + 2] = (this.velocities[i3 + 2] / vm) * spd

      // 5. Move
      this.positions[i3 + 0] += this.velocities[i3 + 0] * dtScale
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dtScale

      // 6. Obstacles — collide, bounce, push out; never overlap (iterate to resolve)
      for (let iter = 0; iter < 3; iter++) {
        let anyOverlap = false
        for (let j = 0; j < this.obstacles.objects.length; j++) {
          const rock = this.obstacles.objects[j]
          const w = this.obstacles.dims[j].w
          const d = this.obstacles.dims[j].d
          const rad = Math.sqrt(w * w + d * d) / 2 + 0.05 // Box footprint + ant clearance
          const dx = this.positions[i3 + 0] - rock.position.x
          const dz = this.positions[i3 + 2] - rock.position.z
          const distSq = dx * dx + dz * dz
          if (distSq < rad * rad) {
            anyOverlap = true
            const dist = Math.sqrt(distSq) || 0.001
            const nx = dx / dist
            const nz = dz / dist
            this.positions[i3 + 0] = rock.position.x + nx * rad
            this.positions[i3 + 2] = rock.position.z + nz * rad
            const dot = this.velocities[i3 + 0] * nx + this.velocities[i3 + 2] * nz
            if (dot > 0) {
              this.velocities[i3 + 0] -= 2 * dot * nx
              this.velocities[i3 + 2] -= 2 * dot * nz
            }
            const vm2 = Math.hypot(this.velocities[i3 + 0], this.velocities[i3 + 2]) || 0.001
            this.velocities[i3 + 0] = (this.velocities[i3 + 0] / vm2) * spd
            this.velocities[i3 + 2] = (this.velocities[i3 + 2] / vm2) * spd
          }
        }
        if (!anyOverlap) break
      }

      this.positions[i3 + 1] = this.terrain.getHeight(this.positions[i3 + 0], this.positions[i3 + 2]) + 0.1
      for (let j = 0; j < this.obstacles.objects.length; j++) {
        const rock = this.obstacles.objects[j]
        const w = this.obstacles.dims[j].w
        const d = this.obstacles.dims[j].d
        const rad = Math.sqrt(w * w + d * d) / 2
        const dx = this.positions[i3 + 0] - rock.position.x
        const dz = this.positions[i3 + 2] - rock.position.z
        if (dx * dx + dz * dz < rad * rad) {
          const obstacleBottom = rock.position.y - this.obstacles.halfHeights[j]
          this.positions[i3 + 1] = Math.max(this.positions[i3 + 1], obstacleBottom + 0.12)
        }
      }

      // 7. Deposit
      depositPositions[i3 + 0] = this.positions[i3 + 0]
      depositPositions[i3 + 1] = this.positions[i3 + 1]
      depositPositions[i3 + 2] = this.positions[i3 + 2]
      searchAmounts[i] = state === AntState.EXPLORING ? 1 : 0
      returnAmounts[i] = state === AntState.RETURNING ? 1 : 0
    }

    // Ant–ant collision — push apart and bounce when overlapping (iterative resolve)
    const antMinDist = 0.22
    const antGridSize = 1
    for (let iter = 0; iter < 3; iter++) {
      const collGrid = new Map<string, number[]>()
      for (let i = 0; i < this.count; i++) {
        const gx = Math.floor(this.positions[i * 3 + 0] / antGridSize)
        const gz = Math.floor(this.positions[i * 3 + 2] / antGridSize)
        const key = `${gx},${gz}`
        if (!collGrid.has(key)) collGrid.set(key, [])
        collGrid.get(key)!.push(i)
      }
      let anyCollision = false
      for (let i = 0; i < this.count; i++) {
        const i3 = i * 3
        const gx = Math.floor(this.positions[i3 + 0] / antGridSize)
        const gz = Math.floor(this.positions[i3 + 2] / antGridSize)
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const neighbors = collGrid.get(`${gx + ox},${gz + oz}`)
            if (!neighbors) continue
            for (const j of neighbors) {
              if (j <= i) continue
              const j3 = j * 3
              const dx = this.positions[i3 + 0] - this.positions[j3 + 0]
              const dz = this.positions[i3 + 2] - this.positions[j3 + 2]
              const distSq = dx * dx + dz * dz
              if (distSq < antMinDist * antMinDist && distSq > 0.0001) {
                anyCollision = true
                const dist = Math.sqrt(distSq) || 0.001
                const nx = dx / dist
                const nz = dz / dist
                const overlap = antMinDist - dist
                this.positions[i3 + 0] += nx * (overlap / 2)
                this.positions[i3 + 2] += nz * (overlap / 2)
                this.positions[j3 + 0] -= nx * (overlap / 2)
                this.positions[j3 + 2] -= nz * (overlap / 2)
                const spdI = Math.hypot(this.velocities[i3 + 0], this.velocities[i3 + 2]) || 0.05
                const spdJ = Math.hypot(this.velocities[j3 + 0], this.velocities[j3 + 2]) || 0.05
                const dotI = this.velocities[i3 + 0] * nx + this.velocities[i3 + 2] * nz
                const dotJ = this.velocities[j3 + 0] * nx + this.velocities[j3 + 2] * nz
                if (dotI < 0) {
                  this.velocities[i3 + 0] -= 2 * dotI * nx
                  this.velocities[i3 + 2] -= 2 * dotI * nz
                }
                if (dotJ > 0) {
                  this.velocities[j3 + 0] -= 2 * dotJ * nx
                  this.velocities[j3 + 2] -= 2 * dotJ * nz
                }
                const vmI = Math.hypot(this.velocities[i3 + 0], this.velocities[i3 + 2]) || 0.001
                const vmJ = Math.hypot(this.velocities[j3 + 0], this.velocities[j3 + 2]) || 0.001
                this.velocities[i3 + 0] = (this.velocities[i3 + 0] / vmI) * spdI
                this.velocities[i3 + 2] = (this.velocities[i3 + 2] / vmI) * spdI
                this.velocities[j3 + 0] = (this.velocities[j3 + 0] / vmJ) * spdJ
                this.velocities[j3 + 2] = (this.velocities[j3 + 2] / vmJ) * spdJ
              }
            }
          }
        }
      }
      if (!anyCollision) break
    }

    // Final pass: update Y, deposit positions, orientation
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3
      this.positions[i3 + 1] = this.terrain.getHeight(this.positions[i3 + 0], this.positions[i3 + 2]) + 0.1
      for (let j = 0; j < this.obstacles.objects.length; j++) {
        const rock = this.obstacles.objects[j]
        const w = this.obstacles.dims[j].w
        const d = this.obstacles.dims[j].d
        const rad = Math.sqrt(w * w + d * d) / 2
        const dx = this.positions[i3 + 0] - rock.position.x
        const dz = this.positions[i3 + 2] - rock.position.z
        if (dx * dx + dz * dz < rad * rad) {
          const obstacleBottom = rock.position.y - this.obstacles.halfHeights[j]
          this.positions[i3 + 1] = Math.max(this.positions[i3 + 1], obstacleBottom + 0.12)
        }
      }
      depositPositions[i3 + 0] = this.positions[i3 + 0]
      depositPositions[i3 + 1] = this.positions[i3 + 1]
      depositPositions[i3 + 2] = this.positions[i3 + 2]
      this.dummy.position.set(this.positions[i3 + 0], this.positions[i3 + 1] + 0.05, this.positions[i3 + 2])
      this.dummy.up.copy(this.terrain.getNormal(this.positions[i3 + 0], this.positions[i3 + 2]))
      this.dummy.lookAt(
        this.positions[i3 + 0] + this.velocities[i3 + 0],
        this.positions[i3 + 1] + 0.05,
        this.positions[i3 + 2] + this.velocities[i3 + 2]
      )
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
    }

    this.pheromones.deposit(depositPositions, searchAmounts, returnAmounts, this.count)
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
