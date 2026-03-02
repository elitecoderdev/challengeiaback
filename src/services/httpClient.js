async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs || 20_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json,text/plain,text/markdown,text/html,*/*',
        ...(options.headers || {}),
      },
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}) for ${url}. ${body.slice(0, 300)}`);
  }

  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, options);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}) for ${url}. ${body.slice(0, 300)}`);
  }

  return response.text();
}

module.exports = {
  fetchJson,
  fetchText,
};
