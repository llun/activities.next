'use client'

import Link from 'next/link'
import { FC } from 'react'

import {
  getBrandFromDeviceName,
  getBrandFromManufacturer,
  getDeviceDisplayLabel
} from '@/lib/utils/fitnessDeviceBrands'

interface BrandedDeviceLinkProps {
  deviceName?: string | null
  deviceManufacturer?: string | null
  /** The `kind: 'device'` gear row this activity was recorded on, if any. */
  deviceGearId?: string | null
  /** That row's editable display name, which overrides the recorded one. */
  deviceGearName?: string | null
  /** Whether the viewer owns the activity — only they have a device page. */
  isOwner?: boolean
}

/**
 * The device an activity was recorded on, rendered three ways.
 *
 * The owner gets a link to the device's own page: their device is a thing in
 * their shed with a history and a name they chose. Everyone else gets what this
 * component always rendered — a link to the manufacturer, in the brand's colour
 * — because `/fitness/gear/<id>` is owner-only and a link to a 404 is worse
 * than the vendor link it replaced. With no brand to resolve, both fall back to
 * plain text.
 *
 * The label prefers the gear row's name over the recorded one wherever a row
 * exists, for everyone: renaming "Garmin Edge 840" to "the Edge" is a rename of
 * the device, not a private note about it.
 */
export const BrandedDeviceLink: FC<BrandedDeviceLinkProps> = ({
  deviceName,
  deviceManufacturer,
  deviceGearId,
  deviceGearName,
  isOwner
}) => {
  const brand =
    getBrandFromManufacturer(deviceManufacturer) ??
    getBrandFromDeviceName(deviceName)
  const label =
    deviceGearName?.trim() ||
    getDeviceDisplayLabel(deviceName, deviceManufacturer)

  if (!label) return null

  if (isOwner && deviceGearId) {
    return (
      <Link
        // Rendered once per post in a feed, so it must not prefetch: the App
        // Router otherwise fires one RSC request per row on scroll.
        prefetch={false}
        href={`/fitness/gear/${encodeURIComponent(deviceGearId)}`}
        className="font-medium hover:underline underline-offset-2"
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </Link>
    )
  }

  if (brand) {
    return (
      <a
        href={brand.url}
        target="_blank"
        rel="noopener noreferrer"
        style={brand.brandColor ? { color: brand.brandColor } : undefined}
        className="font-medium hover:underline underline-offset-2"
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </a>
    )
  }

  return <strong className="text-foreground">{label}</strong>
}
