/** Index just after the string literal that starts at `start` (a `"`). */
function stringEnd(text: string, start: number): number {
  let i = start + 1
  while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1
  return i + 1
}

function withoutComments(text: string): string {
  let output = ''
  let i = 0
  while (i < text.length) {
    const char = text[i] as string
    const next = text[i + 1]
    if (char === '"') {
      const end = stringEnd(text, i)
      output += text.slice(i, end)
      i = end
    } else if (char === '/' && next === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
    } else {
      output += char
      i += 1
    }
  }
  return output
}

function withoutTrailingCommas(text: string): string {
  let output = ''
  let i = 0
  while (i < text.length) {
    const char = text[i] as string
    if (char === '"') {
      const end = stringEnd(text, i)
      output += text.slice(i, end)
      i = end
      continue
    }
    if (char === ',') {
      let j = i + 1
      while (j < text.length && /\s/.test(text[j] as string)) j += 1
      if (text[j] === '}' || text[j] === ']') {
        i += 1
        continue
      }
    }
    output += char
    i += 1
  }
  return output
}

/**
 * Parses JSON with comments and trailing commas, as tsconfig.json files are written: undefined
 * when the text is not valid. Two linear passes, outside strings.
 */
export function parseJsonc(text: string): unknown {
  try {
    return JSON.parse(withoutTrailingCommas(withoutComments(text)))
  } catch {
    return undefined
  }
}
