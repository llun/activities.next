'use client'

import { FC } from 'react'

import {
  getBrandFromDeviceName,
  getBrandFromManufacturer
} from '@/lib/utils/fitnessDeviceBrands'

interface BrandedDeviceLinkProps {
  deviceName?: string | null
  deviceManufacturer?: string | null
}

export const BrandedDeviceLink: FC<BrandedDeviceLinkProps> = ({
  deviceName,
  deviceManufacturer
}) => {
  const brand =
    getBrandFromManufacturer(deviceManufacturer) ??
    getBrandFromDeviceName(deviceName)
  const label = deviceName || brand?.displayName || deviceManufacturer

  if (!label) return null

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
