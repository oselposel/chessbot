export type AuthSession = {
  token: string;
  username: string;
  expiresAt: number;
};
const SESSION = "chessbot.lichess.session.v1";
const TRANSACTION = "chessbot.lichess.pkce.v1";
const CLIENT_ID = "oselposel.github.io/chessbot";
type Transaction = {
  state: string;
  verifier: string;
  redirect: string;
  createdAt: number;
};

export class AuthenticationError extends Error {}
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export async function createAuthorization(redirect: string) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const transaction: Transaction = {
    state,
    verifier,
    redirect,
    createdAt: Date.now(),
  };
  const url = new URL("https://lichess.org/oauth");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirect,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  }).toString();
  return { url: url.href, transaction };
}
export async function login(): Promise<void> {
  const redirect = location.origin + location.pathname;
  const { url, transaction } = await createAuthorization(redirect);
  sessionStorage.setItem(TRANSACTION, JSON.stringify(transaction));
  location.assign(url);
}
export function clearAuth() {
  sessionStorage.removeItem(SESSION);
  sessionStorage.removeItem(TRANSACTION);
}
export function readAuth(): AuthSession | null {
  try {
    const value = JSON.parse(
      sessionStorage.getItem(SESSION) || "null",
    ) as AuthSession | null;
    if (
      value &&
      typeof value.token === "string" &&
      value.token.length > 0 &&
      typeof value.username === "string" &&
      typeof value.expiresAt === "number" &&
      Number.isFinite(value.expiresAt) &&
      value.expiresAt > Date.now()
    )
      return value;
  } catch {}
  sessionStorage.removeItem(SESSION);
  return null;
}
export async function finishLogin(): Promise<AuthSession | null> {
  const params = new URLSearchParams(location.search);
  if (!params.has("code") && !params.has("error")) return readAuth();
  // Remove the short-lived code before making requests or rendering external links.
  history.replaceState(null, "", location.pathname);
  const stored = sessionStorage.getItem(TRANSACTION);
  sessionStorage.removeItem(TRANSACTION);
  let transaction: Transaction | null = null;
  try {
    transaction = JSON.parse(stored || "null");
  } catch {}
  if (
    !transaction ||
    !transaction.state ||
    params.get("state") !== transaction.state ||
    !Number.isFinite(transaction.createdAt) ||
    transaction.createdAt > Date.now() ||
    Date.now() - transaction.createdAt > 600_000 ||
    transaction.redirect !== location.origin + location.pathname
  )
    throw new AuthenticationError(
      "Přihlášení není platné nebo vypršelo. Zkus se přihlásit znovu.",
    );
  if (params.has("error"))
    throw new AuthenticationError("Přihlášení bylo zrušeno nebo odmítnuto.");
  const response = await fetch("https://lichess.org/api/token", {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: transaction.redirect,
      code_verifier: transaction.verifier,
      code: params.get("code")!,
    }),
  });
  if (!response.ok)
    throw new AuthenticationError(
      "Lichess přihlášení nepotvrdil. Zkus to znovu.",
    );
  const data = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (
    !data ||
    typeof data.access_token !== "string" ||
    !data.access_token ||
    typeof data.expires_in !== "number" ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  )
    throw new AuthenticationError(
      "Lichess vrátil neplatnou odpověď přihlášení.",
    );
  const account = await fetch("https://lichess.org/api/account", {
    headers: { Authorization: `Bearer ${data.access_token}` },
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!account.ok)
    throw new AuthenticationError(
      "Nepodařilo se ověřit přihlášený účet. Přihlas se znovu.",
    );
  const user = (await account.json()) as { username?: unknown };
  if (!user || typeof user.username !== "string")
    throw new AuthenticationError("Lichess nevrátil uživatelské jméno.");
  const session = {
    token: data.access_token,
    username: user.username,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  sessionStorage.setItem(SESSION, JSON.stringify(session));
  return session;
}
export async function logout(session: AuthSession): Promise<boolean> {
  clearAuth();
  try {
    const response = await fetch("https://lichess.org/api/token", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.token}` },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}
