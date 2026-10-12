import { admin } from './admin'
import { auth } from './auth'
import { common } from './common'
import { compare } from './compare'
import { detail } from './detail'
import { diagram } from './diagram'
import { errors } from './errors'
import { repos } from './repos'
import { settings } from './settings'
import { setup } from './setup'
import { tables } from './tables'

/** The reference catalogue: every other language has exactly these keys. */
export const en = {
  admin,
  common,
  compare,
  repos,
  errors,
  diagram,
  auth,
  settings,
  setup,
  tables,
  detail,
}

export type Catalog = typeof en
