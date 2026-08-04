import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser'

// CoreDocs Editor app registration (PPE Technologies tenant). These are PUBLIC identifiers
// (a SPA has no secret) — safe to ship in the browser bundle. Env override optional.
const CLIENT_ID = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || 'b486e8cd-40fc-418e-aaf3-bad409bca41a'
const TENANT_ID = process.env.NEXT_PUBLIC_AZURE_TENANT_ID || '4c5b02da-9e6a-40bf-8360-6fd95fe56b26'

// Delegated Graph scopes for editing Office docs in-window. Files/Sites.ReadWrite.All are
// admin-restricted (need the tenant admin-consent grant) — until that's in place, requesting
// them fails with a consent error and the app falls back to read-only.
export const EDIT_SCOPES = ['Files.ReadWrite.All', 'Sites.ReadWrite.All']
export const BASIC_SCOPES = ['User.Read']

// Full-page redirect sign-in returns here (must be a registered SPA redirect URI on the app).
const REDIRECT_PATH = '/microsoft-check'

let _msal: PublicClientApplication | null = null

export async function initMsal(): Promise<PublicClientApplication> {
  if (_msal) return _msal
  const app = new PublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      redirectUri: typeof window !== 'undefined' ? window.location.origin + REDIRECT_PATH : undefined,
    },
    cache: { cacheLocation: 'localStorage' },   // persist the connection across the app (so edit works silently on any page)
  })
  await app.initialize()
  _msal = app
  return _msal
}

async function getMsal(): Promise<PublicClientApplication> {
  return _msal ?? initMsal()
}

export type MsToken = { token: string; account: AccountInfo }

/** Call on page load: completes a returning redirect sign-in (returns the token/account if we
 *  just came back from Microsoft), else null. */
export async function handleMsRedirect(): Promise<MsToken | null> {
  const msal = await getMsal()
  const res = await msal.handleRedirectPromise()
  if (res?.account) {
    msal.setActiveAccount(res.account)
    return { token: res.accessToken, account: res.account }
  }
  return null
}

/** Start a full-page redirect sign-in for the given scopes (navigates away to Microsoft). */
export async function signInRedirect(scopes: string[]): Promise<void> {
  const msal = await getMsal()
  await msal.acquireTokenRedirect({ scopes })
}

/** Silent token for an already-signed-in account (no popup/redirect). Throws if no account
 *  or if consent is required (e.g. edit scopes before admin consent). */
export async function acquireSilent(scopes: string[]): Promise<MsToken> {
  const msal = await getMsal()
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0]
  if (!account) throw new Error('no_account')
  const res = await msal.acquireTokenSilent({ scopes, account })
  return { token: res.accessToken, account: res.account }
}

/** Mint an EDITABLE Office-for-the-web embed URL for a file, using the signed-in user's
 *  delegated token (Graph preview + allowEdit). Throws if the user isn't connected or the
 *  edit scopes aren't consented yet — callers should fall back to the read-only viewer. */
export async function getEditEmbedUrl(driveId: string, itemId: string): Promise<string> {
  const { token } = await acquireSilent(EDIT_SCOPES)
  const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/preview`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowEdit: true }),
  })
  if (!res.ok) throw new Error('preview_edit_failed_' + res.status)
  const data = await res.json()
  if (!data.getUrl) throw new Error('no_edit_url')
  return data.getUrl as string
}

export async function currentMsAccount(): Promise<AccountInfo | null> {
  const msal = await getMsal()
  return msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null
}

export async function signOutMs(): Promise<void> {
  const msal = await getMsal()
  const account = await currentMsAccount()
  if (account) await msal.clearCache({ account })
}
