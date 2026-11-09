import { ClientSecretCredential } from "@azure/identity";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

let cachedSupportUserIds = null;
let cacheExpiresAt = 0;

let credential;

function getCredential() {
  console.log(process.env.AZURE_TENANT_ID);
  console.log(process.env.AZURE_API_CLIENT_ID);
  console.log(process.env.AZURE_CLIENT_SECRET);

  if (
    !process.env.AZURE_TENANT_ID ||
    !process.env.AZURE_API_CLIENT_ID ||
    !process.env.AZURE_CLIENT_SECRET
  ) {
    throw new Error("Microsoft Graph credentials are not configured.");
  }

  if (!credential) {
    credential = new ClientSecretCredential(
      process.env.AZURE_TENANT_ID,
      process.env.AZURE_API_CLIENT_ID,
      process.env.AZURE_CLIENT_SECRET,
    );
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

export async function getSupportGroupMemberIds(forceRefresh = false) {
  const groupId = process.env.IT_SUPPORT_GROUP_ID;

  if (!groupId) {
    throw new Error("IT_SUPPORT_GROUP_ID is not configured.");
  }

  // Return cached membership where available.
  if (!forceRefresh && cachedSupportUserIds && Date.now() < cacheExpiresAt) {
    return cachedSupportUserIds;
  }

  const accessToken = await getGraphToken();

  let nextUrl =
    `${GRAPH_BASE_URL}/groups/${encodeURIComponent(groupId)}/members` + `?$select=id&$top=999`;

  const memberIds = [];

  // Continue until Microsoft Graph has returned every page.
  while (nextUrl) {
    const response = await fetch(nextUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();

      throw new Error(
        `Microsoft Graph membership lookup failed (${response.status}): ${errorBody}`,
      );
    }

    const data = await response.json();

    for (const member of data.value || []) {
      // Only users should receive ticket notifications.
      if (member["@odata.type"] === "#microsoft.graph.user" && member.id) {
        memberIds.push(member.id);
      }
    }

    nextUrl = data["@odata.nextLink"] || null;
  }

  const uniqueMemberIds = [...new Set(memberIds)];

  cachedSupportUserIds = uniqueMemberIds;
  cacheExpiresAt = Date.now() + CACHE_DURATION;

  console.log(`[Microsoft Graph] Retrieved ${uniqueMemberIds.length} IT Support members.`);

  return uniqueMemberIds;
}
