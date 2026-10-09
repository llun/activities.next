import { vi } from 'vitest'

// Kept apart from the testUtils module on purpose: the vi.mock factories load
// this file, and testUtils imports the component under test, which would make
// a factory wait on a module that is itself waiting on that factory.

export const mockPush = vi.fn()
export const mockRefresh = vi.fn()

// The MapKit surface is the one map path that is a component rather than an
// imperative GL handle, so it is where a test can read back the instant the
// page is asking the map to highlight.
export const MockActivityRouteMapKit = ({
  highlightedElapsedSeconds
}: {
  highlightedElapsedSeconds?: number | null
}) => (
  <div
    data-testid="route-map"
    data-highlighted-elapsed-seconds={
      typeof highlightedElapsedSeconds === 'number'
        ? String(highlightedElapsedSeconds)
        : ''
    }
  />
)

export const MockPost = ({
  status,
  onOpenStatus
}: {
  status: { id: string }
  onOpenStatus?: (status: { id: string }) => void
}) => (
  <div data-testid="reply-post">
    {status.id}
    {onOpenStatus && (
      <button
        type="button"
        data-testid={`open-reply-${status.id}`}
        onClick={() => onOpenStatus(status)}
      >
        Open
      </button>
    )}
  </div>
)

// Stubbed for the same reason `BrandedDeviceLink` is: this page only has to
// open the shared composer in the right mode against the right status and put
// it in the right place. What each mode renders is
// `lib/components/posts/inline-status-composer.test.tsx`'s job.
export const MockInlineStatusComposer = ({
  mode,
  status,
  onCancel
}: {
  mode: string
  status: { id: string }
  onCancel: () => void
}) => (
  <div
    data-testid="inline-status-composer"
    data-mode={mode}
    data-status-id={status.id}
  >
    <button type="button" onClick={onCancel}>
      Cancel
    </button>
  </div>
)

interface MockPostMenuSubItem {
  key: string
  label: string
  checked: boolean
  trailing?: string
  disabled?: boolean
}

interface MockPostMenuExtraItem {
  key: string
  label: string
  disabled?: boolean
  items?: Array<MockPostMenuSubItem & { onSelect: () => void }>
  onSelect?: () => void
}

// Flattened rather than driven as a real Radix menu: what this page owns is
// WHICH items it hands the shared ⋯ and what selecting one does, while the menu
// chrome itself (submenu trigger, check marks, focus handling) is pinned in
// `lib/components/posts/actions/post-menu.test.tsx`. The items render as
// role-bearing divs, which is what Radix emits for a `DropdownMenuItem` — so
// they stay out of the action row's own button list.
export const MockPostMenu = ({
  status,
  canEdit,
  extraItems,
  onEdit,
  onQuote
}: {
  status: { id: string }
  canEdit?: boolean
  extraItems?: MockPostMenuExtraItem[]
  onEdit?: (status: unknown) => void
  onQuote?: (status: unknown) => void
}) => (
  <div data-testid="post-menu">
    <button type="button">More</button>
    {canEdit ? (
      <div role="menuitem" tabIndex={0} onClick={() => onEdit?.(status)}>
        Edit post
      </div>
    ) : null}
    {onQuote ? (
      <div role="menuitem" tabIndex={0} onClick={() => onQuote(status)}>
        Quote post
      </div>
    ) : null}
    {(extraItems ?? []).map((item) =>
      item.items ? (
        <div key={item.key} data-testid={`post-menu-submenu-${item.key}`}>
          <div role="menuitem" tabIndex={0} aria-disabled={item.disabled}>
            {item.label}
          </div>
          {item.items.map((subItem) => (
            <div
              key={subItem.key}
              role="menuitemradio"
              tabIndex={0}
              aria-checked={subItem.checked}
              aria-disabled={subItem.disabled}
              onClick={() => {
                if (subItem.disabled) return
                subItem.onSelect()
              }}
            >
              {subItem.label}
              {subItem.trailing ? <span>{subItem.trailing}</span> : null}
            </div>
          ))}
        </div>
      ) : (
        <div
          key={item.key}
          role="menuitem"
          tabIndex={0}
          aria-disabled={item.disabled}
          onClick={() => item.onSelect?.()}
        >
          {item.label}
        </div>
      )
    )}
  </div>
)

// Stubbed rather than rendered: this page only has to forward the right props
// to it. Where each of the three renderings actually goes is asserted in
// `lib/components/posts/BrandedDeviceLink.test.tsx`.
export const MockBrandedDeviceLink = (props: {
  deviceName?: string | null
  deviceGearId?: string | null
  deviceGearName?: string | null
  isOwner?: boolean
}) => (
  <span
    data-testid="branded-device-link"
    data-device-name={props.deviceName ?? ''}
    data-device-gear-id={props.deviceGearId ?? ''}
    data-device-gear-name={props.deviceGearName ?? ''}
    data-is-owner={String(Boolean(props.isOwner))}
  >
    device
  </span>
)
