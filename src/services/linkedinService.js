const { fetchText } = require('./httpClient');
const { parseCompactNumber } = require('../utils/number');
const { toRinaProxyUrl } = require('../utils/url');

function decodeDuckDuckGoTarget(url) {
  try {
    const parsed = new URL(url);
    const encoded = parsed.searchParams.get('uddg');
    return encoded ? decodeURIComponent(encoded) : null;
  } catch (error) {
    return null;
  }
}

function extractDuckDuckGoResults(markdown) {
  const regex = /\[[^\]]+\]\((http:\/\/duckduckgo\.com\/l\/\?uddg=[^)]+)\)/g;
  const results = [];
  const seen = new Set();
  let match;

  while ((match = regex.exec(markdown)) !== null) {
    const target = decodeDuckDuckGoTarget(match[1]);
    if (!target || seen.has(target)) {
      continue;
    }

    seen.add(target);
    results.push(target);
  }

  return results;
}

async function searchLinkedInPostUrl(companyName, xHandle) {
  const queryParts = ['site:linkedin.com/posts', companyName, 'launch'];
  if (xHandle) {
    queryParts.push(String(xHandle).replace('@', ''));
  }

  const query = encodeURIComponent(queryParts.join(' '));
  const searchUrl = `https://r.jina.ai/http://html.duckduckgo.com/html/?q=${query}`;

  const markdown = await fetchText(searchUrl, { timeoutMs: 18_000 });
  const candidates = extractDuckDuckGoResults(markdown).filter((target) => /linkedin\.com\/posts\//i.test(target));

  return candidates[0] || null;
}

function parseLinkedInMetrics(markdown, sourceUrl) {
  const companyNameMatch = markdown.match(/\n\[([^\]\n]+)\]\(https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|school)\/[^)]+\?trk=public_post_feed-actor-name\)/i);
  const profileNameMatch = markdown.match(/\n\[([^\]\n]+)\]\(https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[^)]+\?trk=public_post_feed-actor-name\)/i);
  const companyName = companyNameMatch?.[1]?.trim() || profileNameMatch?.[1]?.trim() || null;

  const likesMatch = markdown.match(/([0-9][0-9,]*)\]\([^\)]*public_post_social-actions-reactions\)/i);
  const commentsMatch = markdown.match(/\[([0-9][0-9,]*)\s+Comments?\]/i);

  const textMatch = markdown.match(/\n\n(?:\d+[hdwm]\s+Edited|\d+[hdwm])\s*\n\n([\s\S]{1,2000}?)\n\n\s*…more/i);

  return {
    platform: 'linkedin',
    postUrl: sourceUrl,
    companyName: companyName || 'Unknown LinkedIn author',
    text: textMatch ? textMatch[1].replace(/\s+/g, ' ').trim() : null,
    likes: likesMatch ? parseCompactNumber(likesMatch[1]) : null,
    comments: commentsMatch ? parseCompactNumber(commentsMatch[1]) : null,
    source: 'linkedin-public-page',
  };
}

async function fetchLinkedInPost(url) {
  const proxyUrl = toRinaProxyUrl(url);
  const markdown = await fetchText(proxyUrl, { timeoutMs: 22_000 });
  const parsed = parseLinkedInMetrics(markdown, url);

  return parsed;
}

module.exports = {
  searchLinkedInPostUrl,
  fetchLinkedInPost,
};
