// Kept free of 'use client' so a Server Component can read the value: the id
// of the first row's label input, which the "Profile fields" row's label names
// (a click on the label focuses it). With no rows nothing carries the id: a
// label that pointed at the first suggestion chip would press it, adding a
// field, so the label then does nothing and the group is named by
// `aria-labelledby` instead.
export const PROFILE_FIELDS_FIRST_CONTROL_ID = 'profileFieldsFirstControl'
