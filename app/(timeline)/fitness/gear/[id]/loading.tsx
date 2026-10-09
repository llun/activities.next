import { FC } from 'react'

import { GearDetailSkeleton } from './GearDetailView'

// A gear's page has no `PageHeader` of its own: the Back link, title, meta line
// and stat strip, exactly as the view draws them until the gear is read.
const Loading: FC = () => <GearDetailSkeleton />

export default Loading
