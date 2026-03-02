function parseCompactNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim().replace(/,/g, '');
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)([KMB])?$/i);

  if (!match) {
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }

  const base = Number(match[1]);
  const suffix = (match[2] || '').toUpperCase();
  const multiplierMap = {
    K: 1_000,
    M: 1_000_000,
    B: 1_000_000_000,
  };

  return Math.round(base * (multiplierMap[suffix] || 1));
}

function toCurrencyLabel(amountUsd) {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return 'N/A';
  }

  if (amountUsd >= 1_000_000_000) {
    return `$${(amountUsd / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }

  if (amountUsd >= 1_000_000) {
    return `$${(amountUsd / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  if (amountUsd >= 1_000) {
    return `$${(amountUsd / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  }

  return `$${Math.round(amountUsd)}`;
}

module.exports = {
  parseCompactNumber,
  toCurrencyLabel,
};
