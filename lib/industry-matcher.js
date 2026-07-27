/**
 * Industry Matcher — Shared Library
 * Classifies social media posts and text to determine relevance
 * to the AV/event technology industry and scores them for
 * engagement priority.
 */

// AV industry keyword taxonomy
const INDUSTRY_TAXONOMY = {
  "job-request": {
    weight: 1.0,
    keywords: [
      "need av tech", "looking for av", "hiring av", "need sound engineer",
      "need lighting tech", "need video tech", "av technician needed",
      "event tech needed", "av crew needed", "freelance av", "av gig",
      "av job", "av work", "av opportunity", "av contract",
    ],
  },
  "event-production": {
    weight: 0.8,
    keywords: [
      "corporate event", "live event", "conference av", "trade show",
      "concert production", "stage setup", "event production", "live stream",
      "hybrid event", "virtual event", "av setup", "av production",
      "audio visual", "audiovisual",
    ],
  },
  "equipment": {
    weight: 0.6,
    keywords: [
      "sound system", "pa system", "lighting rig", "led wall", "projection",
      "video wall", "broadcast", "live mixing", "audio mixing", "dmx",
      "rigging", "truss", "stage lighting", "followspot",
    ],
  },
  "professional": {
    weight: 0.7,
    keywords: [
      "av technician", "sound technician", "lighting designer", "video director",
      "broadcast engineer", "a1", "a2", "l1", "l2", "v1", "v2",
      "stage manager", "technical director", "td", "show caller",
    ],
  },
  "location-signal": {
    weight: 0.5,
    keywords: [
      "phoenix av", "las vegas av", "los angeles av", "new york av",
      "chicago av", "dallas av", "atlanta av", "miami av", "houston av",
      "denver av", "seattle av", "nashville av",
    ],
  },
};

/**
 * Match text against AV industry taxonomy and return relevance score.
 * @param {string} text
 * @returns {{ isRelevant: boolean, score: number, category: string, matchedKeywords: string[] }}
 */
export async function matchIndustry(text) {
  if (!text || typeof text !== "string") {
    return { isRelevant: false, score: 0, category: "none", matchedKeywords: [] };
  }

  const normalized = text.toLowerCase();
  let totalScore = 0;
  let topCategory = "none";
  let topCategoryScore = 0;
  const matchedKeywords = [];

  for (const [category, config] of Object.entries(INDUSTRY_TAXONOMY)) {
    let categoryScore = 0;
    for (const keyword of config.keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        categoryScore += config.weight;
        matchedKeywords.push(keyword);
      }
    }
    if (categoryScore > 0) {
      totalScore += categoryScore;
      if (categoryScore > topCategoryScore) {
        topCategoryScore = categoryScore;
        topCategory = category;
      }
    }
  }

  // Normalize score to 0–1 range (cap at 1.0)
  const normalizedScore = Math.min(totalScore / 3, 1.0);

  return {
    isRelevant: normalizedScore >= 0.4,
    score: Math.round(normalizedScore * 100) / 100,
    category: topCategory,
    matchedKeywords: [...new Set(matchedKeywords)],
  };
}

/**
 * Score a list of texts and return sorted by relevance.
 * @param {Array<{id: string, text: string}>} items
 * @returns {Promise<Array>}
 */
export async function batchMatchIndustry(items) {
  const results = await Promise.all(
    items.map(async (item) => {
      const match = await matchIndustry(item.text);
      return { ...item, ...match };
    })
  );
  return results
    .filter((r) => r.isRelevant)
    .sort((a, b) => b.score - a.score);
}

export default { matchIndustry, batchMatchIndustry };
