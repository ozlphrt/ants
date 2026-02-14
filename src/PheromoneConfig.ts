/**
 * Pheromone system parameters — vibeants logic.
 * evaporationRate = fraction lost per frame (vibeants: 0.01 → multiply by 0.99).
 */
export interface PheromoneConfig {
  /** Deposit amount while searching (home/exploration trail) */
  depositRateSearch: number
  /** Deposit amount while returning (food trail) */
  depositRateReturn: number
  /** Evaporation: fraction lost per frame (0.01 = mult by 0.99) */
  evaporationRate: number
  /** Diffusion strength (0..1) */
  diffusionStrength: number
  /** Detection range for antennae sampling (world units) */
  sensingRadius: number
  /** Antennae noise level (0..1) */
  antennaeNoise: number
  /** Minimum pheromone strength to follow trail */
  minTrailStrength: number
}

export const defaultPheromoneConfig: PheromoneConfig = {
  depositRateSearch: 6,
  depositRateReturn: 12,
  evaporationRate: 0.01,
  diffusionStrength: 0.06,
  sensingRadius: 13,
  antennaeNoise: 0.3,
  minTrailStrength: 0.5,
}
