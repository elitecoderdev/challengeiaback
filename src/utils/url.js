function extractTweetId(url) {
  if (!url) {
    return null;
  }

  const match = String(url).match(/status\/(\d+)/i);
  return match ? match[1] : null;
}

function normalizeXUrl(url) {
  const tweetId = extractTweetId(url);
  if (!tweetId) {
    return url;
  }

  const handleMatch = String(url).match(/x\.com\/([^/]+)/i);
  const handle = handleMatch ? handleMatch[1] : 'i';
  return `https://x.com/${handle}/status/${tweetId}`;
}

function isXUrl(url) {
  return /https?:\/\/(www\.)?x\.com\//i.test(String(url || ''));
}

function isLinkedInUrl(url) {
  return /https?:\/\/(www\.)?linkedin\.com\//i.test(String(url || ''));
}

function toRinaProxyUrl(url) {
  const cleaned = String(url || '').trim();
  if (!cleaned) {
    return null;
  }

  if (cleaned.startsWith('https://r.jina.ai/http://') || cleaned.startsWith('https://r.jina.ai/https://')) {
    return cleaned;
  }

  const withoutProtocol = cleaned.replace(/^https?:\/\//, '');
  return `https://r.jina.ai/http://${withoutProtocol}`;
}

module.exports = {
  extractTweetId,
  normalizeXUrl,
  isXUrl,
  isLinkedInUrl,
  toRinaProxyUrl,
};
