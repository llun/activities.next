import type { Size } from '@/lib/services/medias/edit/geometry'
import type { Adjustments } from '@/lib/services/medias/edit/recipe'

import { CLARITY_BLUR_SIGMA, TONE_BLUR_SIGMA } from './colour'
import { type MaskSliders, packMaskUniforms } from './maskUniforms'
import {
  BLUR_FRAGMENT_SHADER,
  MAIN_FRAGMENT_SHADER,
  MASK_BLUR_FRAGMENT_SHADER,
  VERTEX_SHADER
} from './shaders'
import { type TileRect, planTiles } from './tiles'

/** Pixels read back from the renderer, top row first. */
export interface RgbaPixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * The masks of a recipe after the geometry: one RGBA pixel per frame pixel,
 * the R, G, B and A channels holding masks 0 to 3 (0 = outside, 255 = inside),
 * rows from the top. The frame covers the whole output at a lower resolution
 * (at most 1024 on the long edge) and is sampled bilinearly.
 */
export interface MaskFrame {
  size: Size
  data: Uint8ClampedArray | Uint8Array
}

/** The mask frame and the feather of each channel. */
export interface MaskSet {
  frame: MaskFrame
  /** Gaussian sigma of each channel's feather, in frame pixels. */
  sigmas: ReadonlyArray<number>
  /** The sliders of each channel; null when the mask changes nothing. */
  adjustments: ReadonlyArray<MaskSliders>
}

/** Tints one mask channel over the picture (the Masks tab overlay). */
export interface MaskOverlay {
  channel: number
  /** sRGB, 0..1. */
  colour: [number, number, number]
  alpha: number
}

export interface PreviewExtras {
  /** The sliders of each mask channel; null when it changes nothing. */
  masks?: ReadonlyArray<MaskSliders>
  overlay?: MaskOverlay | null
}

export interface PreviewFrame {
  /** The geometry result at preview size (sRGB pixels). */
  image: TexImageSource
  size: Size
  /** The geometry result at low resolution, for the blurs. */
  blur: TexImageSource
  blurSize: Size
}

export interface RenderJob {
  output: Size
  blur: TexImageSource
  blurSize: Size
  adjustments: Adjustments
  masks?: MaskSet
  /**
   * The geometry result for `rect` of the output. With `wholeImage` it is
   * called once for the whole output; otherwise once per tile with its halo.
   */
  getImage: (rect: TileRect) => TexImageSource
  wholeImage: boolean
}

export interface Renderer {
  readonly maxTextureSize: number
  isContextLost: () => boolean
  setPreviewFrame: (frame: PreviewFrame) => void
  renderPreview: (adjustments: Adjustments, extras?: PreviewExtras) => void
  /**
   * Sets the mask frame of the preview (null clears it) and its feather.
   * Call it again when the geometry or a mask's pixels change.
   */
  setPreviewMasks: (
    frame: MaskFrame | null,
    sigmas: ReadonlyArray<number>
  ) => void
  /** The rendered preview, downsampled so its long edge is at most `maxEdge`. */
  readPreview: (maxEdge: number) => RgbaPixels | null
  /** Renders the whole output, tile by tile, and returns its pixels. */
  renderToPixels: (job: RenderJob) => RgbaPixels
  /**
   * Frees the GL resources. With `releaseContext` the context is given up
   * too, which is right for a throwaway canvas but not for one that React may
   * set up again (a dev-mode effect re-run would then get a dead context).
   */
  dispose: (releaseContext?: boolean) => void
}

export interface RendererOptions {
  onContextLost?: () => void
}

const HALO = 8

const UNIFORMS_MAIN = [
  'uImage',
  'uBlur',
  'uMask',
  'uTileOrigin',
  'uTileSize',
  'uOutputSize',
  'uImageOrigin',
  'uImageSize',
  'uFlipY',
  'uExposure',
  'uTemperature',
  'uTint',
  'uWhites',
  'uBlacks',
  'uShadows',
  'uHighlights',
  'uContrast',
  'uTexture',
  'uClarity',
  'uSaturation',
  'uVibrance',
  'uVignette',
  'uMaskOn',
  'uMaskAdj',
  'uOverlayChannel',
  'uOverlayColour',
  'uOverlayAlpha'
] as const

const UNIFORMS_MASK_BLUR = ['uSrc', 'uStep', 'uSigma'] as const

const UNIFORMS_BLUR = [
  'uSrc',
  'uStep',
  'uSigmaMid',
  'uSigmaTone',
  'uFirst'
] as const

interface Program<K extends string> {
  program: WebGLProgram
  uniforms: Record<K, WebGLUniformLocation | null>
}

const compile = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader => {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Could not create a shader')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader failed to compile: ${log}`)
  }
  return shader
}

const link = <K extends string>(
  gl: WebGL2RenderingContext,
  fragment: string,
  names: ReadonlyArray<K>
): Program<K> => {
  const program = gl.createProgram()
  if (!program) throw new Error('Could not create a program')
  const vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragment)
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program failed to link: ${log}`)
  }
  const uniforms = {} as Record<K, WebGLUniformLocation | null>
  for (const name of names)
    uniforms[name] = gl.getUniformLocation(program, name)
  return { program, uniforms }
}

/**
 * Creates the WebGL2 renderer on `canvas` (§2.2 steps 2-5), or null when the
 * browser has no WebGL2. Geometry is drawn on the CPU and handed in as an
 * image; this runs the blur passes and the colour shader.
 */
export const createRenderer = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: RendererOptions = {}
): Renderer | null => {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance'
  }) as WebGL2RenderingContext | null
  if (!gl) return null

  let lost = false
  const onLost = (event: Event) => {
    event.preventDefault()
    lost = true
    options.onContextLost?.()
  }
  canvas.addEventListener('webglcontextlost', onLost)

  const main = link(gl, MAIN_FRAGMENT_SHADER, UNIFORMS_MAIN)
  const blur = link(gl, BLUR_FRAGMENT_SHADER, UNIFORMS_BLUR)
  const maskBlur = link(gl, MASK_BLUR_FRAGMENT_SHADER, UNIFORMS_MASK_BLUR)
  const vao = gl.createVertexArray()
  gl.bindVertexArray(vao)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const maxTile = Math.min(
    maxTextureSize,
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    4096
  )
  const floatTargets = Boolean(
    gl.getExtension('EXT_color_buffer_float') ||
    gl.getExtension('EXT_color_buffer_half_float')
  )

  const createTexture = (filter: number) => {
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  const imageTexture = createTexture(gl.NEAREST)
  const blurSourceTexture = createTexture(gl.LINEAR)
  const blurTextureA = createTexture(gl.LINEAR)
  const blurTextureB = createTexture(gl.LINEAR)
  const tileTexture = createTexture(gl.NEAREST)
  // The packed mask frame, its two blur targets, and a 1x1 "no masks" frame.
  const maskRawTexture = createTexture(gl.LINEAR)
  const maskBlurTextureA = createTexture(gl.LINEAR)
  const maskBlurTextureB = createTexture(gl.LINEAR)
  const maskEmptyTexture = createTexture(gl.NEAREST)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array(4)
  )
  let maskCurrent: WebGLTexture | null = maskEmptyTexture
  let maskFrameSize: Size | null = null
  const framebuffer = gl.createFramebuffer()
  let blurFloat = floatTargets
  let tileCapacity: Size = { width: 0, height: 0 }
  let preview: PreviewFrame | null = null

  const upload = (texture: WebGLTexture | null, source: TexImageSource) => {
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  }

  const allocate = (
    texture: WebGLTexture | null,
    size: Size,
    useFloat: boolean
  ) => {
    gl.bindTexture(gl.TEXTURE_2D, texture)
    if (useFloat) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        size.width,
        size.height,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null
      )
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        size.width,
        size.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      )
    }
  }

  const bindTarget = (texture: WebGLTexture | null, size: Size) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    )
    gl.viewport(0, 0, size.width, size.height)
  }

  const bindUnit = (unit: number, texture: WebGLTexture | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
  }

  /** Blurs `blurSourceTexture` into `blurTextureB` (R clarity, G tone). */
  const runBlur = (size: Size) => {
    allocate(blurTextureA, size, blurFloat)
    allocate(blurTextureB, size, blurFloat)
    bindTarget(blurTextureA, size)
    if (
      blurFloat &&
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
    ) {
      // Float render targets are not usable here; 8 bit is enough for a blur.
      blurFloat = false
      allocate(blurTextureA, size, false)
      allocate(blurTextureB, size, false)
    }
    const longEdge = Math.max(size.width, size.height)
    gl.useProgram(blur.program)
    gl.uniform1i(blur.uniforms.uSrc, 0)
    gl.uniform1f(blur.uniforms.uSigmaMid, CLARITY_BLUR_SIGMA * longEdge)
    gl.uniform1f(blur.uniforms.uSigmaTone, TONE_BLUR_SIGMA * longEdge)

    bindTarget(blurTextureA, size)
    bindUnit(0, blurSourceTexture)
    gl.uniform2f(blur.uniforms.uStep, 1 / size.width, 0)
    gl.uniform1f(blur.uniforms.uFirst, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    bindTarget(blurTextureB, size)
    bindUnit(0, blurTextureA)
    gl.uniform2f(blur.uniforms.uStep, 0, 1 / size.height)
    gl.uniform1f(blur.uniforms.uFirst, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const setBlurSource = (source: TexImageSource, size: Size) => {
    upload(blurSourceTexture, source)
    runBlur(size)
  }

  /** Blurs the raw mask frame into `maskBlurTextureB`, a sigma per channel. */
  const runMaskBlur = (size: Size, sigmas: ReadonlyArray<number>) => {
    allocate(maskBlurTextureA, size, blurFloat)
    allocate(maskBlurTextureB, size, blurFloat)
    bindTarget(maskBlurTextureA, size)
    if (
      blurFloat &&
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
    ) {
      blurFloat = false
      allocate(maskBlurTextureA, size, false)
      allocate(maskBlurTextureB, size, false)
    }
    gl.useProgram(maskBlur.program)
    gl.uniform1i(maskBlur.uniforms.uSrc, 0)
    gl.uniform4f(
      maskBlur.uniforms.uSigma,
      sigmas[0] ?? 0,
      sigmas[1] ?? 0,
      sigmas[2] ?? 0,
      sigmas[3] ?? 0
    )
    bindTarget(maskBlurTextureA, size)
    bindUnit(0, maskRawTexture)
    gl.uniform2f(maskBlur.uniforms.uStep, 1 / size.width, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    bindTarget(maskBlurTextureB, size)
    bindUnit(0, maskBlurTextureA)
    gl.uniform2f(maskBlur.uniforms.uStep, 0, 1 / size.height)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const setMaskFeather = (sigmas: ReadonlyArray<number>) => {
    if (!maskFrameSize) return
    if (sigmas.every((sigma) => !(sigma > 0))) {
      maskCurrent = maskRawTexture
      return
    }
    runMaskBlur(maskFrameSize, sigmas)
    maskCurrent = maskBlurTextureB
  }

  const setMaskFrame = (
    frame: MaskFrame | null,
    sigmas: ReadonlyArray<number>
  ) => {
    if (!frame) {
      maskFrameSize = null
      maskCurrent = maskEmptyTexture
      return
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, maskRawTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      frame.size.width,
      frame.size.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      frame.data instanceof Uint8Array
        ? frame.data
        : new Uint8Array(
            frame.data.buffer,
            frame.data.byteOffset,
            frame.data.byteLength
          )
    )
    maskFrameSize = frame.size
    setMaskFeather(sigmas)
  }

  const setAdjustmentUniforms = (adjustments: Adjustments) => {
    const u = main.uniforms
    gl.uniform1f(u.uExposure, adjustments.exposure ?? 0)
    gl.uniform1f(u.uTemperature, (adjustments.temperature ?? 0) / 100)
    gl.uniform1f(u.uTint, (adjustments.tint ?? 0) / 100)
    gl.uniform1f(u.uWhites, (adjustments.whites ?? 0) / 100)
    gl.uniform1f(u.uBlacks, (adjustments.blacks ?? 0) / 100)
    gl.uniform1f(u.uShadows, (adjustments.shadows ?? 0) / 100)
    gl.uniform1f(u.uHighlights, (adjustments.highlights ?? 0) / 100)
    gl.uniform1f(u.uContrast, (adjustments.contrast ?? 0) / 100)
    gl.uniform1f(u.uTexture, (adjustments.texture ?? 0) / 100)
    gl.uniform1f(u.uClarity, (adjustments.clarity ?? 0) / 100)
    gl.uniform1f(u.uSaturation, (adjustments.saturation ?? 0) / 100)
    gl.uniform1f(u.uVibrance, (adjustments.vibrance ?? 0) / 100)
    gl.uniform1f(u.uVignette, (adjustments.vignette ?? 0) / 100)
  }

  interface MainPass {
    adjustments: Adjustments
    masks: ReadonlyArray<MaskSliders>
    overlay: MaskOverlay | null
    output: Size
    tileOrigin: { x: number; y: number }
    tileSize: Size
    imageOrigin: { x: number; y: number }
    imageSize: Size
    flipY: boolean
  }

  const drawMain = (pass: MainPass) => {
    const u = main.uniforms
    gl.useProgram(main.program)
    gl.uniform1i(u.uImage, 0)
    gl.uniform1i(u.uBlur, 1)
    gl.uniform1i(u.uMask, 2)
    bindUnit(2, maskCurrent)
    bindUnit(1, blurTextureB)
    gl.uniform2f(u.uTileOrigin, pass.tileOrigin.x, pass.tileOrigin.y)
    gl.uniform2f(u.uTileSize, pass.tileSize.width, pass.tileSize.height)
    gl.uniform2f(u.uOutputSize, pass.output.width, pass.output.height)
    gl.uniform2f(u.uImageOrigin, pass.imageOrigin.x, pass.imageOrigin.y)
    gl.uniform2f(u.uImageSize, pass.imageSize.width, pass.imageSize.height)
    gl.uniform1f(u.uFlipY, pass.flipY ? 1 : 0)
    setAdjustmentUniforms(pass.adjustments)
    const packed = packMaskUniforms(pass.masks)
    gl.uniform4f(u.uMaskOn, ...packed.on)
    gl.uniform4fv(u.uMaskAdj, packed.values)
    const overlay = pass.overlay
    gl.uniform1f(u.uOverlayChannel, overlay ? overlay.channel : -1)
    gl.uniform3f(
      u.uOverlayColour,
      overlay?.colour[0] ?? 0,
      overlay?.colour[1] ?? 0,
      overlay?.colour[2] ?? 0
    )
    gl.uniform1f(u.uOverlayAlpha, overlay?.alpha ?? 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  const setPreviewFrame = (frame: PreviewFrame) => {
    preview = frame
    canvas.width = frame.size.width
    canvas.height = frame.size.height
    upload(imageTexture, frame.image)
    setBlurSource(frame.blur, frame.blurSize)
  }

  let lastPreview: {
    adjustments: Adjustments
    extras: PreviewExtras
  } | null = null

  const renderPreview = (
    adjustments: Adjustments,
    extras: PreviewExtras = {}
  ) => {
    if (!preview || lost) return
    lastPreview = { adjustments, extras }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, preview.size.width, preview.size.height)
    bindUnit(0, imageTexture)
    drawMain({
      adjustments,
      masks: extras.masks ?? [],
      overlay: extras.overlay ?? null,
      output: preview.size,
      tileOrigin: { x: 0, y: 0 },
      tileSize: preview.size,
      imageOrigin: { x: 0, y: 0 },
      imageSize: preview.size,
      flipY: true
    })
  }

  const readPreview = (maxEdge: number): RgbaPixels | null => {
    if (!preview || lost) return null
    const { width, height } = preview.size
    // The histogram describes the photo, not the tint of the overlay.
    const shown = lastPreview
    if (shown?.extras.overlay) {
      renderPreview(shown.adjustments, { ...shown.extras, overlay: null })
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const full = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, full)
    if (shown?.extras.overlay) renderPreview(shown.adjustments, shown.extras)
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    const outWidth = Math.max(1, Math.round(width * scale))
    const outHeight = Math.max(1, Math.round(height * scale))
    const data = new Uint8ClampedArray(outWidth * outHeight * 4)
    for (let y = 0; y < outHeight; y += 1) {
      // readPixels returns the bottom row first.
      const sourceRow = height - 1 - Math.min(height - 1, Math.floor(y / scale))
      for (let x = 0; x < outWidth; x += 1) {
        const sourceColumn = Math.min(width - 1, Math.floor(x / scale))
        const from = (sourceRow * width + sourceColumn) * 4
        const to = (y * outWidth + x) * 4
        data[to] = full[from]
        data[to + 1] = full[from + 1]
        data[to + 2] = full[from + 2]
        data[to + 3] = 255
      }
    }
    return { data, width: outWidth, height: outHeight }
  }

  const renderToPixels = (job: RenderJob): RgbaPixels => {
    const { output } = job
    setBlurSource(job.blur, job.blurSize)
    setMaskFrame(job.masks?.frame ?? null, job.masks?.sigmas ?? [])
    const maskSliders = job.masks?.adjustments ?? []
    const tiles = planTiles(output.width, output.height, maxTile, HALO)
    const data = new Uint8ClampedArray(output.width * output.height * 4)

    const capacity = tiles.reduce(
      (size, tile) => ({
        width: Math.max(size.width, tile.haloRect.w),
        height: Math.max(size.height, tile.haloRect.h)
      }),
      { width: 1, height: 1 }
    )
    if (
      capacity.width !== tileCapacity.width ||
      capacity.height !== tileCapacity.height
    ) {
      allocate(tileTexture, capacity, false)
      tileCapacity = capacity
    }

    let wholeUploaded = false
    for (const tile of tiles) {
      const halo = tile.haloRect
      let imageOrigin = { x: 0, y: 0 }
      let imageSize = output
      if (job.wholeImage) {
        if (!wholeUploaded) {
          upload(
            imageTexture,
            job.getImage({ x: 0, y: 0, w: output.width, h: output.height })
          )
          wholeUploaded = true
        }
      } else {
        upload(imageTexture, job.getImage(halo))
        imageOrigin = { x: halo.x, y: halo.y }
        imageSize = { width: halo.w, height: halo.h }
      }
      bindTarget(tileTexture, { width: halo.w, height: halo.h })
      bindUnit(0, imageTexture)
      drawMain({
        adjustments: job.adjustments,
        masks: maskSliders,
        overlay: null,
        output,
        tileOrigin: { x: halo.x, y: halo.y },
        tileSize: { width: halo.w, height: halo.h },
        imageOrigin,
        imageSize,
        flipY: false
      })
      const inner = new Uint8Array(tile.w * tile.h * 4)
      gl.readPixels(
        tile.x - halo.x,
        tile.y - halo.y,
        tile.w,
        tile.h,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        inner
      )
      // The shader ran with flipY off, so framebuffer row r is image row
      // halo.y + r and the rows need no flip.
      for (let row = 0; row < tile.h; row += 1) {
        const from = row * tile.w * 4
        const to = ((tile.y + row) * output.width + tile.x) * 4
        data.set(inner.subarray(from, from + tile.w * 4), to)
      }
    }
    return { data, width: output.width, height: output.height }
  }

  const dispose = (releaseContext = false) => {
    canvas.removeEventListener('webglcontextlost', onLost)
    for (const texture of [
      imageTexture,
      blurSourceTexture,
      blurTextureA,
      blurTextureB,
      tileTexture,
      maskRawTexture,
      maskBlurTextureA,
      maskBlurTextureB,
      maskEmptyTexture
    ]) {
      gl.deleteTexture(texture)
    }
    gl.deleteFramebuffer(framebuffer)
    gl.deleteProgram(main.program)
    gl.deleteProgram(blur.program)
    gl.deleteProgram(maskBlur.program)
    gl.deleteVertexArray(vao)
    if (releaseContext) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  return {
    maxTextureSize,
    isContextLost: () => lost || gl.isContextLost(),
    setPreviewFrame,
    renderPreview,
    setPreviewMasks: setMaskFrame,
    readPreview,
    renderToPixels,
    dispose
  }
}
