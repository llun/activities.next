/**
 * The DOM marker both gallery map engines draw: a round thumbnail with a white
 * ring and, for a cluster, a count badge. MapLibre / Mapbox take it as a
 * `Marker` element and MapKit as the element of a custom annotation, so the
 * look lives here once.
 *
 * MapKit anchors an annotation element by its bottom centre and the GL marker
 * by its centre. Both land on the coordinate when the outer node is a
 * zero-sized box and the visible circle is translated onto its origin (the same
 * trick as `createRouteHighlightElement`), so no anchor offset — and no
 * `DOMPoint` — is needed.
 */

const SINGLE_SIZE_PX = 40
const CLUSTER_SIZE_PX = 48
const BADGE_COLOR = '#e55f06'
const PLACEHOLDER_COLOR = '#d4d4d8'

export interface GalleryMarkerOptions {
  thumbnailUrl: string | null
  /** 1 for a single photo; more for a cluster, which gets the count badge. */
  count: number
  /** Accessible name of the marker button. */
  label: string
  onClick: () => void
}

export const createGalleryMarkerElement = ({
  thumbnailUrl,
  count,
  label,
  onClick
}: GalleryMarkerOptions): HTMLElement => {
  const size = count > 1 ? CLUSTER_SIZE_PX : SINGLE_SIZE_PX

  const anchor = document.createElement('div')
  anchor.style.position = 'relative'
  anchor.style.width = '0px'
  anchor.style.height = '0px'
  anchor.style.overflow = 'visible'

  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', label)
  button.dataset.galleryMarker = count > 1 ? 'cluster' : 'point'
  button.style.position = 'absolute'
  button.style.left = '0px'
  button.style.top = '0px'
  button.style.width = `${size}px`
  button.style.height = `${size}px`
  button.style.padding = '0'
  button.style.border = '2px solid #ffffff'
  button.style.borderRadius = '9999px'
  button.style.backgroundColor = PLACEHOLDER_COLOR
  button.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.35)'
  button.style.cursor = 'pointer'
  button.style.transform = 'translate(-50%, -50%)'

  if (thumbnailUrl) {
    const image = document.createElement('img')
    image.src = thumbnailUrl
    image.alt = ''
    image.draggable = false
    image.style.width = '100%'
    image.style.height = '100%'
    image.style.borderRadius = '9999px'
    image.style.objectFit = 'cover'
    image.style.display = 'block'
    button.appendChild(image)
  }

  if (count > 1) {
    const badge = document.createElement('span')
    badge.textContent = String(count)
    badge.dataset.galleryMarkerCount = 'true'
    badge.style.position = 'absolute'
    badge.style.right = '-6px'
    badge.style.top = '-6px'
    badge.style.minWidth = '20px'
    badge.style.height = '20px'
    badge.style.padding = '0 5px'
    badge.style.boxSizing = 'border-box'
    badge.style.borderRadius = '9999px'
    badge.style.backgroundColor = BADGE_COLOR
    badge.style.color = '#ffffff'
    badge.style.font = '600 11px/20px system-ui, sans-serif'
    badge.style.textAlign = 'center'
    button.appendChild(badge)
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation()
    onClick()
  })

  anchor.appendChild(button)
  return anchor
}
