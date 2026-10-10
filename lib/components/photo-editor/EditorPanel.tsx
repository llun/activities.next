'use client'

import { Crop as CropIcon, SlidersHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'

import { TabsContent, TabsList, TabsTrigger } from '@/lib/components/ui/tabs'
import type { MediaDetailsEntity } from '@/lib/services/medias/types'

import { AdjustPanel } from './AdjustPanel'
import { CropPanel } from './CropPanel'
import { Histogram } from './Histogram'
import type { EditorControls } from './editorControls'
import type { Histogram as HistogramData } from './engine/histogram'

/** "Fujifilm X-T5 · 23 mm · f/2 · 1/250 s · ISO 400"; null with no data. */
export const formatCameraLine = (
  details: MediaDetailsEntity | null | undefined
): string | null => {
  if (!details) return null
  const { camera, exposure } = details
  const parts = [
    camera?.name,
    exposure?.focalLengthMm != null ? `${exposure.focalLengthMm} mm` : null,
    exposure?.aperture != null ? `f/${exposure.aperture}` : null,
    exposure?.exposureTime ? `${exposure.exposureTime} s` : null,
    exposure?.iso != null ? `ISO ${exposure.iso}` : null
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}

interface Props {
  controls: EditorControls
  histogram: HistogramData | null
  details: MediaDetailsEntity | null | undefined
  /** Save and load errors, shown at the top of the panel. */
  alerts: ReactNode
}

/** The desktop right panel: histogram, camera line, tabs and their content. */
export const EditorPanel = ({
  controls,
  histogram,
  details,
  alerts
}: Props) => {
  const cameraLine = formatCameraLine(details)
  return (
    <aside
      aria-label="Edit controls"
      className="flex min-h-0 w-[292px] flex-col overflow-y-auto border-l"
    >
      {alerts ? <div className="p-4 pb-0">{alerts}</div> : null}
      <div className="space-y-2 p-4 pb-0">
        <Histogram data={histogram} />
        {cameraLine ? (
          <p className="text-xs text-muted-foreground">{cameraLine}</p>
        ) : null}
      </div>
      <div className="px-4 pt-3">
        <TabsList className="w-full">
          <TabsTrigger value="adjust">
            <SlidersHorizontal aria-hidden="true" />
            Adjust
          </TabsTrigger>
          <TabsTrigger value="crop">
            <CropIcon aria-hidden="true" />
            Crop
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="adjust">
        <AdjustPanel controls={controls} />
      </TabsContent>
      <TabsContent value="crop">
        <CropPanel controls={controls} />
      </TabsContent>
    </aside>
  )
}
