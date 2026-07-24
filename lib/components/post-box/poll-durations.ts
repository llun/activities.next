// The poll durations the composer offers.
//
// Deliberately NOT a `'use client'` module, and deliberately not inlined into
// `poll-choices.tsx`: the outbox request schema
// (app/api/v1/accounts/outbox/types.ts) validates `durationInSeconds` against
// this list, and that schema is evaluated on the server. Importing a runtime
// value out of a `'use client'` module gives the server a client reference
// rather than the object, so `Object.keys(...)` comes back empty and every
// duration fails validation.
export const DEFAULT_DURATION = 86_400

export const SecondsToDurationText = {
  300: '5 minutes',
  1_800: '30 minutes',
  3_600: '1 hour',
  21_600: '6 hours',
  43_200: '12 hours',
  86_400: '1 day',
  259_200: '3 days',
  604_800: '7 days'
}

export type Duration = keyof typeof SecondsToDurationText

export const DURATIONS = Object.keys(SecondsToDurationText).map(
  (seconds) => parseInt(seconds, 10) as Duration
)
