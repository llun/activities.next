import { RefreshButton as RefreshButtonSource } from '@/lib/components/refresh-button'

import * as kit from './index'

describe('surface kit index', () => {
  it('re-exports RefreshButton from its existing home', () => {
    expect(kit.RefreshButton).toBe(RefreshButtonSource)
  })

  it.each([
    'Alert',
    'EmptyState',
    'FormRow',
    'formRowHintId',
    'formRowLabelId',
    'Frame',
    'FramedList',
    'FramedListItem',
    'SaveBar',
    'SavedIndicator',
    'Section',
    'DescriptionSkeleton',
    'ScreenSkeleton',
    'StatStripSkeleton',
    'SectionSkeleton',
    'SegmentedControl',
    'SkeletonBar',
    'SkeletonRows',
    'StatCell',
    'StatStrip',
    'TableFrame',
    'TABLE_HEAD_ROW_CLASS'
  ])('exports %s', (name) => {
    expect((kit as Record<string, unknown>)[name]).toBeDefined()
  })
})
