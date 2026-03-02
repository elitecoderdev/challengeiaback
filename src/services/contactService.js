const { fetchText } = require('./httpClient');

const SOCIAL_HOSTS = [
  'x.com',
  'twitter.com',
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'tiktok.com',
];

function decodeDuckDuckGoTarget(url) {
  try {
    const parsed = new URL(url);
    const encoded = parsed.searchParams.get('uddg');
    return encoded ? decodeURIComponent(encoded) : null;
  } catch (error) {
    return null;
  }
}

function extractDuckDuckGoTargets(markdown) {
  const regex = /\[[^\]]+\]\((http:\/\/duckduckgo\.com\/l\/\?uddg=[^)]+)\)/g;
  const targets = [];
  const seen = new Set();
  let match;

  while ((match = regex.exec(markdown)) !== null) {
    const decoded = decodeDuckDuckGoTarget(match[1]);
    if (!decoded || seen.has(decoded)) {
      continue;
    }

    seen.add(decoded);
    targets.push(decoded);
  }

  return targets;
}

function pickWebsite(candidates) {
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const isSocial = SOCIAL_HOSTS.some((host) => parsed.hostname.includes(host));
      if (!isSocial) {
        return candidate;
      }
    } catch (error) {
      // Ignore malformed URL.
    }
  }

  return null;
}

function pickLinkedIn(candidates, companyName) {
  const companySlug = String(companyName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (companySlug) {
    const strictMatch = candidates.find(
      (item) => /linkedin\.com\/(company|in|posts)\//i.test(item) && item.toLowerCase().includes(companySlug)
    );
    if (strictMatch) {
      return strictMatch;
    }
  }

  return candidates.find((item) => /linkedin\.com\/(company|in|posts)\//i.test(item)) || null;
}

function extractEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (!match) {
    return null;
  }

  return match.find((email) => !/example\./i.test(email)) || match[0] || null;
}

function extractPhone(text) {
  const candidates = text.match(/\+?\d[\d\s()-]{8,}\d/g) || [];

  for (const candidate of candidates) {
    if (candidate.includes('\n')) {
      continue;
    }

    const digits = candidate.replace(/\D/g, '');
    const hasSeparator = /[\s()-]/.test(candidate);

    if (!hasSeparator) {
      continue;
    }

    if (digits.length >= 10 && digits.length <= 15) {
      return candidate.trim();
    }
  }

  return null;
}

const cache = new Map();

async function enrichContacts({ companyName, xHandle }) {
  const cacheKey = `${companyName}::${xHandle || ''}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const query = encodeURIComponent(`${companyName} official website contact email phone linkedin`);
  const searchUrl = `https://r.jina.ai/http://html.duckduckgo.com/html/?q=${query}`;

  const searchMarkdown = await fetchText(searchUrl, { timeoutMs: 18_000 });
  const targets = extractDuckDuckGoTargets(searchMarkdown);

  const website = pickWebsite(targets);
  const linkedin = pickLinkedIn(targets, companyName);
  const x = xHandle ? `https://x.com/${String(xHandle).replace('@', '')}` : null;

  let email = null;
  let phone = null;

  if (website) {
    try {
      const siteMarkdown = await fetchText(`https://r.jina.ai/http://${website.replace(/^https?:\/\//, '')}`, {
        timeoutMs: 16_000,
      });
      email = extractEmail(siteMarkdown);
      phone = extractPhone(siteMarkdown);
    } catch (error) {
      // Ignore failures on website content fetch.
    }
  }

  const result = {
    email,
    phone,
    linkedin,
    x,
    website,
  };

  cache.set(cacheKey, result);
  return result;
}

module.exports = {
  enrichContacts,
};
