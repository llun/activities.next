import * as ort from 'onnxruntime-web/wasm'

import type { SamRequest, SamResponse } from './samMessages'
import { postprocessSam } from './samPost'
import { getSamResize, preprocessSam, toSamPrompt } from './samPre'

ort.env.wasm.simd = true
ort.env.wasm.numThreads =
  typeof self !== 'undefined' && self.crossOriginIsolated
    ? Math.min(4, self.navigator?.hardwareConcurrency || 1)
    : 1
ort.env.wasm.proxy = false

// The page's tsconfig has the DOM lib, not the worker one, so the two members
// of the worker scope this file uses are typed here.
const scope = self as unknown as {
  postMessage: (message: SamResponse, transfer?: Transferable[]) => void
  onmessage: ((event: MessageEvent<SamRequest>) => void) | null
}

let encoder: ort.InferenceSession | null = null
let decoder: ort.InferenceSession | null = null
let embeddings: {
  imageEmbeddings: ort.Tensor
  positionalEmbeddings: ort.Tensor
  resized: { width: number; height: number }
  guideRgba: Uint8ClampedArray
} | null = null

const post = (message: SamResponse, transfer: Transferable[] = []) =>
  scope.postMessage(message, transfer)

const releaseEmbeddings = () => {
  embeddings?.imageEmbeddings.dispose()
  embeddings?.positionalEmbeddings.dispose()
  embeddings = null
}

const load = async (request: Extract<SamRequest, { type: 'load' }>) => {
  const options: ort.InferenceSession.SessionOptions = {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all'
  }
  encoder = await ort.InferenceSession.create(
    new Uint8Array(request.encoder),
    options
  )
  decoder = await ort.InferenceSession.create(
    new Uint8Array(request.decoder),
    options
  )
  post({ type: 'loaded' })
}

const embed = async (request: Extract<SamRequest, { type: 'embed' }>) => {
  if (!encoder) throw new Error('The model is not loaded')
  const { bitmap } = request
  const resized = getSamResize({ width: bitmap.width, height: bitmap.height })
  const canvas = new OffscreenCanvas(resized.width, resized.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('2D canvas is not available')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, resized.width, resized.height)
  bitmap.close()
  const pixels = context.getImageData(0, 0, resized.width, resized.height)
  const guideRgba = new Uint8ClampedArray(pixels.data)

  const input = new ort.Tensor(
    'float32',
    preprocessSam(pixels.data, resized),
    [1, 3, 1024, 1024]
  )
  const outputs = await encoder.run({ [encoder.inputNames[0]]: input })
  input.dispose()
  releaseEmbeddings()
  embeddings = {
    imageEmbeddings: outputs.image_embeddings,
    positionalEmbeddings: outputs.image_positional_embeddings,
    resized,
    guideRgba
  }
  post({ type: 'embedded' })
}

const segment = async (request: Extract<SamRequest, { type: 'segment' }>) => {
  if (!decoder || !embeddings) throw new Error('The picture is not ready')
  const { resized } = embeddings
  const prompt = toSamPrompt(request.points, resized)
  const count = request.points.length
  const outputs = await decoder.run({
    image_embeddings: embeddings.imageEmbeddings,
    image_positional_embeddings: embeddings.positionalEmbeddings,
    input_points: new ort.Tensor('float32', prompt.coordinates, [
      1,
      1,
      count,
      2
    ]),
    input_labels: new ort.Tensor(
      'int64',
      BigInt64Array.from(prompt.labels, (label) => BigInt(label)),
      [1, 1, count]
    )
  })
  const data = postprocessSam(
    outputs.iou_scores.data as Float32Array,
    outputs.pred_masks.data as Float32Array,
    resized,
    resized,
    embeddings.guideRgba
  )
  outputs.iou_scores.dispose()
  outputs.pred_masks.dispose()
  const uint8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  post(
    { type: 'mask', width: resized.width, height: resized.height, data: uint8 },
    [data.buffer]
  )
}

scope.onmessage = async (event) => {
  try {
    const request = event.data
    if (request.type === 'load') await load(request)
    else if (request.type === 'embed') await embed(request)
    else if (request.type === 'segment') await segment(request)
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
