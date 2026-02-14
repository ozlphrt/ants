import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { DragControls } from 'three/examples/jsm/controls/DragControls'

export class Obstacles {
    scene: THREE.Scene
    world: RAPIER.World
    objects: THREE.Mesh[] = []
    bodies: RAPIER.RigidBody[] = []
    halfHeights: number[] = []
    dims: { w: number, h: number, d: number }[] = []
    dragControls: DragControls

    terrain: any

    constructor(scene: THREE.Scene, camera: THREE.Camera, domElement: HTMLElement, world: RAPIER.World, orbitControls: any, terrain: any) {
        this.scene = scene
        this.world = world
        this.terrain = terrain

        // Create 15 obstacles at random locations
        for (let i = 0; i < 15; i++) {
            const x = (Math.random() - 0.5) * 80
            const z = (Math.random() - 0.5) * 80

            // Randomize dimensions - much flatter for a pebbly look
            const w = 2 + Math.random() * 6
            const h = 0.5 + Math.random() * 1.0 // Height range 0.5 - 1.5
            const d = 2 + Math.random() * 6

            this.addBox(x, 2, z, w, h, d)
        }

        this.dragControls = new DragControls(this.objects, camera, domElement)

        this.dragControls.addEventListener('dragstart', (event) => {
            orbitControls.enabled = false
            const mesh = event.object as THREE.Mesh
            const index = this.objects.indexOf(mesh)
            if (index !== -1) {
                const body = this.bodies[index]
                body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
            }
        })

        this.dragControls.addEventListener('drag', (event) => {
            const mesh = event.object as THREE.Mesh
            const index = this.objects.indexOf(mesh)

            if (index !== -1) {
                const { w, h, d } = this.dims[index]
                const halfH = h / 2

                // 1. Clamp within terrain boundaries
                const halfSize = 48
                mesh.position.x = Math.max(-halfSize, Math.min(halfSize, mesh.position.x))
                mesh.position.z = Math.max(-halfSize, Math.min(halfSize, mesh.position.z))

                // 2. Adjust rotation based on terrain normal at center
                const normal = this.terrain.getNormal(mesh.position.x, mesh.position.z)
                mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)

                // 3. Multi-point corner checking for elevation
                // We check the 4 bottom corners of the rotated box
                const corners = [
                    new THREE.Vector3(-w / 2, -halfH, -d / 2),
                    new THREE.Vector3(w / 2, -halfH, -d / 2),
                    new THREE.Vector3(-w / 2, -halfH, d / 2),
                    new THREE.Vector3(w / 2, -halfH, d / 2)
                ]

                let maxNeededY = -Infinity
                corners.forEach(c => {
                    const localC = c.clone()
                    localC.applyQuaternion(mesh.quaternion)
                    const terrainH = this.terrain.getHeight(mesh.position.x + localC.x, mesh.position.z + localC.z)
                    maxNeededY = Math.max(maxNeededY, terrainH - localC.y)
                })

                mesh.position.y = maxNeededY + 0.15 // Increased margin

                const body = this.bodies[index]
                body.setNextKinematicTranslation({
                    x: mesh.position.x,
                    y: mesh.position.y,
                    z: mesh.position.z
                })
                body.setNextKinematicRotation(mesh.quaternion)
            }
        })

        this.dragControls.addEventListener('dragend', (event) => {
            orbitControls.enabled = true
            const mesh = event.object as THREE.Mesh
            const index = this.objects.indexOf(mesh)
            if (index !== -1) {
                const body = this.bodies[index]
                body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
            }
        })
    }

    addBox(x: number, y: number, z: number, w: number, h: number, d: number) {
        // Use Icosahedron for all pebbles to ensure organic, non-boxy shapes
        const baseRadius = Math.max(w, d) / 2
        const geometry = new THREE.IcosahedronGeometry(baseRadius, 3)

        // Morph the geometry with coordinated noise for lumpy organic irregularity
        const posAttr = geometry.attributes.position
        for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i)
            const vy = posAttr.getY(i)
            const vz = posAttr.getZ(i)

            // Coordinated organic noise
            const noise = (
                Math.sin(vx * 1.2) * Math.cos(vz * 1.2) +
                Math.sin(vz * 1.5 + vx) * 0.5
            ) * 0.2 * baseRadius

            posAttr.setX(i, vx + noise)
            posAttr.setY(i, vy + noise * 0.5)
            posAttr.setZ(i, vz + noise)
        }
        geometry.computeVertexNormals()

        const material = new THREE.MeshStandardMaterial({
            color: 0x666673, // Matches base terrain gray
            transparent: false,
            opacity: 1.0,
            roughness: 0.8,
            metalness: 0.1
        })
        const mesh = new THREE.Mesh(geometry, material)

        // Aggressive non-uniform scaling to create oblong "river rock" profiles
        const xScale = 0.5 + Math.random() * 1.5
        const zScale = 0.5 + Math.random() * 1.5
        const yScale = 0.2 + Math.random() * 0.2 // Very flat for river rocks
        mesh.scale.set(xScale, yScale, zScale)

        mesh.rotateY(Math.random() * Math.PI * 2)

        // Initial placement logic
        const halfW = baseRadius * xScale
        const halfD = baseRadius * zScale
        const halfH = baseRadius * yScale

        const normal = this.terrain.getNormal(x, z)
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)

        const corners = [
            new THREE.Vector3(-halfW, -halfH, -halfD),
            new THREE.Vector3(halfW, -halfH, -halfD),
            new THREE.Vector3(-halfW, -halfH, halfD),
            new THREE.Vector3(halfW, -halfH, halfD)
        ]
        let maxNeededY = -Infinity
        corners.forEach(c => {
            c.applyQuaternion(mesh.quaternion)
            const terrainH = this.terrain.getHeight(x + c.x, z + c.z)
            maxNeededY = Math.max(maxNeededY, terrainH - c.y)
        })

        const startY = maxNeededY + 0.2
        mesh.position.set(x, startY, z)

        mesh.castShadow = true
        mesh.receiveShadow = true
        this.scene.add(mesh)
        this.objects.push(mesh)

        // Physics
        const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, startY, z)
            .setRotation(mesh.quaternion)
        const body = this.world.createRigidBody(rigidBodyDesc)

        const colliderDesc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        this.world.createCollider(colliderDesc, body)

        this.bodies.push(body)
        this.halfHeights.push(halfH)
        this.dims.push({ w, h, d })
    }

    update() {
        const halfSize = 48
        for (let i = 0; i < this.objects.length; i++) {
            const body = this.bodies[i]
            const mesh = this.objects[i]

            if (body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
                const pos = body.translation()
                const rot = body.rotation()

                // Boundary clamping for dynamic bodies too
                let nx = pos.x
                let nz = pos.z
                let ny = pos.y

                if (Math.abs(nx) > halfSize || Math.abs(nz) > halfSize) {
                    nx = Math.max(-halfSize, Math.min(halfSize, nx))
                    nz = Math.max(-halfSize, Math.min(halfSize, nz))
                    body.setTranslation({ x: nx, y: ny, z: nz }, true)
                    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
                }

                mesh.position.set(nx, ny, nz)
                mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w)
            }
        }
    }
}
