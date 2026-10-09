// Shared by the profile page and its loading skeleton through
// `ProfileCardSection`; dependency-free and directive-less so any module can
// read it.

// Signed in, below `md` the profile card is full-bleed and square, with no top
// or side border, so the cover meets the top and both edges of the viewport.
// Only the bottom hairline stays, separating the card from the tabs below it.
export const PROFILE_CARD_MOBILE_CLASS =
  'max-md:mx-[calc(50%_-_50vw)] max-md:w-auto max-md:rounded-none max-md:border-x-0 max-md:border-t-0'
