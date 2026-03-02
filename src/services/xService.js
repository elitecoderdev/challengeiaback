const { fetchJson, fetchText } = require('./httpClient');
const { parseCompactNumber } = require('../utils/number');
const { extractTweetId, normalizeXUrl, toRinaProxyUrl } = require('../utils/url');

function inferCompanyName(userName, screenName) {
  if (userName && userName.trim().length >= 2) {
    return userName.trim();
  }

  if (!screenName) {
    return 'Unknown company';
  }

  const normalized = screenName
    .replace(/^@/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return normalized;
}

function safeIsoDate(rawDate) {
  if (!rawDate) {
    return null;
  }

  const asDate = new Date(rawDate);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

async function fetchFromVxTwitter(tweetId) {
  const endpoint = `https://api.vxtwitter.com/Twitter/status/${tweetId}`;
  const payload = await fetchJson(endpoint, { timeoutMs: 20_000 });

  return {
    platform: 'x',
    postId: payload.tweetID || tweetId,
    postUrl: payload.tweetURL ? payload.tweetURL.replace('twitter.com', 'x.com') : null,
    authorName: payload.user_name || null,
    authorHandle: payload.user_screen_name ? `@${payload.user_screen_name}` : null,
    companyName: inferCompanyName(payload.user_name, payload.user_screen_name),
    text: payload.text || null,
    likes: Number.isFinite(payload.likes) ? payload.likes : null,
    comments: Number.isFinite(payload.replies) ? payload.replies : null,
    reposts: Number.isFinite(payload.retweets) ? payload.retweets : null,
    hasVideo: Boolean(payload.hasMedia),
    mediaUrls: Array.isArray(payload.mediaURLs) ? payload.mediaURLs : [],
    publishedAt: safeIsoDate(payload.date),
    source: 'vxtwitter',
  };
}

function parseXFallbackMarkdown(markdown, originalUrl) {
  const handleMatch = markdown.match(/\[@([A-Za-z0-9_]+)\]\(https?:\/\/x\.com\/[A-Za-z0-9_]+\)/i);
  const authorHandle = handleMatch ? `@${handleMatch[1]}` : null;

  const authorNameMatch = markdown.match(/\n\[([^\]\n]+)\]\(https?:\/\/x\.com\/[A-Za-z0-9_]+\)\n\n\[@/i);
  const authorName = authorNameMatch ? authorNameMatch[1].trim() : null;

  const dateMatch = markdown.match(/\[(\d{1,2}:\d{2} [AP]M · [A-Za-z]{3} \d{1,2}, \d{4})\]\(https?:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+\)/);

  let likes = null;
  let comments = null;
  let reposts = null;

  const metricsBlock = markdown.match(/Views\]\([^\)]*\)\s*\n\s*\n([\s\S]{0,120})Read\s+\d+\s+repl/i);
  if (metricsBlock && metricsBlock[1]) {
    const numbers = metricsBlock[1]
      .match(/[0-9][0-9,.]*(?:K|M|B)?/g)
      ?.map((part) => parseCompactNumber(part))
      .filter((value) => Number.isFinite(value));

    if (numbers && numbers.length >= 3) {
      comments = numbers[0];
      reposts = numbers[1];
      likes = numbers[2];
    }
  }

  const textMatch = markdown.match(/\n\[@[A-Za-z0-9_]+\]\([^\)]*\)\n\n([\s\S]{1,1000}?)\n\n(?:\d+:\d{2}|\[\d{1,2}:\d{2} [AP]M)/i);
  const text = textMatch ? textMatch[1].replace(/\s+/g, ' ').trim() : null;

  return {
    platform: 'x',
    postId: extractTweetId(originalUrl),
    postUrl: normalizeXUrl(originalUrl),
    authorName,
    authorHandle,
    companyName: inferCompanyName(authorName, authorHandle || ''),
    text,
    likes,
    comments,
    reposts,
    hasVideo: /video_thumb|\n\d+:\d{2}\n/i.test(markdown),
    mediaUrls: [],
    publishedAt: dateMatch ? safeIsoDate(dateMatch[1]) : null,
    source: 'r-jina-fallback',
  };
}

async function fetchFromFallback(originalUrl) {
  const proxyUrl = toRinaProxyUrl(originalUrl);
  const markdown = await fetchText(proxyUrl, { timeoutMs: 25_000 });
  return parseXFallbackMarkdown(markdown, originalUrl);
}

async function fetchXPost(url) {
  const tweetId = extractTweetId(url);
  if (!tweetId) {
    throw new Error(`Invalid X URL: ${url}`);
  }

  try {
    const fromPrimary = await fetchFromVxTwitter(tweetId);
    return {
      ...fromPrimary,
      postUrl: fromPrimary.postUrl || normalizeXUrl(url),
    };
  } catch (primaryError) {
    try {
      return await fetchFromFallback(url);
    } catch (fallbackError) {
      throw new Error(
        `Failed to fetch X post ${tweetId}. Primary error: ${primaryError.message}. Fallback error: ${fallbackError.message}`
      );
    }
  }
}

module.exports = {
  fetchXPost,
};
