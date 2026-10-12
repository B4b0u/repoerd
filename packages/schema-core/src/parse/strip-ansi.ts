// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI colour codes start with ESC.
const ANSI_ESCAPES = /\u001b\[[0-9;]*m/g

/** Prisma colours its messages: the codes are removed before the text is read or shown. */
export const stripAnsi = (message: string): string => message.replace(ANSI_ESCAPES, '')
