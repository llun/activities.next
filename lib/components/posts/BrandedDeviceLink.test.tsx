/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

import { BrandedDeviceLink } from './BrandedDeviceLink'

// next/link swallows `prefetch` instead of reflecting it in the DOM, so the
// only way to assert on it is to render the prop ourselves.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string
    prefetch?: boolean | 'auto' | null
    children: ReactNode
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  )
}))

describe('BrandedDeviceLink', () => {
  describe('the owner', () => {
    it('links the device to its own page', () => {
      render(
        <BrandedDeviceLink
          deviceName="Garmin Edge 840"
          deviceManufacturer="garmin"
          deviceGearId="device-1"
          deviceGearName="the Edge"
          isOwner
        />
      )

      // The row's editable name wins over the recorded one.
      const link = screen.getByRole('link', { name: 'the Edge' })
      expect(link).toHaveAttribute('href', '/fitness/gear/device-1')
      // Same-origin, so no target and no brand colour.
      expect(link).not.toHaveAttribute('target')
      expect(link).not.toHaveAttribute('style')
    })

    it('does not prefetch — it renders once per post in a feed', () => {
      render(
        <BrandedDeviceLink
          deviceName="Garmin Edge 840"
          deviceGearId="device-1"
          isOwner
        />
      )

      expect(screen.getByRole('link')).toHaveAttribute('data-prefetch', 'false')
    })

    it('percent-encodes the gear id in the href', () => {
      render(
        <BrandedDeviceLink
          deviceName="Garmin Edge 840"
          deviceGearId="device/1 2"
          isOwner
        />
      )

      expect(screen.getByRole('link')).toHaveAttribute(
        'href',
        '/fitness/gear/device%2F1%202'
      )
    })

    it('falls back to the manufacturer link when no row exists yet', () => {
      // History that predates the backfill, or an activity whose device the
      // brand map cannot key.
      render(
        <BrandedDeviceLink
          deviceName="Garmin Edge 840"
          deviceManufacturer="garmin"
          isOwner
        />
      )

      expect(screen.getByRole('link')).toHaveAttribute(
        'href',
        'https://www.garmin.com'
      )
    })
  })

  describe('everyone else', () => {
    it('keeps the branded manufacturer link, labelled with the gear name', () => {
      render(
        <BrandedDeviceLink
          deviceName="Garmin Edge 840"
          deviceManufacturer="garmin"
          deviceGearId="device-1"
          deviceGearName="the Edge"
        />
      )

      // `/fitness/gear/<id>` is owner-only, so a link there would 404 for them.
      const link = screen.getByRole('link', { name: 'the Edge' })
      expect(link).toHaveAttribute('href', 'https://www.garmin.com')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('renders plain text when no brand resolves', () => {
      render(
        <BrandedDeviceLink
          deviceName="Strava iPhone App"
          deviceGearId="device-1"
          deviceGearName="My phone"
        />
      )

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(screen.getByText('My phone')).toBeInTheDocument()
    })
  })

  it.each([
    {
      description: 'nothing was recorded',
      props: {}
    },
    {
      description: 'the only device field is a bare FIT code',
      props: { deviceName: '4315', deviceManufacturer: '65535' }
    },
    {
      description: 'the gear name is whitespace and nothing else resolves',
      props: { deviceGearName: '   ', deviceGearId: 'device-1', isOwner: true }
    }
  ])('renders nothing when $description', ({ props }) => {
    const { container } = render(<BrandedDeviceLink {...props} />)
    expect(container).toBeEmptyDOMElement()
  })
})
