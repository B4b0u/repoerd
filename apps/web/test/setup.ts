import { toast } from 'sonner'
import { afterEach, beforeEach } from 'vitest'
import { i18n } from '../src/shared/i18n/i18n'

// Shared setup of the web tests (see vitest.config.ts).

// Radix primitives and cmdk use browser APIs that jsdom lacks.
if (typeof window !== 'undefined') {
  const element = window.Element.prototype as Partial<Element>
  element.hasPointerCapture ??= () => false
  element.setPointerCapture ??= () => {}
  element.releasePointerCapture ??= () => {}
  element.scrollIntoView ??= () => {}
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// Tests assert English texts unless they switch the language themselves.
beforeEach(async () => {
  await i18n.changeLanguage('en')
})

// sonner's toast store is module-global: a toast must not leak into the next test.
afterEach(() => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear()
    toast.dismiss()
  }
})
