// Shared by the profile page and its loading skeleton through `ProfileCover`;
// dependency-free and directive-less so any module can read it.

// Signed in, below `md` the cover is full-bleed and square, so it meets the top
// and both edges of the viewport. From `md` up it is a rounded box in the
// column.
export const PROFILE_COVER_MOBILE_CLASS =
  'max-md:mx-[calc(50%_-_50vw)] max-md:w-auto max-md:rounded-none'
