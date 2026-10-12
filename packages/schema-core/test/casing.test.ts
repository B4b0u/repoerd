import { describe, expect, it } from 'vitest'
import { applyCasing, toCamelCase, toSnakeCase } from '../src/parse/casing.js'

describe('casing', () => {
  it.each([
    ['firstName', 'first_name', 'firstName'],
    ['createdAt', 'created_at', 'createdAt'],
    ['userID', 'user_id', 'userID'],
    ['HTTPServer', 'http_server', 'httpServer'],
    ['already_snake', 'already_snake', 'alreadySnake'],
    ['id', 'id', 'id'],
  ])('names %s like drizzle-orm does', (key, snake, camel) => {
    expect(toSnakeCase(key)).toBe(snake)
    expect(toCamelCase(key)).toBe(camel)
    expect(applyCasing('snake_case', key)).toBe(snake)
    expect(applyCasing('camelCase', key)).toBe(camel)
  })
})
