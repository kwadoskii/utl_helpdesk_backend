import { createRemoteJWKSet, jwtVerify } from "jose";

const tenant = process.env.AZURE_TENANT_ID?.trim();
const audience = process.env.AZURE_API_CLIENT_ID?.trim();
const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
const jwks = tenant
  ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`))
  : null;

export async function requireAuth(req, res, next) {
  try {
    if (!tenant || !audience)
      return res
        .status(503)
        .json({ message: "Microsoft Entra API authentication is not configured." });
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

    if (!token) return res.status(401).json({ message: "Bearer token required." });

    const { payload } = await jwtVerify(token, jwks, { issuer, audience });

    req.user = {
      id: payload.oid || payload.sub,
      email: payload.preferred_username || payload.email || "",
      name: payload.name || "",
      groups: Array.isArray(payload.groups) ? payload.groups : [],
      roles: Array.isArray(payload.roles) ? payload.roles : [],
      scopes: String(payload.scp || "").split(" "),
    };

    if (!req.user.scopes.includes("access_as_user") && !req.user.roles.includes("Support.Access"))
      return res.status(403).json({ message: "Required API scope is missing." });
    next();
  } catch (e) {
    return res.status(401).json({ message: "Invalid or expired access token." });
  }
}

export function requireSupport(req, res, next) {
  const allowed = (process.env.IT_SUPPORT_GROUP_ID || "").trim();

  if (
    req.user?.roles?.includes("Support.Agent") ||
    (allowed && req.user?.groups?.includes(allowed))
  )
    return next();
  return res.status(403).json({ message: "IT support staff access required." });
}
