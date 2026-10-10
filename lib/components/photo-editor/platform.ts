/** True on Apple platforms, where shortcuts use Cmd instead of Ctrl. */
export const isApplePlatform = (): boolean => {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

/** "Ctrl+Z" or "⌘Z" for the tooltip of a shortcut. */
export const shortcutLabel = (
  keys: string,
  apple = isApplePlatform()
): string =>
  apple ? keys.replace(/Ctrl\+Shift\+/, '⇧⌘').replace(/Ctrl\+/, '⌘') : keys
