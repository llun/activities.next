let cached: boolean | undefined

/** Whether this browser can create a WebGL 2 context (checked once). */
export const isWebGl2Supported = (): boolean => {
  if (cached !== undefined) return cached
  if (typeof document === 'undefined') return true
  if (typeof WebGL2RenderingContext === 'undefined') {
    cached = false
    return cached
  }
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    cached = Boolean(gl)
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    cached = false
  }
  return cached
}
