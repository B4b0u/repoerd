import { describe, expect, it } from 'vitest'
import { ApiError } from '../../src/shared/api/client'
import { apiErrorMessage } from '../../src/shared/i18n/api-error-message'
import { i18n } from '../../src/shared/i18n/i18n'

const english = i18n.getFixedT('en', 'errors')
const french = i18n.getFixedT('fr', 'errors')

describe('apiErrorMessage', () => {
  it('translates the error code', () => {
    const error = new ApiError(404, 'repo_not_found', 'Repository not found')
    expect(apiErrorMessage(english, error)).toBe('Repository not found.')
    expect(apiErrorMessage(french, error)).toBe('Dépôt introuvable.')
  })

  it('fills in the values of the details', () => {
    const error = new ApiError(404, 'branch_not_found', 'Branch "feature/x" not found', {
      branch: 'feature/x',
    })
    expect(apiErrorMessage(french, error)).toBe('Branche « feature/x » introuvable.')
  })

  it('renders a numeric value of the details in both languages', () => {
    const error = new ApiError(400, 'bad_request', 'Source "core" has more than 20 paths', {
      reason: 'too-many-paths',
      name: 'core',
      max: 20,
    })
    expect(apiErrorMessage(english, error)).toBe('Source "core" has more than 20 paths.')
    expect(apiErrorMessage(french, error)).toBe('La source « core » a plus de 20 chemins.')
  })

  it('translates the reason when the code covers several situations', () => {
    const error = new ApiError(400, 'bad_request', 'Path "../x" of source "core" must be…', {
      reason: 'path-invalid',
      name: 'core',
      path: '../x',
    })
    expect(apiErrorMessage(english, error)).toBe(
      'Path "../x" of source "core" must be relative to the repository root, without "..", "\\" or control characters.',
    )
    expect(apiErrorMessage(french, error)).toContain('Le chemin « ../x » de la source « core »')
  })

  it('keeps the server message for a code it does not know', () => {
    const error = new ApiError(400, 'invalid_app', 'GitHub does not know this App.')
    expect(apiErrorMessage(french, error)).toBe('GitHub does not know this App.')
  })

  it('keeps the server message for a reason it does not know', () => {
    const error = new ApiError(409, 'conflict', 'A newer server explains this.', {
      reason: 'brand-new' as never,
    })
    expect(apiErrorMessage(french, error)).toBe('A newer server explains this.')
  })

  it('translates a network failure', () => {
    const error = new TypeError('Failed to fetch')
    expect(apiErrorMessage(english, error)).toBe(
      'Could not reach the server. Check your connection and try again.',
    )
    expect(apiErrorMessage(french, error)).toBe(
      'Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.',
    )
  })

  it('names the HTTP status of an error response that has no message', () => {
    const error = new ApiError(502, 'unknown', '')
    expect(apiErrorMessage(english, error)).toBe('The server answered with an error (HTTP 502).')
    expect(apiErrorMessage(french, error)).toBe('Le serveur a répondu par une erreur (HTTP 502).')
  })

  it('keeps the message of an unstructured error response that has one', () => {
    expect(apiErrorMessage(french, new ApiError(502, 'unknown', 'Bad Gateway'))).toBe('Bad Gateway')
  })

  it('shows the message of internal errors', () => {
    expect(apiErrorMessage(french, new Error('Refusing to send the manifest'))).toBe(
      'Refusing to send the manifest',
    )
  })
})
