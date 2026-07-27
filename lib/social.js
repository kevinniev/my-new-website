/**
 * Social Media Posting Utilities
 * Shared across all autoposting and engagement functions.
 *
 * Credentials injected via Vercel Environment Variables.
 */

// ─── Facebook ─────────────────────────────────────────────────────────────────

/**
 * Post to a Facebook Page.
 * @param {string} message
 * @param {string} [imageUrl]
 */
export async function postToFacebook(message, imageUrl) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) throw new Error("Facebook credentials not configured");

  if (imageUrl) {
    // Photo post
    const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: imageUrl, caption: message, access_token: token }),
    });
    return res.json();
  }
  // Text post
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: token }),
  });
  return res.json();
}

// ─── Instagram ────────────────────────────────────────────────────────────────

/**
 * Post to Instagram (requires an image URL — Instagram does not support text-only posts).
 * @param {string} caption
 * @param {string} imageUrl
 */
export async function postToInstagram(caption, imageUrl) {
  const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!accountId || !token) throw new Error("Instagram credentials not configured");

  // Step 1: Create media container
  const createRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
    }
  );
  const { id: creationId } = await createRes.json();
  if (!creationId) throw new Error("Instagram media container creation failed");

  // Step 2: Publish
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${accountId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: creationId, access_token: token }),
    }
  );
  return publishRes.json();
}

// ─── X (Twitter) ─────────────────────────────────────────────────────────────

/**
 * Post a tweet using OAuth 1.0a.
 * @param {string} text
 */
export async function postToX(text) {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;
  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    throw new Error("X (Twitter) credentials not configured");
  }

  // Build OAuth 1.0a header
  const oauth = buildOAuth1Header("POST", "https://api.twitter.com/2/tweets", {}, {
    apiKey, apiSecret, accessToken, accessSecret,
  });

  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: oauth,
    },
    body: JSON.stringify({ text }),
  });
  return res.json();
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────

/**
 * Post to LinkedIn as a person or organization.
 * @param {string} text
 * @param {string} [authorUrn]  e.g. "urn:li:person:XXXX" or "urn:li:organization:XXXX"
 */
export async function postToLinkedIn(text, authorUrn) {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) throw new Error("LinkedIn credentials not configured");
  const author = authorUrn || `urn:li:person:${process.env.LINKEDIN_PERSON_ID || "me"}`;

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });
  return res.json();
}

// ─── Threads ──────────────────────────────────────────────────────────────────

/**
 * Post to Threads.
 * @param {string} text
 * @param {string} [imageUrl]
 */
export async function postToThreads(text, imageUrl) {
  const userId = process.env.THREADS_USER_ID;
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!userId || !token) throw new Error("Threads credentials not configured");

  // Step 1: Create container
  const containerBody = imageUrl
    ? { media_type: "IMAGE", image_url: imageUrl, text, access_token: token }
    : { media_type: "TEXT", text, access_token: token };

  const createRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerBody),
    }
  );
  const { id: creationId } = await createRes.json();
  if (!creationId) throw new Error("Threads container creation failed");

  // Step 2: Publish
  const publishRes = await fetch(
    `https://graph.threads.net/v1.0/${userId}/threads_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: creationId, access_token: token }),
    }
  );
  return publishRes.json();
}

// ─── OAuth 1.0a Helper (for X) ────────────────────────────────────────────────

function buildOAuth1Header(method, url, params, credentials) {
  const { apiKey, apiSecret, accessToken, accessSecret } = credentials;
  const nonce = Math.random().toString(36).substring(2);
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // Build base string
  const allParams = { ...params, ...oauthParams };
  const sortedParams = Object.keys(allParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join("&");
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join("&");

  // Sign with HMAC-SHA256 (Node.js crypto)
  const { createHmac } = require("crypto");
  const signingKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessSecret)}`;
  const signature = createHmac("sha256", signingKey)
    .update(baseString)
    .digest("base64");

  oauthParams.oauth_signature = signature;

  const headerValue = "OAuth " + Object.keys(oauthParams)
    .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(", ");

  return headerValue;
}

export default {
  postToFacebook,
  postToInstagram,
  postToX,
  postToLinkedIn,
  postToThreads,
};
