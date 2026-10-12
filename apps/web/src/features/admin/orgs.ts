/** The organisations field accepts commas, spaces and new lines between logins. */
export const parseOrgs = (text: string) => text.split(/[\s,]+/).filter((login) => login !== '')
export const formatOrgs = (orgs: string[]) => orgs.join(', ')
