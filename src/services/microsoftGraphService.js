import { ClientSecretCredential } from "@azure/identity";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;

let cachedSupportMembers = null;
let cacheExpiresAt = 0;

let credential;

function getCredential() {
  const tenant = process.env.AZURE_TENANT_ID?.trim();
  const clientId = process.env.AZURE_API_CLIENT_ID?.trim();
  const secret = process.env.AZURE_CLIENT_SECRET;

  if (!tenant || !clientId || !secret) {
    throw new Error("Microsoft Graph credentials are not configured.");
  }

  if (!credential) {
    credential = new ClientSecretCredential(tenant, clientId, secret);
  }

  return credential;
}

async function getGraphToken() {
  const token = await getCredential().getToken("https://graph.microsoft.com/.default");

  if (!token?.token) {
    throw new Error("Unable to obtain Microsoft Graph access token.");
  }

  return token.token;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function graphGet(url, accessToken) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        return response.json();
      }

      const errorBody = await response.text();

      const retryable = response.status === 429 || response.status >= 500;

      if (!retryable || attempt === MAX_RETRIES) {
        throw new Error(`Microsoft Graph request failed (${response.status}): ${errorBody}`);
      }

      const retryAfter = Number(response.headers.get("retry-after"));

      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 8000);

      console.warn(`Microsoft Graph returned ${response.status}. Retrying in ${waitMs}ms.`);

      await delay(waitMs);
    } catch (error) {
      const isNetworkError =
        error.name === "AbortError" || error.name === "TimeoutError" || error.name === "TypeError";

      if (!isNetworkError || attempt === MAX_RETRIES) {
        throw error;
      }

      const waitMs = Math.min(1000 * 2 ** attempt, 8000);

      console.warn(`Microsoft Graph network error. Retrying in ${waitMs}ms.`);

      await delay(waitMs);
    }
  }

  throw new Error("Microsoft Graph request failed after retries.");
}

export async function getSupportGroupMembers(forceRefresh = false) {
  const groupId = process.env.IT_SUPPORT_GROUP_ID?.trim();

  if (!groupId) {
    throw new Error("IT_SUPPORT_GROUP_ID is not configured.");
  }

  if (!forceRefresh && cachedSupportMembers && Date.now() < cacheExpiresAt) {
    return cachedSupportMembers;
  }

  const accessToken = await getGraphToken();

  let nextUrl =
    `${GRAPH_BASE_URL}/groups/${encodeURIComponent(groupId)}/members` +
    "?$select=id,displayName,mail,userPrincipalName&$top=999";

  const members = [];

  while (nextUrl) {
    const data = await graphGet(nextUrl, accessToken);

    for (const member of data.value || []) {
      if (member["@odata.type"] === "#microsoft.graph.user" && member.id) {
        members.push({
          id: member.id,
          displayName: member.displayName || "",
          email: member.mail || member.userPrincipalName || "",
        });
      }
    }

    nextUrl = data["@odata.nextLink"] || null;
  }

  cachedSupportMembers = [...new Map(members.map((member) => [member.id, member])).values()];

  cacheExpiresAt = Date.now() + CACHE_DURATION;

  // console.log(`[Microsoft Graph] Retrieved ${cachedSupportMembers.length} IT Support members.`);

  return cachedSupportMembers;
}

export async function getSupportGroupMemberIds(forceRefresh = false) {
  const members = await getSupportGroupMembers(forceRefresh);

  return members.map((member) => member.id);
}

export async function getGraphUserById(userId) {
  if (!userId) return null;

  const accessToken = await getGraphToken();

  const url =
    `${GRAPH_BASE_URL}/users/${encodeURIComponent(userId)}` +
    "?$select=id,displayName,mail,userPrincipalName";

  const user = await graphGet(url, accessToken);

  return {
    id: user.id,
    displayName: user.displayName || "",
    email: user.mail || user.userPrincipalName || "",
  };
}
