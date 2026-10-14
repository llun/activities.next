import { getDeviceLinkTarget } from '@/lib/utils/fitnessDeviceBrands'

describe('getDeviceLinkTarget', () => {
  const garmin = {
    deviceName: 'Forerunner 965',
    deviceManufacturer: 'garmin'
  }

  it('sends the owner to the gear row’s own page, named by the row', () => {
    expect(
      getDeviceLinkTarget({
        ...garmin,
        deviceGearId: 'gear/1',
        deviceGearName: ' My watch ',
        isOwner: true
      })
    ).toEqual({
      kind: 'owner',
      href: '/fitness/gear/gear%2F1',
      label: 'My watch'
    })
  })

  it('never sends anyone else to the owner-only page', () => {
    const target = getDeviceLinkTarget({
      ...garmin,
      deviceGearId: 'gear-1',
      isOwner: false
    })

    expect(target).toMatchObject({ kind: 'brand', label: 'Forerunner 965' })
    expect(target?.href).not.toContain('/fitness/gear')
  })

  it('falls back to the manufacturer for an owner without a gear row', () => {
    expect(getDeviceLinkTarget({ ...garmin, isOwner: true })).toMatchObject({
      kind: 'brand',
      brandName: 'Garmin'
    })
  })

  it('resolves the brand from the device name when no manufacturer is recorded', () => {
    expect(
      getDeviceLinkTarget({ deviceName: 'Garmin Edge 840' })
    ).toMatchObject({ kind: 'brand', brandName: 'Garmin' })
  })

  it('is null where the device would be plain text', () => {
    expect(
      getDeviceLinkTarget({ deviceName: 'Some Unbranded Gizmo' })
    ).toBeNull()
    expect(
      getDeviceLinkTarget({
        deviceName: 'Some Unbranded Gizmo',
        deviceGearId: 'gear-1',
        isOwner: false
      })
    ).toBeNull()
  })

  it('is null when there is nothing to name, even for the owner with a gear row', () => {
    expect(
      getDeviceLinkTarget({ deviceGearId: 'gear-1', isOwner: true })
    ).toBeNull()
    // A raw numeric manufacturer code is not a label.
    expect(
      getDeviceLinkTarget({ deviceManufacturer: '255', isOwner: true })
    ).toBeNull()
  })
})
