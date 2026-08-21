/**
 * Marching cubes off the main thread.
 *
 * The cube is uploaded once and cached here, because the threshold is the value
 * users drag and re-sending several megabytes of Float32 per drag step would cost
 * more than the extraction itself.
 */

import { buildIsoMesh } from './meshBuilder'

export interface SetVolumeMessage {
  type: 'setVolume'
  vol: Float32Array
  R: number
}

export interface BuildMessage {
  type: 'build'
  requestId: number
  threshold: number
  mcR: number
  cols: number
  rows: number
  slices: number
  spacing: [number, number, number]
}

export type WorkerRequest = SetVolumeMessage | BuildMessage

export type WorkerResponse =
  | {
      type: 'result'
      requestId: number
      positions: Float32Array
      normals: Float32Array
      indices: Uint32Array
    }
  | { type: 'empty'; requestId: number }
  | { type: 'error'; requestId: number; message: string }

let cached: Float32Array | null = null
let cachedR = 0

const worker = self as unknown as Worker

worker.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data

  if (message.type === 'setVolume') {
    cached = message.vol
    cachedR = message.R
    return
  }

  const { requestId } = message
  if (!cached) {
    worker.postMessage({ type: 'error', requestId, message: 'No volume was uploaded.' } satisfies WorkerResponse)
    return
  }

  try {
    const mesh = buildIsoMesh(
      cached,
      cachedR,
      message.threshold,
      message.mcR,
      message.cols,
      message.rows,
      message.slices,
      message.spacing,
    )

    if (!mesh) {
      worker.postMessage({ type: 'empty', requestId } satisfies WorkerResponse)
      return
    }

    worker.postMessage(
      { type: 'result', requestId, ...mesh } satisfies WorkerResponse,
      [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer],
    )
  } catch (error) {
    worker.postMessage({
      type: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse)
  }
}
