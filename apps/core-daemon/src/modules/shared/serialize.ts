export const toIso = (value?: Date | string | null) =>
  value ? new Date(value).toISOString() : undefined

export const toIsoRequired = (value: Date | string) =>
  new Date(value).toISOString()

export const toOptionalJson = <T>(value?: T | null) => value ?? undefined
