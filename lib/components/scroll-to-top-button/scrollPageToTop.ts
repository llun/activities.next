/**
 * Scrolls the window back to the top: smoothly, unless the reader asked the
 * system for reduced motion.
 */
export const scrollPageToTop = () => {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') {
    return
  }
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion ? 'auto' : 'smooth'
  })
}
