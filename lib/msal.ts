import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser'

// CoreDocs Editor app registration (PPE Technologies tenant). These are PUBLIC identifiers
// (a SPA has no secret) — safe to ship in the browser bundle. Env override optional.
const CLIENT_ID = process.env.NEXT_PUBLIC_AZURE_CLIENT_ID || 'b486e8cd-40fc-418e-aaf3-bad409bca41a'
const TENANT_ID = process.env.NEXT_PUBLIC_AZURE_TENANT_ID || '4c5b02da-9e6a-40bf-8360-6fd95fe56b26'

// Delegated Graph scopes we need for editing Office docs in-window. Files/Sites .ReadWrite.All
// are admin-restricted (need the tenant admin-consent grant) — until that's in place, requesting
// them fails with a consent error and the app falls back to read-only.
export const EDIT_SCOPES = ['Files.ReadWrite.All', 'Sites.ReadWrite.All']
export const BASIC_SCOPES = ['User.Read']

let _msal: PublicClientApplication | null = null

// Pre-initialise on page load (call initMsal() in a useEffect) so the sign-in click opens
// the popup SYNCHRONOUSLY — MSAL's async initialize() otherwise runs between the click and
// window.open, which the browser treats as non-user-initiated and blocks (popup_window_error).
export async function initMsal(): Promise<PublicClientApplication> {
  if (_msal) return _msal
  const app = new PublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
      redirectUri: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
    cache: { cacheLocation: 'sessionStorage' },
  })
  await app.initialize()
  _msal = app
  return _msal
}

async function getMsal(): Promise<PublicClientApplication> {
  return _msal ?? initMsal()
}

export type MsToken = { token: string; account: AccountInfo }

/** Acquire a delegated Microsoft Graph token for the given scopes: silent if the user already
 *  has a Microsoft session, otherwise an interactive popup. Throws on consent-required / cancel. */
export async function acquireGraphToken(scopes: string[], interactive = true): Promise<MsToken> {
  const msal = await getMsal()
  const account = msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null

  if (account) {
    try {
      const res = await msal.acquireTokenSilent({ scopes, account })
      return { token: res.accessToken, account: res.account }
    } catch {
      // fall through to interactive
    }
  }
  if (!interactive) throw new Error('interaction_required')
  const res = await msal.acquireTokenPopup({ scopes })
  msal.setActiveAccount(res.account)
  return { token: res.accessToken, account: res.account }
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
