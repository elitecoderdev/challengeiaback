const { fetchText } = require('./httpClient');
const { toCurrencyLabel } = require('../utils/number');

function decodeDuckDuckGoTarget(url) {
  try {
    const parsed = new URL(url);
    const encoded = parsed.searchParams.get('uddg');
    return encoded ? decodeURIComponent(encoded) : null;
  } catch (error) {
    return null;
  }
}

function extractDuckDuckGoLinks(markdown) {
  const regex = /\[[^\]]+\]\((http:\/\/duckduckgo\.com\/l\/\?uddg=[^)]+)\)/g;
  const links = [];
  const seen = new Set();
  let match;

  while ((match = regex.exec(markdown)) !== null) {
    const decoded = decodeDuckDuckGoTarget(match[1]);
    if (!decoded || seen.has(decoded)) {
      continue;
    }

    seen.add(decoded);
    links.push(decoded);
  }

  return links;
}

function parseUsdAmount(text) {
  if (!text) {
    return null;
  }

  const patterns = [
    /\$\s?([0-9]+(?:\.[0-9]+)?)\s?(B|M|K|billion|million|thousand)?/gi,
    /raised\s+([0-9]+(?:\.[0-9]+)?)\s?(B|M|K|billion|million|thousand)\b/gi,
    /total\s+(?:capital\s+)?raised\s+to\s+\$?([0-9]+(?:\.[0-9]+)?)\s?(B|M|K|billion|million|thousand)?/gi,
  ];

  const multipliers = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
    THOUSAND: 1_000,
    MILLION: 1_000_000,
    BILLION: 1_000_000_000,
  };

  const candidates = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const amount = Number(match[1]);
      if (!Number.isFinite(amount)) {
        continue;
      }

      const suffix = (match[2] || '').toUpperCase();
      const multiplier = multipliers[suffix] || 1;
      const amountUsd = amount * multiplier;

      if (amountUsd < 50_000) {
        continue;
      }

      // We focus on startup fundraises; very large macro amounts are usually false positives.
      if (amountUsd > 5_000_000_000) {
        continue;
      }

      candidates.push(amountUsd);
    }
  }

  if (!candidates.length) {
    return null;
  }

  return candidates[0] || null;
}

function inferSourceCategory(url) {
  if (!url) {
    return null;
  }

  if (/crunchbase\.com/i.test(url)) {
    return 'Crunchbase';
  }

  if (/ycombinator\.com/i.test(url)) {
    return 'Y Combinator';
  }

  if (/techcrunch\.com/i.test(url)) {
    return 'TechCrunch';
  }

  if (/pitchbook\.com/i.test(url)) {
    return 'PitchBook';
  }

  if (/tracxn\.com/i.test(url)) {
    return 'Tracxn';
  }

  return 'Web search';
}

function rankFundingLine(line) {
  let score = 0;

  if (/total\s+(capital\s+)?raised|valuation|funding\s+round/i.test(line)) {
    score += 3;
  }

  if (/crunchbase|ycombinator|techcrunch|pitchbook|tracxn|series\s+[abc]/i.test(line)) {
    score += 2;
  }

  if (/raised|funding|investor|seed|series/i.test(line)) {
    score += 2;
  }

  if (/\$\s?[0-9]/.test(line)) {
    score += 2;
  }

  return score;
}

async function discoverFunding(companyName, xHandle) {
  const queryParts = [companyName, 'funding', 'raised', 'crunchbase', 'ycombinator'];
  if (xHandle) {
    queryParts.push(String(xHandle).replace('@', ''));
  }

  const query = encodeURIComponent(queryParts.join(' '));
  const searchUrl = `https://r.jina.ai/http://html.duckduckgo.com/html/?q=${query}`;
  const markdown = await fetchText(searchUrl, { timeoutMs: 20_000 });

  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const candidateLines = lines.filter((line) => /raised|funding|valuation|investor|series|\$\s?[0-9]/i.test(line));

  let bestLine = null;
  let bestScore = -1;
  for (const line of candidateLines) {
    const score = rankFundingLine(line);
    if (score > bestScore) {
      bestLine = line;
      bestScore = score;
    }
  }

  const amountUsd = parseUsdAmount(bestLine || markdown);
  const links = extractDuckDuckGoLinks(markdown);
  const sourceUrl =
    links.find((link) => /crunchbase|ycombinator|techcrunch|pitchbook|tracxn|wellfound|indexventures/i.test(link)) ||
    links[0] ||
    null;

  const confidence = !amountUsd ? 'low' : bestScore >= 6 ? 'high' : 'medium';

  return {
    amountUsd,
    amountLabel: amountUsd ? toCurrencyLabel(amountUsd) : 'N/A',
    sourceUrl,
    sourceCategory: inferSourceCategory(sourceUrl),
    evidence: bestLine,
    confidence,
  };
}

module.exports = {
  discoverFunding,
};
