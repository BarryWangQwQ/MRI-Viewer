declare module 'marching-cubes-fast' {
  type Bounds = [[number, number, number], [number, number, number]]

  /** Negative inside the surface, positive outside. */
  type SignedDistanceFunction = (x: number, y: number, z: number) => number

  interface MarchingCubesResult {
    positions: Array<[number, number, number]>
    cells: Array<[number, number, number]>
  }

  export function marchingCubes(
    resolution: number,
    sdf: SignedDistanceFunction,
    bounds: Bounds,
  ): MarchingCubesResult
}
