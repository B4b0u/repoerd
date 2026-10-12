import type { Catalog } from '../en'
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

export const fr: Catalog = {
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
