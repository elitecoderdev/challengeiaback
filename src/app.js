require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { z } = require('zod');

const { seedLaunchUrls } = require('./data/seedLaunchUrls');
const { loadStore, upsertLaunches, saveStore } = require('./store/dataStore');
const { ingestLaunchUrls } = require('./services/ingestionService');
const { computeEngagementScore, shouldDraftDM, draftOutreachDM } = require('./services/dmService');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const ingestSchema = z.object({
  urls: z.array(z.string().url()).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  poorThreshold: z.number().int().min(0).max(100_000).optional(),
});

const dmSchema = z.object({
  threshold: z.number().int().min(0).max(100_000),
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'launch-dashboard-api',
    date: new Date().toISOString(),
  });
});

app.get('/api/launches', async (_req, res, next) => {
  try {
    const store = await loadStore();

    const launches = store.launches.map((record) => ({
      ...record,
      engagementScore:
        record.engagementScore ?? computeEngagementScore(record.x?.likes ?? null, record.linkedIn?.likes ?? null),
    }));

    res.json({
      launches,
      updatedAt: store.updatedAt,
      count: launches.length,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/stats', async (_req, res, next) => {
  try {
    const store = await loadStore();
    const launches = store.launches || [];

    const totalRaised = launches.reduce((sum, item) => sum + (item.funding?.amountUsd || 0), 0);
    const avgXLikes =
      launches.filter((item) => Number.isFinite(item.x?.likes)).reduce((sum, item) => sum + item.x.likes, 0) /
      Math.max(launches.filter((item) => Number.isFinite(item.x?.likes)).length, 1);

    res.json({
      totalCompanies: launches.length,
      totalRaised,
      averageXLikes: Math.round(avgXLikes),
      poorLaunchCount: launches.filter((item) => item.poorLaunch).length,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ingest', async (req, res, next) => {
  try {
    const parsed = ingestSchema.parse(req.body || {});

    const poorThreshold = parsed.poorThreshold ?? Number(process.env.DEFAULT_POOR_THRESHOLD || 500);
    const urls = parsed.urls?.length ? parsed.urls : seedLaunchUrls;

    const result = await ingestLaunchUrls({
      urls,
      maxItems: parsed.limit ?? Number(process.env.DEFAULT_INGEST_LIMIT || 25),
      poorThreshold,
    });

    const saved = await upsertLaunches(result.records);

    res.json({
      ok: true,
      meta: result.meta,
      launchesCount: saved.launches.length,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/draft-dms', async (req, res, next) => {
  try {
    const parsed = dmSchema.parse(req.body || {});
    const store = await loadStore();

    const launches = (store.launches || []).map((item) => {
      const engagementScore = computeEngagementScore(item.x?.likes ?? null, item.linkedIn?.likes ?? null);
      const poorLaunch = shouldDraftDM(engagementScore, parsed.threshold);

      return {
        ...item,
        engagementScore,
        poorLaunch,
        dmDraft: poorLaunch
          ? draftOutreachDM({
              companyName: item.companyName,
              xHandle: item.x?.handle,
              engagementScore,
              threshold: parsed.threshold,
              launchSummary: item.x?.text || item.linkedIn?.text || item.companyName,
            })
          : null,
      };
    });

    const saved = await saveStore({ launches });

    res.json({
      ok: true,
      threshold: parsed.threshold,
      drafted: launches.filter((item) => item.poorLaunch).length,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/reset', async (_req, res, next) => {
  try {
    const saved = await saveStore({ launches: [] });
    res.json({ ok: true, updatedAt: saved.updatedAt });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error?.name === 'ZodError' ? 400 : 500;
  res.status(status).json({
    ok: false,
    error: error.message,
    details: error?.issues || null,
  });
});

module.exports = app;
