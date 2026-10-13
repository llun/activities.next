import {
  DEFAULT_PHOTO_MASK_MODEL_BASE_URL,
  PHOTO_MASK_MODEL_FILES,
  getPhotoEditorConfig
} from './photoEditor'

const KEY = 'ACTIVITIES_PHOTO_MASK_MODEL_BASE_URL'

const FILES = {
  encoder: {
    path: 'onnx/vision_encoder_quantized.onnx',
    bytes: 8882165,
    sha256: 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971'
  },
  decoder: {
    path: 'onnx/prompt_encoder_mask_decoder_quantized.onnx',
    bytes: 4903810,
    sha256: 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2'
  }
}

const HF_DEFAULT = {
  subjectModel: {
    baseUrl:
      'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/',
    files: FILES
  },
  connectOrigins: ['https://huggingface.co', 'https://*.hf.co']
}

describe('getPhotoEditorConfig', () => {
  const original = process.env[KEY]

  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  const withValue = (value: string | undefined) => {
    if (value === undefined) delete process.env[KEY]
    else process.env[KEY] = value
    const onInvalid = vi.fn()
    return { config: getPhotoEditorConfig({ onInvalid }), onInvalid }
  }

  it('pins the model files the client verifies', () => {
    expect(PHOTO_MASK_MODEL_FILES).toEqual(FILES)
    expect(DEFAULT_PHOTO_MASK_MODEL_BASE_URL).toBe(
      HF_DEFAULT.subjectModel.baseUrl
    )
  })

  it.each([
    ['unset', undefined],
    ['blank', '  '],
    ['the default URL spelled out', HF_DEFAULT.subjectModel.baseUrl]
  ])('uses the pinned Hugging Face revision when %s', (_, value) => {
    const { config, onInvalid } = withValue(value)
    expect(config).toEqual(HF_DEFAULT)
    expect(onInvalid).not.toHaveBeenCalled()
  })

  it.each(['off', 'OFF', ' Off '])('turns the model off for %j', (value) => {
    const { config, onInvalid } = withValue(value)
    expect(config).toEqual({
      subjectModel: null,
      connectOrigins: []
    })
    expect(onInvalid).not.toHaveBeenCalled()
  })

  it.each([
    ['a self-hosted https base', 'https://models.example.com/slimsam/'],
    ['a base with a port', 'https://models.example.com:8443/m/']
  ])('serves %s with its origin only', (_, value) => {
    const { config, onInvalid } = withValue(value)
    expect(config).toEqual({
      subjectModel: { baseUrl: value, files: FILES },
      connectOrigins: [new URL(value).origin]
    })
    expect(onInvalid).not.toHaveBeenCalled()
  })

  it.each([
    ['not a URL', 'not a url'],
    ['http', 'http://models.example.com/slimsam/'],
    ['credentials', 'https://user:secret@models.example.com/slimsam/'],
    ['no trailing slash', 'https://models.example.com/slimsam'],
    ['a query', 'https://models.example.com/slimsam/?token=1'],
    ['a fragment', 'https://models.example.com/slimsam/#x'],
    ['a single-label host', 'https://models/slimsam/'],
    ['another scheme', 'javascript:alert(1)//']
  ])('treats %s as off and reports it', (_, value) => {
    const { config, onInvalid } = withValue(value)
    expect(config).toEqual({
      subjectModel: null,
      connectOrigins: []
    })
    expect(onInvalid).toHaveBeenCalledTimes(1)
    expect(onInvalid.mock.calls[0][0]).toContain(KEY)
  })

  it('returns copies the caller cannot use to change the constants', () => {
    const { config } = withValue(undefined)
    config.subjectModel!.files.encoder.bytes = 1
    config.connectOrigins.push('https://evil.example.com')
    expect(getPhotoEditorConfig()).toEqual(HF_DEFAULT)
  })
})
