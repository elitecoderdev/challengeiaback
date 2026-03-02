const fs = require('fs/promises');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DATA_PATH = path.join(process.cwd(), 'data', 'launches.json');
const SUPABASE_TABLE = process.env.SUPABASE_STATE_TABLE || 'app_state';
const SUPABASE_STORE_KEY = process.env.SUPABASE_STORE_KEY || 'launch-dashboard-state';
const SUPABASE_MAX_RETRIES = Math.max(1, Number(process.env.SUPABASE_MAX_RETRIES || 3));
const SUPABASE_RETRY_BASE_MS = Math.max(100, Number(process.env.SUPABASE_RETRY_BASE_MS || 400));
const SUPABASE_LOCAL_FALLBACK_ON_ERROR =
  String(process.env.SUPABASE_LOCAL_FALLBACK_ON_ERROR || '1').toLowerCase() !== '0';

let supabaseClient = null;

function getSupabaseCredentials() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  return { url, key };
}

function shouldUseSupabase() {
  const { url, key } = getSupabaseCredentials();
  return Boolean(url && key);
}

function isVercelRuntime() {
  return String(process.env.VERCEL || '').toLowerCase() === '1';
}

function getSupabaseClient() {
  if (!shouldUseSupabase()) {
    return null;
  }

  if (!supabaseClient) {
    const { url, key } = getSupabaseCredentials();
    supabaseClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return supabaseClient;
}

function baseState() {
  return {
    updatedAt: new Date().toISOString(),
    launches: [],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeErrorMessage(message) {
  const text = String(message || '').trim();
  if (!text) {
    return 'Unknown error.';
  }

  if (/<!DOCTYPE html>/i.test(text) || /<html/i.test(text)) {
    if (/525|SSL handshake failed/i.test(text)) {
      return 'Cloudflare 525 SSL handshake failed while reaching Supabase.';
    }

    return 'Supabase returned a non-JSON HTML error response.';
  }

  return text.slice(0, 500);
}

async function withRetry(label, fn) {
  let lastError = null;

  for (let attempt = 1; attempt <= SUPABASE_MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < SUPABASE_MAX_RETRIES) {
        await sleep(SUPABASE_RETRY_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }

  throw new Error(`${label}: ${sanitizeErrorMessage(lastError?.message || lastError)}`);
}

function normalizeStorePayload(payload, updatedAtFromRow = null) {
  const launches = Array.isArray(payload?.launches) ? payload.launches : [];
  const updatedAt =
    typeof payload?.updatedAt === 'string'
      ? payload.updatedAt
      : updatedAtFromRow ||
        new Date().toISOString();

  return {
    updatedAt,
    launches,
  };
}

function assertStoreConfig() {
  if (isVercelRuntime() && !shouldUseSupabase()) {
    throw new Error(
      'Supabase is required in Vercel runtime. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).'
    );
  }
}

async function ensureFileStore() {
  const dir = path.dirname(DATA_PATH);
  await fs.mkdir(dir, { recursive: true });

  try {
    await fs.access(DATA_PATH);
  } catch (error) {
    await fs.writeFile(DATA_PATH, JSON.stringify(baseState(), null, 2), 'utf-8');
  }
}

async function loadStoreFromFile() {
  await ensureFileStore();
  const raw = await fs.readFile(DATA_PATH, 'utf-8');
  return normalizeStorePayload(JSON.parse(raw));
}

async function saveStoreToFile(payload) {
  await ensureFileStore();

  const nextPayload = normalizeStorePayload({
    ...payload,
    updatedAt: new Date().toISOString(),
  });

  await fs.writeFile(DATA_PATH, JSON.stringify(nextPayload, null, 2), 'utf-8');
  return nextPayload;
}

async function loadStoreFromSupabase() {
  const client = getSupabaseClient();

  const { data, error } = await withRetry('Supabase load failed', async () =>
    client
      .from(SUPABASE_TABLE)
      .select('payload,updated_at')
      .eq('store_key', SUPABASE_STORE_KEY)
      .maybeSingle()
  );

  if (error) {
    throw new Error(`Supabase load failed: ${sanitizeErrorMessage(error.message)}`);
  }

  if (!data) {
    return saveStoreToSupabase(baseState());
  }

  return normalizeStorePayload(data.payload, data.updated_at || null);
}

async function saveStoreToSupabase(payload) {
  const client = getSupabaseClient();

  const nextPayload = normalizeStorePayload({
    ...payload,
    updatedAt: new Date().toISOString(),
  });

  const { error } = await withRetry('Supabase save failed', async () =>
    client.from(SUPABASE_TABLE).upsert(
      {
        store_key: SUPABASE_STORE_KEY,
        payload: nextPayload,
        updated_at: nextPayload.updatedAt,
      },
      {
        onConflict: 'store_key',
      }
    )
  );

  if (error) {
    throw new Error(`Supabase save failed: ${sanitizeErrorMessage(error.message)}`);
  }

  return nextPayload;
}

async function loadStore() {
  assertStoreConfig();

  if (shouldUseSupabase()) {
    try {
      return await loadStoreFromSupabase();
    } catch (error) {
      if (!isVercelRuntime() && SUPABASE_LOCAL_FALLBACK_ON_ERROR) {
        // eslint-disable-next-line no-console
        console.warn(`Supabase unavailable, falling back to local file store. Reason: ${error.message}`);
        return loadStoreFromFile();
      }

      throw error;
    }
  }

  return loadStoreFromFile();
}

async function saveStore(payload) {
  assertStoreConfig();

  if (shouldUseSupabase()) {
    try {
      return await saveStoreToSupabase(payload);
    } catch (error) {
      if (!isVercelRuntime() && SUPABASE_LOCAL_FALLBACK_ON_ERROR) {
        // eslint-disable-next-line no-console
        console.warn(`Supabase unavailable, saving to local file store. Reason: ${error.message}`);
        return saveStoreToFile(payload);
      }

      throw error;
    }
  }

  return saveStoreToFile(payload);
}

function recordKey(record) {
  if (record.x?.postId) {
    return `x:${record.x.postId}`;
  }

  if (record.linkedIn?.postUrl) {
    return `linkedin:${record.linkedIn.postUrl}`;
  }

  return `${record.companyName}:${record.createdAt || Date.now()}`;
}

async function upsertLaunches(incoming) {
  const store = await loadStore();
  const map = new Map((store.launches || []).map((item) => [recordKey(item), item]));

  for (const record of incoming) {
    map.set(recordKey(record), {
      ...map.get(recordKey(record)),
      ...record,
      updatedAt: new Date().toISOString(),
    });
  }

  const launches = Array.from(map.values()).sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  return saveStore({ launches });
}

module.exports = {
  loadStore,
  saveStore,
  upsertLaunches,
};
