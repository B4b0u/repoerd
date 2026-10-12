/**
 * Version of what detection and parsing produce (sources, problems, schemas). Bump it with every
 * change to detection, to parsing (Liam, its patch, the façade) or to the shared model: the server
 * deletes cached results of another version at start-up and never serves them.
 * 2: plan 6c (patched Liam, `schema.table` names, casing, views, new problems).
 * 3: plan 6e (a one-to-many Prisma self-relation is no longer read as a many-to-many table).
 */
export const CACHE_VERSION = 3
