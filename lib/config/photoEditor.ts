// Photo editor configuration: where the browser downloads the subject model
// (SlimSAM) from, the origins the CSP must let it reach, and the vision model
// that suggests an AI enhance.
//
// This module is imported by the CSP builder, which `proxy.ts` loads in the
// Edge runtime, so it must stay free of Node APIs and of the logger (pino).
// The `@/lib/config` barrel wraps `getPhotoEditorConfig` with the warning an
// invalid value logs on the server.

export const PHOTO_MASK_MODEL_BASE_URL_ENV =
  'ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL'
export const PHOTO_ENHANCE_MODEL_ENV = 'ACTIVITIES_PHOTO_ENHANCE_MODEL'

// `Xenova/slimsam-77-uniform`, pinned to one revision so the files below can be
// checked byte for byte.
export const DEFAULT_PHOTO_MASK_MODEL_BASE_URL =
  'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/'

// Hugging Face answers a `resolve` URL with a redirect to its CDN
// (`us.aws.cdn.hf.co` and friends), which the browser follows inside the
// same `fetch`, so both origins have to be in `connect-src`.
export const DEFAULT_PHOTO_MASK_MODEL_CONNECT_ORIGINS: readonly string[] = [
  'https://huggingface.co',
  'https://*.hf.co'
]

export type PhotoEditorModelFile = {
  /** Relative to the base URL. */
  path: string
  bytes: number
  /** Lowercase hex sha256 of the file. */
  sha256: string
}

export type PhotoEditorSubjectModel = {
  /** An https URL that ends with `/`; each file path is relative to it. */
  baseUrl: string
  files: { encoder: PhotoEditorModelFile; decoder: PhotoEditorModelFile }
}

// The client verifies the size and hash of each file before it runs it. A
// self-hosted base URL must serve these exact files.
export const PHOTO_MASK_MODEL_FILES: PhotoEditorSubjectModel['files'] = {
  encoder: {
    path: 'onnx/vision_encoder_quantized.onnx',
    bytes: 8_882_165,
    sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971'
  },
  decoder: {
    path: 'onnx/prompt_encoder_mask_decoder_quantized.onnx',
    bytes: 4_903_810,
    sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2'
  }
}

/** The vision model behind AI enhance: the alt text endpoint and key. */
export type PhotoEditorEnhanceConfig = {
  endpoint: string
  apiKey: string
  model: string
}

export type PhotoEditorConfig = {
  /** Null when Select subject is off; the brush works either way. */
  subjectModel: PhotoEditorSubjectModel | null
  /** The origins the browser fetches the model from; empty when off. */
  connectOrigins: string[]
  /**
   * Null when AI enhance is off or the alt text endpoint is not configured.
   * Only set when the caller passes the alt text config (the CSP builder does
   * not, and does not need it).
   */
  enhance: PhotoEditorEnhanceConfig | null
}

type ModelConfig = Omit<PhotoEditorConfig, 'enhance'>

const OFF: ModelConfig = { subjectModel: null, connectOrigins: [] }

const withFiles = (baseUrl: string): PhotoEditorSubjectModel => ({
  baseUrl,
  files: {
    encoder: { ...PHOTO_MASK_MODEL_FILES.encoder },
    decoder: { ...PHOTO_MASK_MODEL_FILES.decoder }
  }
})

// A custom base URL: https, no credentials, no query or fragment (the file
// paths are appended to it), and a trailing `/`. Null when it is not one.
const parseBaseUrl = (raw: string): URL | null => {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.search || url.hash || raw.includes('?') || raw.includes('#')) {
      return null
    }
    if (!url.hostname.includes('.')) return null
    if (!url.pathname.endsWith('/')) return null
    return url
  } catch {
    return null
  }
}

export type GetPhotoEditorConfigOptions = {
  /** Called with a message when the configured value is invalid. */
  onInvalid?: (message: string) => void
  /**
   * The alt text vision endpoint (`getAltTextConfig()?.altText`) that AI
   * enhance reuses. Without it, `enhance` is null.
   */
  altText?: PhotoEditorEnhanceConfig | null
}

// The same derivation as `lib/config/gallery.ts` uses for subject suggestions:
// the alt text endpoint and key, a model override, and `off`.
const getEnhanceConfig = (
  altText: PhotoEditorEnhanceConfig | null | undefined
): PhotoEditorEnhanceConfig | null => {
  const override = process.env.ACTIVITIES_PHOTO_ENHANCE_MODEL?.trim()
  if (!altText || override?.toLowerCase() === 'off') return null
  return {
    endpoint: altText.endpoint,
    apiKey: altText.apiKey,
    model: override || altText.model
  }
}

// The subject model: see `getPhotoEditorConfig` for the accepted values.
const getModelConfig = (
  onInvalid: GetPhotoEditorConfigOptions['onInvalid']
): ModelConfig => {
  const raw = process.env.ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL?.trim() ?? ''
  if (!raw) {
    return {
      subjectModel: withFiles(DEFAULT_PHOTO_MASK_MODEL_BASE_URL),
      connectOrigins: [...DEFAULT_PHOTO_MASK_MODEL_CONNECT_ORIGINS]
    }
  }
  if (raw.toLowerCase() === 'off') return OFF

  const url = parseBaseUrl(raw)
  if (!url) {
    onInvalid?.(
      `${PHOTO_MASK_MODEL_BASE_URL_ENV} must be an https URL without credentials that ends with "/", or "off"; Select subject is turned off`
    )
    return OFF
  }

  if (url.href === DEFAULT_PHOTO_MASK_MODEL_BASE_URL) {
    return {
      subjectModel: withFiles(DEFAULT_PHOTO_MASK_MODEL_BASE_URL),
      connectOrigins: [...DEFAULT_PHOTO_MASK_MODEL_CONNECT_ORIGINS]
    }
  }
  return { subjectModel: withFiles(url.href), connectOrigins: [url.origin] }
}

/**
 * Reads `ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL` and `ACTIVITIES_PHOTO_ENHANCE_MODEL`
 * at runtime.
 *
 * AI enhance (`enhance`): the alt text vision endpoint and key, with
 * `ACTIVITIES_PHOTO_ENHANCE_MODEL` overriding the model and `off` disabling
 * it; null when there is no alt text configuration.
 *
 * Select subject (`subjectModel`):
 *
 * - unset or blank: the pinned Hugging Face revision;
 * - `off`: no subject model (Select subject is hidden; the brush still works);
 * - an https URL without credentials that ends with `/`: that server, which
 *   must serve the same files;
 * - anything else: treated as `off`, and `onInvalid` is told why.
 */
export const getPhotoEditorConfig = ({
  onInvalid,
  altText
}: GetPhotoEditorConfigOptions = {}): PhotoEditorConfig => ({
  ...getModelConfig(onInvalid),
  enhance: getEnhanceConfig(altText)
})
