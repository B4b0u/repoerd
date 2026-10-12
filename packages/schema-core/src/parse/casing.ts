import type { DrizzleCasing } from '@repoerd/model'

// How drizzle-orm splits an identifier into words (drizzle-orm/casing.js).
const WORDS = /[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g

const wordsOf = (input: string) => input.replace(/['’]/g, '').match(WORDS) ?? []

export const toSnakeCase = (input: string): string =>
  wordsOf(input)
    .map((word) => word.toLowerCase())
    .join('_')

export const toCamelCase = (input: string): string =>
  wordsOf(input)
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`,
    )
    .join('')

/** The column name Drizzle derives from a JS key under the `casing` of its config. */
export const applyCasing = (casing: DrizzleCasing, key: string): string =>
  casing === 'snake_case' ? toSnakeCase(key) : toCamelCase(key)
