import { nanoid } from "nanoid"

export const createId = (prefix: string) => {
  return `${prefix}_${nanoid(10)}`
}

export * from "./env"
export * from "./logger"
