import { type Expression, type Module, type ObjectExpression, parseSync } from '@swc/core'

/** Options read with the `schema` field, when they are string literals (absent otherwise). */
export interface ConfigOptions {
  /** drizzle.config `dialect`. */
  dialect?: string
  /** drizzle.config `casing`. */
  casing?: string
}

/**
 * The `schema` field of a config: its paths, or `ok: false` when it cannot be read statically
 * (`missing`: the config object has no `schema` property at all).
 */
export type ConfigSchemaRead = ({ ok: true; paths: string[] } | { ok: false; missing?: true }) &
  ConfigOptions

const MAX_DEPTH = 8

export function readConfigSchemaProperty(source: string): ConfigSchemaRead {
  let module: Module
  try {
    module = parseSync(source, { syntax: 'typescript' })
  } catch {
    return { ok: false }
  }

  const exported = defaultExportOf(module)
  const config = exported ? unwrap(exported, module, 0) : undefined
  if (config?.type !== 'ObjectExpression') return { ok: false }

  const options: ConfigOptions = {}
  const dialect = singleString(propertyValue(config, module, 'dialect'), module)
  if (dialect !== undefined) options.dialect = dialect
  const casing = singleString(propertyValue(config, module, 'casing'), module)
  if (casing !== undefined) options.casing = casing

  const schema = propertyValue(config, module, 'schema')
  if (schema === undefined) return { ok: false, missing: true, ...options }
  const paths = schema === null ? undefined : stringsOf(schema, module, 0)
  return paths ? { ok: true, paths, ...options } : { ok: false, ...options }
}

/**
 * The value of property `name` of the config (`{ name }` shorthand included): undefined when the
 * config has no such property, null when a shorthand names no top-level constant.
 */
function propertyValue(
  config: ObjectExpression,
  module: Module,
  name: string,
): Expression | null | undefined {
  for (const property of config.properties) {
    if (property.type === 'Identifier') {
      if (property.value === name) return topLevelInitializer(module, name) ?? null
    } else if (property.type === 'KeyValueProperty') {
      const key =
        property.key.type === 'Identifier' || property.key.type === 'StringLiteral'
          ? property.key.value
          : undefined
      if (key === name) return property.value
    }
  }
  return undefined
}

/** A string literal, also through a top-level constant; undefined for anything else. */
function singleString(value: Expression | null | undefined, module: Module): string | undefined {
  const strings = value ? stringsOf(value, module, 0) : undefined
  return strings?.length === 1 ? strings[0] : undefined
}

function defaultExportOf(module: Module): Expression | undefined {
  for (const item of module.body) {
    if (item.type === 'ExportDefaultExpression') return item.expression
    if (item.type === 'ExpressionStatement' && isModuleExportsAssignment(item.expression)) {
      return item.expression.right
    }
    if (item.type === 'ExportNamedDeclaration' && !item.source) {
      for (const specifier of item.specifiers) {
        if (
          specifier.type === 'ExportSpecifier' &&
          specifier.exported?.type === 'Identifier' &&
          specifier.exported.value === 'default' &&
          specifier.orig.type === 'Identifier'
        ) {
          return topLevelInitializer(module, specifier.orig.value)
        }
      }
    }
  }
  return undefined
}

function isModuleExportsAssignment(
  expression: Expression,
): expression is Extract<Expression, { type: 'AssignmentExpression' }> {
  if (expression.type !== 'AssignmentExpression') return false
  const left = expression.left
  return (
    left.type === 'MemberExpression' &&
    left.object.type === 'Identifier' &&
    left.object.value === 'module' &&
    left.property.type === 'Identifier' &&
    left.property.value === 'exports'
  )
}

function unwrap(expression: Expression, module: Module, depth: number): Expression | undefined {
  if (depth > MAX_DEPTH) return undefined
  switch (expression.type) {
    case 'TsSatisfiesExpression':
    case 'TsAsExpression':
    case 'TsConstAssertion':
    case 'ParenthesisExpression':
      return unwrap(expression.expression, module, depth + 1)
    case 'CallExpression': {
      const first = expression.arguments[0]
      return first ? unwrap(first.expression, module, depth + 1) : undefined
    }
    case 'Identifier': {
      const init = topLevelInitializer(module, expression.value)
      return init ? unwrap(init, module, depth + 1) : undefined
    }
    default:
      return expression
  }
}

function topLevelInitializer(module: Module, name: string): Expression | undefined {
  for (const item of module.body) {
    const declaration =
      item.type === 'VariableDeclaration'
        ? item
        : item.type === 'ExportDeclaration' && item.declaration.type === 'VariableDeclaration'
          ? item.declaration
          : undefined
    if (!declaration) continue
    for (const declarator of declaration.declarations) {
      if (declarator.id.type === 'Identifier' && declarator.id.value === name && declarator.init) {
        return declarator.init
      }
    }
  }
  return undefined
}

function stringsOf(expression: Expression, module: Module, depth: number): string[] | undefined {
  if (depth > MAX_DEPTH) return undefined
  switch (expression.type) {
    case 'TsSatisfiesExpression':
    case 'TsAsExpression':
    case 'TsConstAssertion':
    case 'ParenthesisExpression':
      return stringsOf(expression.expression, module, depth + 1)
    case 'Identifier': {
      const init = topLevelInitializer(module, expression.value)
      return init ? stringsOf(init, module, depth + 1) : undefined
    }
    case 'StringLiteral':
      return [expression.value]
    case 'TemplateLiteral': {
      if (expression.expressions.length !== 0) return undefined
      const cooked = expression.quasis[0]?.cooked
      return typeof cooked === 'string' ? [cooked] : undefined
    }
    case 'ArrayExpression': {
      const values: string[] = []
      for (const element of expression.elements) {
        if (!element || element.spread || element.expression.type !== 'StringLiteral')
          return undefined
        values.push(element.expression.value)
      }
      return values
    }
    default:
      return undefined
  }
}
