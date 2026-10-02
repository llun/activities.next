import { type VariantProps, cva } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        // Dark gray is the design's Badge Gray Bg / Fg (#383838 / #C2C2C2),
        // lighter than the --muted surface so the pill reads on the dark card.
        gray: 'bg-muted text-muted-foreground dark:bg-[#383838] dark:text-[#C2C2C2]',
        // Dark fills are the design's Badge tints (Dark/Status/Badge ...): a
        // lighter hue at 16 % on the near-black surface, because the raw
        // --primary / --destructive fills at 10 % all but vanish there. The
        // labels are the text tokens, which already flip per theme.
        primary: 'bg-primary/10 text-primary-text dark:bg-[#FA802E]/16',
        success:
          'bg-green-100 text-green-800 dark:bg-[#163B24] dark:text-[#69D390]',
        destructive:
          'bg-destructive/10 text-destructive-text dark:bg-[#DF3A3A]/16',
        blue: 'bg-blue-100 text-blue-800 dark:bg-[#00BCFF]/16 dark:text-foreground'
      }
    },
    defaultVariants: {
      tone: 'gray'
    }
  }
)

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

export { Badge, badgeVariants }
