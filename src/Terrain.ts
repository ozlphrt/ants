import * as THREE from 'three'
import { createNoise2D } from 'simplex-noise'
import RAPIER from '@dimforge/rapier3d-compat'

export class Terrain {
    mesh: THREE.Mesh
    size: number
    resolution: number
    heights: Float32Array
    noise2D = createNoise2D()
    offsetX = Math.random() * 10000
    offsetZ = Math.random() * 10000

    constructor(size: number = 100, resolution: number = 128) {
        this.size = size
        this.resolution = resolution
        this.heights = new Float32Array((resolution + 1) * (resolution + 1))

        const geometry = new THREE.PlaneGeometry(size, size, resolution, resolution)
        geometry.rotateX(-Math.PI / 2)

        const vertices = geometry.attributes.position.array as Float32Array

        for (let i = 0; i <= resolution; i++) {
            for (let j = 0; j <= resolution; j++) {
                const x = (j / resolution - 0.5) * size
                const z = (i / resolution - 0.5) * size

                // Generate procedural height
                const h = this.getHeight(x, z)

                const idx = (i * (resolution + 1) + j)
                this.heights[idx] = h

                // Update geometry vertex
                vertices[idx * 3] = x
                vertices[idx * 3 + 1] = h
                vertices[idx * 3 + 2] = z
            }
        }

        geometry.computeVertexNormals()

        // Height-based coloring for visibility
        const colors = new Float32Array(vertices.length)
        for (let i = 0; i < vertices.length / 3; i++) {
            const h = vertices[i * 3 + 1];
            // Base color is gray, highlights for peaks, darker for valleys
            const intensity = THREE.MathUtils.mapLinear(h, -5, 15, 0.4, 1.2);
            colors[i * 3 + 0] = 0.4 * intensity;
            colors[i * 3 + 1] = 0.4 * intensity;
            colors[i * 3 + 2] = 0.45 * intensity;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.8,
            metalness: 0.1,
            wireframe: false
        })

        this.mesh = new THREE.Mesh(geometry, material)
        this.mesh.receiveShadow = true
        this.mesh.castShadow = true
    }

    getHeight(x: number, z: number): number {
        const baseScale = 0.012; // Large hills/valleys
        const maskScale = 0.03;  // Controls where detail appears
        const detailScale = 0.08; // Small bumps
        const microScale = 0.4;   // Micro-terrain noise
        const nanoScale = 1.0;    // Fine granular noise

        const nx = x + this.offsetX;
        const nz = z + this.offsetZ;

        // Large-scale topology
        let h = this.noise2D(nx * baseScale, nz * baseScale) * 8;
        h += this.noise2D(nx * baseScale * 2.1, nz * baseScale * 2.1) * 4;

        // Sporadic noise masking (0.0 to 1.0 range, favoring lower values for sparsity)
        const mask = Math.max(0, this.noise2D(nx * maskScale, nz * maskScale) * 1.5 - 0.5);

        if (mask > 0) {
            // Small-scale detail
            h += this.noise2D(nx * detailScale, nz * detailScale) * 0.8 * mask;

            // Micro-scale detail
            h += this.noise2D(nx * microScale, nz * microScale) * 0.4 * mask;

            // Nano-scale detail
            h += this.noise2D(nx * nanoScale, nz * nanoScale) * 0.1 * mask;
        }

        // Valleys: Squashing negative values slightly differently
        if (h < -2) h = -2 + (h + 2) * 0.5;

        // Add a flat area around the center for the anthill
        const distFromCenter = Math.sqrt(x * x + z * z);
        const factor = THREE.MathUtils.smoothstep(distFromCenter, 4, 15);

        return h * factor;
    }

    getNormal(x: number, z: number): THREE.Vector3 {
        const eps = 0.1;
        const h1 = this.getHeight(x - eps, z);
        const h2 = this.getHeight(x + eps, z);
        const h3 = this.getHeight(x, z - eps);
        const h4 = this.getHeight(x, z + eps);

        // Normal = (-df/dx, 1, -df/dz)
        return new THREE.Vector3(h1 - h2, eps * 2, h3 - h4).normalize();
    }

    createPhysicsCollider(world: RAPIER.World) {
        // Rapier heightfield takes a flat array of heights in row-major order
        const n = this.resolution + 1

        // We need to transpose the heights array because Rapier expects 
        // heights[i, j] where i is X and j is Z, while Three.js PlaneGeometry 
        // usually has i as Z and j as X in its storage.
        const transposedHeights = new Float32Array(n * n)
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                // i = row (Z in Three.js), j = col (X in Three.js)
                // Rapier indices are generally (X, Z)
                transposedHeights[j * n + i] = this.heights[i * n + j]
            }
        }

        const colliderDesc = RAPIER.ColliderDesc.heightfield(
            n - 1,
            n - 1,
            transposedHeights,
            { x: this.size, y: 1.0, z: this.size }
        )

        world.createCollider(colliderDesc)
    }
}
