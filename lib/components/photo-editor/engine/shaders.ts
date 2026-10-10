import { FINE_KERNEL_1D, SHADER_CONSTANTS } from './colour'

/** A number as a GLSL float literal (always has a decimal point or exponent). */
export const glFloat = (value: number): string => {
  const text = String(value)
  return /[.e]/i.test(text) ? text : `${text}.0`
}

const constants = Object.entries(SHADER_CONSTANTS)
  .map(([name, value]) => `const float ${name} = ${glFloat(value)};`)
  .join('\n')

const kernel = FINE_KERNEL_1D.map(glFloat).join(', ')

/** A full screen triangle; the fragment shaders work from `gl_FragCoord`. */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

const COLOUR_FUNCTIONS = `
${constants}

float srgbToLin1(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
float linToSrgb1(float c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
vec3 srgbToLin(vec3 c) {
  return vec3(srgbToLin1(c.r), srgbToLin1(c.g), srgbToLin1(c.b));
}
vec3 linToSrgb(vec3 c) {
  return vec3(linToSrgb1(c.r), linToSrgb1(c.g), linToSrgb1(c.b));
}
float lumaOf(vec3 c) {
  return LUMA_R * c.r + LUMA_G * c.g + LUMA_B * c.b;
}
`

/**
 * Pass 1 (uFirst = 1) turns the colour frame into perceptual luma and blurs
 * it horizontally; pass 2 blurs vertically. R holds the clarity (mid) blur,
 * G the highlights / shadows (tone) blur.
 */
export const BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
${COLOUR_FUNCTIONS}
const int MAX_RADIUS = 128;
uniform sampler2D uSrc;
uniform vec2 uStep;
uniform float uSigmaMid;
uniform float uSigmaTone;
uniform float uFirst;
out vec4 outColour;

float perceptual(vec3 c) {
  return linToSrgb1(lumaOf(srgbToLin(c)));
}

void main() {
  vec2 size = vec2(textureSize(uSrc, 0));
  vec2 uv = gl_FragCoord.xy / size;
  int radius = min(MAX_RADIUS, int(ceil(3.0 * max(uSigmaTone, uSigmaMid))));
  float sumMid = 0.0;
  float sumTone = 0.0;
  float weightMid = 0.0;
  float weightTone = 0.0;
  for (int i = -MAX_RADIUS; i <= MAX_RADIUS; i++) {
    if (abs(i) > radius) continue;
    float fi = float(i);
    vec4 s = texture(uSrc, uv + uStep * fi);
    float vMid = uFirst > 0.5 ? perceptual(s.rgb) : s.r;
    float vTone = uFirst > 0.5 ? vMid : s.g;
    float wMid = exp(-fi * fi / (2.0 * uSigmaMid * uSigmaMid));
    float wTone = exp(-fi * fi / (2.0 * uSigmaTone * uSigmaTone));
    sumMid += vMid * wMid;
    sumTone += vTone * wTone;
    weightMid += wMid;
    weightTone += wTone;
  }
  outColour = vec4(sumMid / weightMid, sumTone / weightTone, 0.0, 1.0);
}
`

/** How many masks the colour pass can hold (MAX_MASKS in the recipe). */
export const SHADER_MASK_COUNT = 4

/**
 * Per-mask sliders in `uMaskAdj`: three vec4 per mask, in this order.
 * [exposure, temperature, tint, whites], [blacks, shadows, highlights,
 * contrast], [texture, clarity, saturation, vibrance] (all /100 but exposure).
 */
export const MASK_UNIFORM_VEC4S_PER_MASK = 3

/**
 * Blurs the packed mask frame (R, G, B, A are masks 0..3) with one gaussian
 * sigma per channel, in frame pixels. Run twice, horizontal then vertical.
 * Each channel's kernel is cut at ceil(3 sigma), with a sigma of 0 meaning no
 * blur, and the edge texel repeats past the frame.
 */
export const MASK_BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
const int MAX_RADIUS = 96;
uniform sampler2D uSrc;
uniform vec2 uStep;
uniform vec4 uSigma;
out vec4 outColour;

void main() {
  vec2 size = vec2(textureSize(uSrc, 0));
  vec2 uv = gl_FragCoord.xy / size;
  vec4 reach = ceil(3.0 * uSigma);
  float widest = max(max(reach.x, reach.y), max(reach.z, reach.w));
  int radius = min(MAX_RADIUS, int(widest));
  vec4 variance = max(2.0 * uSigma * uSigma, vec4(1e-6));
  vec4 sum = vec4(0.0);
  vec4 weight = vec4(0.0);
  for (int i = -MAX_RADIUS; i <= MAX_RADIUS; i++) {
    if (abs(i) > radius) continue;
    float fi = float(i);
    vec4 w = step(vec4(abs(fi)), reach) * exp(-fi * fi / variance);
    sum += texture(uSrc, uv + uStep * fi) * w;
    weight += w;
  }
  outColour = sum / weight;
}
`

/** The colour pass. Mirrors `applyAdjustmentsWithMasks` in adjustments.ts. */
export const MAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;
${COLOUR_FUNCTIONS}
const float FINE_KERNEL[5] = float[5](${kernel});
const int MASK_COUNT = ${SHADER_MASK_COUNT};
uniform sampler2D uImage;
uniform sampler2D uBlur;
// The feathered masks, one per channel, in output space.
uniform sampler2D uMask;
// The rect of the output this framebuffer holds (the tile plus its halo).
uniform vec2 uTileOrigin;
uniform vec2 uTileSize;
uniform vec2 uOutputSize;
// Where uImage sits in the output: all of it, or just this tile.
uniform vec2 uImageOrigin;
uniform vec2 uImageSize;
// 1 when drawing to the canvas (rows run bottom up), 0 when reading back.
uniform float uFlipY;
uniform float uExposure;
uniform float uTemperature;
uniform float uTint;
uniform float uWhites;
uniform float uBlacks;
uniform float uShadows;
uniform float uHighlights;
uniform float uContrast;
uniform float uTexture;
uniform float uClarity;
uniform float uSaturation;
uniform float uVibrance;
uniform float uVignette;
// Masks: which channels have sliders set, and those sliders.
uniform vec4 uMaskOn;
uniform vec4 uMaskAdj[${SHADER_MASK_COUNT * MASK_UNIFORM_VEC4S_PER_MASK}];
// The overlay tint: the channel to show (-1 for none), colour and strength.
uniform float uOverlayChannel;
uniform vec3 uOverlayColour;
uniform float uOverlayAlpha;
out vec4 outColour;

struct Adj {
  float exposure;
  float temperature;
  float tint;
  float whites;
  float blacks;
  float shadows;
  float highlights;
  float contrast;
  float tex;
  float clar;
  float saturation;
  float vibrance;
};

vec3 scaleLuma(vec3 p, float y) {
  float s = max(y, 0.0) / max(lumaOf(p), MIN_LUMA);
  vec3 q = p * s;
  float cap = max(1.0, max(p.r, max(p.g, p.b)));
  float largest = max(q.r, max(q.g, q.b));
  if (largest > cap) q *= cap / largest;
  return q;
}

// White balance gain with brightness held (step 2).
vec3 whiteBalance(Adj a) {
  vec3 wb = vec3(
    1.0 + WB_TEMPERATURE_GAIN * a.temperature,
    1.0 - WB_TINT_GAIN * a.tint,
    1.0 - WB_TEMPERATURE_GAIN * a.temperature
  );
  return wb / lumaOf(wb);
}

// The blurred luma, taken through steps 2-5 (the grey keeps its luma).
float toneOf(float blurred, Adj a) {
  float wp = 1.0 - WHITES_RANGE * a.whites;
  float bp = -BLACKS_RANGE * a.blacks;
  return (linToSrgb1(srgbToLin1(blurred) * exp2(a.exposure)) - bp) / (wp - bp);
}

vec3 toStep7(vec3 rgb, float T, Adj a) {
  float wp = 1.0 - WHITES_RANGE * a.whites;
  float bp = -BLACKS_RANGE * a.blacks;
  vec3 p = linToSrgb(srgbToLin(rgb) * whiteBalance(a) * exp2(a.exposure));
  p = (p - bp) / (wp - bp);
  float ws = 1.0 - smoothstep(0.0, TONE_SHADOW_EDGE, T);
  float wh = smoothstep(TONE_HIGHLIGHT_EDGE, 1.0, T);
  float Y = lumaOf(p);
  float y1 = Y + TONE_STRENGTH * a.shadows * ws
    * (a.shadows > 0.0 ? clamp(1.0 - Y, 0.0, 1.0) : Y);
  float y2 = y1 + TONE_STRENGTH * a.highlights * wh
    * (a.highlights > 0.0 ? clamp(1.0 - y1, 0.0, 1.0) : y1);
  p = scaleLuma(p, y2);
  p = clamp(p, 0.0, 1.0);
  vec3 s = p * p * (3.0 - 2.0 * p);
  return a.contrast >= 0.0 ? mix(p, s, a.contrast) : mix(p, 2.0 * p - s, -a.contrast);
}

// Saturation, then vibrance (step 9).
vec3 saturate(vec3 p, Adj a) {
  float Ys = lumaOf(p);
  p = Ys + (p - Ys) * (1.0 + a.saturation);
  float chroma = max(p.r, max(p.g, p.b)) - min(p.r, min(p.g, p.b));
  float amount = a.vibrance > 0.0 ? a.vibrance * (1.0 - chroma) : a.vibrance;
  float Yv = lumaOf(p);
  return Yv + (p - Yv) * (1.0 + amount);
}

float detailTerm(float Y, float detailFine, float detailMid, Adj a) {
  return TEXTURE_GAIN * a.tex * detailFine
    + CLARITY_GAIN * a.clar * detailMid * (1.0 - (2.0 * Y - 1.0) * (2.0 * Y - 1.0));
}

Adj maskAdj(int i) {
  vec4 a = uMaskAdj[i * 3];
  vec4 b = uMaskAdj[i * 3 + 1];
  vec4 c = uMaskAdj[i * 3 + 2];
  return Adj(a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, c.x, c.y, c.z, c.w);
}

void main() {
  float fragY = uFlipY > 0.5 ? uTileSize.y - 1.0 - floor(gl_FragCoord.y) : floor(gl_FragCoord.y);
  vec2 outPx = uTileOrigin + vec2(floor(gl_FragCoord.x), fragY) + 0.5;
  vec2 imageUv = (outPx - uImageOrigin) / uImageSize;
  vec3 rgb = texture(uImage, imageUv).rgb;

  Adj g = Adj(
    uExposure, uTemperature, uTint, uWhites, uBlacks, uShadows, uHighlights,
    uContrast, uTexture, uClarity, uSaturation, uVibrance
  );

  vec2 blur = texture(uBlur, outPx / uOutputSize).rg;
  float T = toneOf(blur.g, g);

  // Fine neighbourhood: gaussian 5x5 of the raw texels.
  vec2 texel = 1.0 / uImageSize;
  vec3 fine = vec3(0.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      fine += texture(uImage, imageUv + vec2(float(i), float(j)) * texel).rgb
        * FINE_KERNEL[i + 2] * FINE_KERNEL[j + 2];
    }
  }

  vec3 p = toStep7(rgb, T, g);
  vec3 fine7 = toStep7(fine, T, g);
  vec3 mid7 = toStep7(vec3(blur.r), T, g);

  // Detail (step 8).
  float Y = lumaOf(p);
  float detailFine = Y - lumaOf(fine7);
  float detailMid = Y - lumaOf(mid7);
  p = scaleLuma(p, Y + detailTerm(Y, detailFine, detailMid, g));

  // Saturation, then vibrance (step 9).
  p = saturate(p, g);

  // Vignette in linear light (step 10).
  vec2 uv = outPx / uOutputSize;
  float r = length((uv - 0.5) / 0.5) / sqrt(2.0);
  float v = smoothstep(VIGNETTE_START, VIGNETTE_END, r);
  p = linToSrgb(srgbToLin(p) * exp2(VIGNETTE_STRENGTH * uVignette * v));

  vec3 result = clamp(p, 0.0, 1.0);

  // Masks: out = mix(out, adjust(out, mask), m), in recipe order. A mask
  // reuses the global tone value and detail terms.
  vec4 masks = texture(uMask, uv);
  for (int i = 0; i < MASK_COUNT; i++) {
    if (uMaskOn[i] < 0.5 || masks[i] <= 0.0) continue;
    Adj a = maskAdj(i);
    vec3 q = toStep7(result, T, a);
    float Yq = lumaOf(q);
    q = scaleLuma(q, Yq + detailTerm(Yq, detailFine, detailMid, a));
    q = clamp(saturate(q, a), 0.0, 1.0);
    result = mix(result, q, masks[i]);
  }

  if (uOverlayChannel > -0.5) {
    float m = masks[int(uOverlayChannel + 0.5)];
    result = mix(result, uOverlayColour, uOverlayAlpha * m);
  }

  outColour = vec4(result, 1.0);
}
`
