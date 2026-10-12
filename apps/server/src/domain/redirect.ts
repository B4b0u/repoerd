/** Where to send the browser after sign-in: a same-origin path, never another site. */
export function safeNextPath(value: string | undefined): string {
  if (!value?.startsWith('/')) return '/'
  if (value.startsWith('//') || value.startsWith('/\\')) return '/'
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/'
  return value
}
