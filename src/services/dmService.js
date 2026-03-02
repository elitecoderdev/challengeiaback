function computeEngagementScore(xLikes, linkedInLikes) {
  const x = Number.isFinite(xLikes) ? xLikes : 0;
  const li = Number.isFinite(linkedInLikes) ? linkedInLikes : 0;
  return x + li;
}

function shouldDraftDM(engagementScore, threshold) {
  return engagementScore < threshold;
}

function draftOutreachDM({ companyName, xHandle, engagementScore, threshold, launchSummary }) {
  const greetingName = xHandle || companyName;
  const summary = launchSummary ? launchSummary.slice(0, 180) : 'your launch video';

  return `Hey ${greetingName}, I checked out ${summary}.\n\nYou have strong product energy, but engagement (${engagementScore}) is below the ${threshold} benchmark right now. I can share a quick 3-step boost plan for creative angle + first-reply strategy + repost sequencing to improve distribution in 24h.\n\nWant me to send it?`;
}

module.exports = {
  computeEngagementScore,
  shouldDraftDM,
  draftOutreachDM,
};
