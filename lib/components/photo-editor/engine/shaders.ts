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

/** The colour pass. Mirrors `applyAdjustments` in adjustments.ts. */
export const MAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;
${COLOUR_FUNCTIONS}
const float FINE_KERNEL[5] = float[5](${kernel});
uniform sampler2D uImage;
uniform sampler2D uBlur;
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
out vec4 outColour;

vec3 scaleLuma(vec3 p, float y) {
  float s = max(y, 0.0) / max(lumaOf(p), MIN_LUMA);
  vec3 q = p * s;
  float cap = max(1.0, max(p.r, max(p.g, p.b)));
  float largest = max(q.r, max(q.g, q.b));
  if (largest > cap) q *= cap / largest;
  return q;
}

vec3 toStep7(vec3 rgb, float T, vec3 wb, float wp, float bp) {
  vec3 p = linToSrgb(srgbToLin(rgb) * wb * exp2(uExposure));
  p = (p - bp) / (wp - bp);
  float ws = 1.0 - smoothstep(0.0, TONE_SHADOW_EDGE, T);
  float wh = smoothstep(TONE_HIGHLIGHT_EDGE, 1.0, T);
  float Y = lumaOf(p);
  float y1 = Y + TONE_STRENGTH * uShadows * ws
    * (uShadows > 0.0 ? clamp(1.0 - Y, 0.0, 1.0) : Y);
  float y2 = y1 + TONE_STRENGTH * uHighlights * wh
    * (uHighlights > 0.0 ? clamp(1.0 - y1, 0.0, 1.0) : y1);
  p = scaleLuma(p, y2);
  p = clamp(p, 0.0, 1.0);
  vec3 s = p * p * (3.0 - 2.0 * p);
  return uContrast >= 0.0 ? mix(p, s, uContrast) : mix(p, 2.0 * p - s, -uContrast);
}

void main() {
  float fragY = uFlipY > 0.5 ? uTileSize.y - 1.0 - floor(gl_FragCoord.y) : floor(gl_FragCoord.y);
  vec2 outPx = uTileOrigin + vec2(floor(gl_FragCoord.x), fragY) + 0.5;
  vec2 imageUv = (outPx - uImageOrigin) / uImageSize;
  vec3 rgb = texture(uImage, imageUv).rgb;

  // White balance gain with brightness held (step 2).
  vec3 wb = vec3(
    1.0 + WB_TEMPERATURE_GAIN * uTemperature,
    1.0 - WB_TINT_GAIN * uTint,
    1.0 - WB_TEMPERATURE_GAIN * uTemperature
  );
  wb /= lumaOf(wb);
  float wp = 1.0 - WHITES_RANGE * uWhites;
  float bp = -BLACKS_RANGE * uBlacks;

  // The blurred luma, taken through steps 2-5 (the grey keeps its luma).
  vec2 blur = texture(uBlur, outPx / uOutputSize).rg;
  float T = (linToSrgb1(srgbToLin1(blur.g) * exp2(uExposure)) - bp) / (wp - bp);

  // Fine neighbourhood: gaussian 5x5 of the raw texels.
  vec2 texel = 1.0 / uImageSize;
  vec3 fine = vec3(0.0);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      fine += texture(uImage, imageUv + vec2(float(i), float(j)) * texel).rgb
        * FINE_KERNEL[i + 2] * FINE_KERNEL[j + 2];
    }
  }

  vec3 p = toStep7(rgb, T, wb, wp, bp);
  vec3 fine7 = toStep7(fine, T, wb, wp, bp);
  vec3 mid7 = toStep7(vec3(blur.r), T, wb, wp, bp);

  // Detail (step 8).
  float Y = lumaOf(p);
  float detailFine = Y - lumaOf(fine7);
  float detailMid = Y - lumaOf(mid7);
  float d = TEXTURE_GAIN * uTexture * detailFine
    + CLARITY_GAIN * uClarity * detailMid * (1.0 - (2.0 * Y - 1.0) * (2.0 * Y - 1.0));
  p = scaleLuma(p, Y + d);

  // Saturation, then vibrance (step 9).
  float Ys = lumaOf(p);
  p = Ys + (p - Ys) * (1.0 + uSaturation);
  float chroma = max(p.r, max(p.g, p.b)) - min(p.r, min(p.g, p.b));
  float amount = uVibrance > 0.0 ? uVibrance * (1.0 - chroma) : uVibrance;
  float Yv = lumaOf(p);
  p = Yv + (p - Yv) * (1.0 + amount);

  // Vignette in linear light (step 10).
  vec2 uv = outPx / uOutputSize;
  float r = length((uv - 0.5) / 0.5) / sqrt(2.0);
  float v = smoothstep(VIGNETTE_START, VIGNETTE_END, r);
  p = linToSrgb(srgbToLin(p) * exp2(VIGNETTE_STRENGTH * uVignette * v));

  outColour = vec4(clamp(p, 0.0, 1.0), 1.0);
}
`
