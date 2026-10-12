/**
 * Sign-in restriction (D24): the user passes when the App is installed on one of the allowed
 * accounts and the user can access that installation. Empty list = no restriction.
 */
export function isAllowedByOrgs(
  allowedOrgs: readonly string[],
  accounts: readonly string[],
): boolean {
  if (allowedOrgs.length === 0) return true
  const allowed = new Set(allowedOrgs.map((org) => org.toLowerCase()))
  return accounts.some((account) => allowed.has(account.toLowerCase()))
}
