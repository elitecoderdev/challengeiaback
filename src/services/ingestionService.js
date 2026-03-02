const { fetchXPost } = require('./xService');
const { fetchLinkedInPost, searchLinkedInPostUrl } = require('./linkedinService');
const { discoverFunding } = require('./fundingService');
const { enrichContacts } = require('./contactService');
const { computeEngagementScore, shouldDraftDM, draftOutreachDM } = require('./dmService');
const { isLinkedInUrl, isXUrl } = require('../utils/url');

async function processWithConcurrency(items, limit, worker) {
  const results = [];
  const executing = [];

  for (const item of items) {
    const task = Promise.resolve().then(() => worker(item));
    results.push(task);

    if (limit <= items.length) {
      const execution = task.then(() => executing.splice(executing.indexOf(execution), 1));
      executing.push(execution);
      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.all(results);
}

function dedupeAndNormalizeUrls(urls) {
  const unique = new Set();

  for (const url of urls || []) {
    if (!url) {
      continue;
    }

    const trimmed = String(url).trim();
    if (!trimmed || unique.has(trimmed)) {
      continue;
    }

    unique.add(trimmed);
  }

  return Array.from(unique);
}

function buildLaunchRecord({ xData, linkedInData, funding, contacts, poorThreshold }) {
  const companyName = xData?.companyName || linkedInData?.companyName || 'Unknown company';
  const xLikes = Number.isFinite(xData?.likes) ? xData.likes : null;
  const linkedInLikes = Number.isFinite(linkedInData?.likes) ? linkedInData.likes : null;
  const engagementScore = computeEngagementScore(xLikes, linkedInLikes);
  const poorLaunch = shouldDraftDM(engagementScore, poorThreshold);

  const launchSummary = xData?.text || linkedInData?.text || companyName;

  return {
    companyName,
    createdAt: new Date().toISOString(),
    x: xData
      ? {
          postId: xData.postId,
          postUrl: xData.postUrl,
          handle: xData.authorHandle,
          likes: xData.likes,
          comments: xData.comments,
          reposts: xData.reposts,
          text: xData.text,
          hasVideo: xData.hasVideo,
          publishedAt: xData.publishedAt,
          source: xData.source,
        }
      : null,
    linkedIn: linkedInData
      ? {
          postUrl: linkedInData.postUrl,
          likes: linkedInData.likes,
          comments: linkedInData.comments,
          text: linkedInData.text,
          source: linkedInData.source,
        }
      : null,
    funding,
    contacts,
    engagementScore,
    poorLaunch,
    dmDraft: poorLaunch
      ? draftOutreachDM({
          companyName,
          xHandle: xData?.authorHandle,
          engagementScore,
          threshold: poorThreshold,
          launchSummary,
        })
      : null,
  };
}

async function processSingleXUrl(url, poorThreshold) {
  const xData = await fetchXPost(url);
  const linkedInUrl = await searchLinkedInPostUrl(xData.companyName, xData.authorHandle).catch(() => null);
  const linkedInData = linkedInUrl ? await fetchLinkedInPost(linkedInUrl).catch(() => null) : null;

  const [funding, contacts] = await Promise.all([
    discoverFunding(xData.companyName, xData.authorHandle).catch(() => ({
      amountUsd: null,
      amountLabel: 'N/A',
      sourceUrl: null,
      sourceCategory: null,
      evidence: null,
      confidence: 'low',
    })),
    enrichContacts({ companyName: xData.companyName, xHandle: xData.authorHandle }).catch(() => ({
      email: null,
      phone: null,
      linkedin: linkedInUrl,
      x: xData.authorHandle ? `https://x.com/${xData.authorHandle.replace('@', '')}` : null,
      website: null,
    })),
  ]);

  return buildLaunchRecord({
    xData,
    linkedInData,
    funding,
    contacts,
    poorThreshold,
  });
}

async function processSingleLinkedInUrl(url, poorThreshold) {
  const linkedInData = await fetchLinkedInPost(url);

  const [funding, contacts] = await Promise.all([
    discoverFunding(linkedInData.companyName, null).catch(() => ({
      amountUsd: null,
      amountLabel: 'N/A',
      sourceUrl: null,
      sourceCategory: null,
      evidence: null,
      confidence: 'low',
    })),
    enrichContacts({ companyName: linkedInData.companyName, xHandle: null }).catch(() => ({
      email: null,
      phone: null,
      linkedin: url,
      x: null,
      website: null,
    })),
  ]);

  return buildLaunchRecord({
    xData: null,
    linkedInData,
    funding,
    contacts,
    poorThreshold,
  });
}

async function ingestLaunchUrls({ urls, maxItems = 25, poorThreshold = 500 }) {
  const cleaned = dedupeAndNormalizeUrls(urls).slice(0, maxItems);

  const work = cleaned.map((url) => {
    if (isXUrl(url)) {
      return { url, type: 'x' };
    }

    if (isLinkedInUrl(url)) {
      return { url, type: 'linkedin' };
    }

    return { url, type: 'unknown' };
  });

  const skipped = work.filter((item) => item.type === 'unknown').map((item) => item.url);
  const actionable = work.filter((item) => item.type !== 'unknown');

  const results = await processWithConcurrency(actionable, 4, async (item) => {
    try {
      if (item.type === 'x') {
        return {
          ok: true,
          record: await processSingleXUrl(item.url, poorThreshold),
          sourceUrl: item.url,
        };
      }

      return {
        ok: true,
        record: await processSingleLinkedInUrl(item.url, poorThreshold),
        sourceUrl: item.url,
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message,
        sourceUrl: item.url,
      };
    }
  });

  const succeeded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);

  return {
    records: succeeded.map((result) => result.record),
    meta: {
      requested: urls.length,
      processed: cleaned.length,
      succeeded: succeeded.length,
      failed: failed.length,
      skipped: skipped.length,
      failures: failed,
      skippedUrls: skipped,
    },
  };
}

module.exports = {
  ingestLaunchUrls,
};
