import { FC, ReactNode } from 'react'

import { Frame } from '@/lib/components/surface/Frame'

export interface DetailItem {
  label: string
  value: ReactNode
}

interface Props {
  items: DetailItem[]
  className?: string
}

/**
 * The key facts of a detail page as label/value rows in one `Frame`: the label
 * muted on the left, the value on the right from `sm`, stacked on a phone.
 */
export const DetailList: FC<Props> = ({ items, className }) => (
  <Frame className={className}>
    <dl className="divide-y">
      {items.map(({ label, value }) => (
        <div
          key={label}
          className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6"
        >
          <dt className="text-muted-foreground text-sm">{label}</dt>
          <dd className="min-w-0 text-sm font-medium break-words">{value}</dd>
        </div>
      ))}
    </dl>
  </Frame>
)
