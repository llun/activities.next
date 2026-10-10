const MINUS = '−'

const signed = (value: number, text: string) =>
  value > 0 ? `+${text}` : value < 0 ? `${MINUS}${text}` : text

/** Exposure as "+0.35" / "−0.35" / "0.00" (EV). */
export const formatExposure = (value: number): string =>
  signed(value, Math.abs(value).toFixed(2))

/** Every other slider as a signed integer: "+12", "−8", "0". */
export const formatSigned = (value: number): string =>
  signed(value, String(Math.abs(Math.round(value))))

/** Straighten as "−1.5°". */
export const formatStraighten = (value: number): string =>
  signed(value, `${Math.abs(value).toFixed(1)}°`)

export const formatStraightenSpoken = (value: number): string =>
  signed(value, `${Math.abs(value).toFixed(1)} degrees`)
