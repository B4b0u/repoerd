import { describe, expect, it } from 'vitest'
import { isInsecurePublicUrl } from '../src/index.js'

describe('isInsecurePublicUrl', () => {
  it('flags plain HTTP, except on the machine itself', () => {
    expect(isInsecurePublicUrl('http://erd.example.com')).toBe(true)
    expect(isInsecurePublicUrl(' http://10.0.0.5:3000 ')).toBe(true)
    expect(isInsecurePublicUrl('http://192.168.1.20:3000')).toBe(true)
    expect(isInsecurePublicUrl('https://erd.example.com')).toBe(false)
    expect(isInsecurePublicUrl('http://localhost:5173')).toBe(false)
    expect(isInsecurePublicUrl('http://127.0.0.1:3000')).toBe(false)
    expect(isInsecurePublicUrl('http://[::1]:3000')).toBe(false)
    expect(isInsecurePublicUrl('erd.example.com')).toBe(false)
    expect(isInsecurePublicUrl('not a url')).toBe(false)
  })
})
