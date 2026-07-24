// The poll durations the composer offers, and the list the outbox request
// schema validates `durationInSeconds` against.
//
// It lives here, next to `contentLimits`, rather than beside the poll editor
// because the schema that consumes it (app/api/v1/accounts/outbox/types.ts)
// runs on the server. It used to be exported from the `'use client'` poll
// editor, and importing a runtime value out of a client module gives the server
// a client reference rather than the object — `Object.keys(...)` came back
// empty and every duration failed validation. Keep this module free of
// client-only imports so both sides can read it.
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
