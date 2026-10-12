/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'domain-stays-pure',
      comment: 'The domain only depends on itself and on the shared model.',
      severity: 'error',
      from: { path: '^apps/server/src/domain/' },
      to: { pathNot: ['^apps/server/src/domain/', '^packages/model/'] },
    },
    {
      name: 'application-stays-pure',
      comment:
        'Use cases only depend on the application layer, the domain and the shared model ' +
        '(workspace packages are "undetermined" for dependency-cruiser, so list what is allowed).',
      severity: 'error',
      from: { path: '^apps/server/src/application/' },
      to: { pathNot: ['^apps/server/src/(domain|application)/', '^packages/model/'] },
    },
    {
      name: 'application-no-adapters',
      comment: 'Use cases depend on ports, never on adapters, HTTP or the composition root.',
      severity: 'error',
      from: { path: '^apps/server/src/application/' },
      to: { path: '^apps/server/src/(infrastructure|http)/|^apps/server/src/main\\.ts$' },
    },
    {
      name: 'application-no-libraries',
      comment: 'Use cases must not import npm packages or Node built-ins.',
      severity: 'error',
      from: { path: '^apps/server/src/application/' },
      to: {
        dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-no-pkg', 'core'],
      },
    },
    {
      name: 'liam-only-in-schema-core',
      comment: '@liam-hq/* is an unstable internal package: only packages/schema-core may use it.',
      severity: 'error',
      from: { pathNot: '^packages/schema-core/' },
      to: { path: '@liam-hq' },
    },
    {
      name: 'web-stays-in-the-browser',
      comment:
        'The web app never imports the server nor the parser (SWC, WebAssembly, Node built-ins): ' +
        'it shares code through packages/model and packages/contracts only.',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^(apps/server|packages/schema-core)/' },
    },
    {
      name: 'shared-packages-no-node',
      comment: 'packages/model and packages/contracts also run in the browser: no Node built-ins.',
      severity: 'error',
      from: { path: '^packages/(model|contracts)/src/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'no-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|test|node_modules)/' },
    tsPreCompilationDeps: true,
    // Only for the `@/` alias of apps/web (shadcn/ui); depcruise resolves tsconfig paths from the root.
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['development', 'types', 'import', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
    },
  },
}
