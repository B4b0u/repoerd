// The real parser child, plus test markers in a request: __crash__ makes the process die,
// __hang__ makes it loop forever, __null__ / __wrongid__ / __badshape__ make it send a bad
// message before the real answer. This listener runs before the real child's.
process.on('message', (message: unknown) => {
  const text = JSON.stringify(message)
  const id = (message as { id?: number }).id
  if (text.includes('__crash__')) process.exit(70)
  if (text.includes('__hang__')) for (;;);
  if (text.includes('__null__')) process.send?.(null)
  if (text.includes('__wrongid__')) process.send?.({ type: 'reply', id: -1, ok: true, value: {} })
  if (text.includes('__badshape__')) process.send?.({ type: 'reply', id, ok: 'yes' })
})
await import('../../src/isolate/parser-child.js')
