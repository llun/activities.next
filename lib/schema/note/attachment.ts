import { z } from 'zod'

import { Document } from './document'
import { PropertyValue } from './propertyValue'

export const Attachment = z.union([PropertyValue, Document])

export type Attachment = z.infer<typeof Attachment>
