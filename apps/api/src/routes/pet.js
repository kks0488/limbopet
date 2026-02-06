/**
 * Pet compatibility routes
 *
 * Legacy client aliases under /api[/v1]/pet/*
 */

const { Router } = require('express');
const { requireUserAuth } = require('../middleware/userAuth');
const { asyncHandler } = require('../middleware/errorHandler');
const { NotFoundError } = require('../utils/errors');
const { queryAll, transaction } = require('../config/database');
const AgentService = require('../services/AgentService');
const PetStateService = require('../services/PetStateService');
const RelationshipService = require('../services/RelationshipService');
const ArenaService = require('../services/ArenaService');

const router = Router();

function normalizeTimelineEvents(events, displayById) {
  const map = displayById instanceof Map ? displayById : new Map();
  const list = Array.isArray(events) ? events : [];

  return list.map((event) => {
    const out = { ...event };
    const payload = event?.payload && typeof event.payload === 'object' ? { ...event.payload } : null;
    if (!payload) return out;

    const withId = String(payload.with_agent_id || '').trim();
    if (withId && map.has(withId)) payload.with_name = map.get(withId);

    const otherId = String(payload.other_agent_id || '').trim();
    if (otherId && map.has(otherId)) payload.other_name = map.get(otherId);

    const opponent = payload.opponent && typeof payload.opponent === 'object' ? { ...payload.opponent } : null;
    if (opponent) {
      const oppId = String(opponent.id || '').trim();
      if (oppId && map.has(oppId)) opponent.name = map.get(oppId);
      payload.opponent = opponent;
    }

    const cast = payload.cast && typeof payload.cast === 'object' ? { ...payload.cast } : null;
    if (cast) {
      const aId = String(cast.aId || cast.a_id || '').trim();
      const bId = String(cast.bId || cast.b_id || '').trim();
      if (aId && map.has(aId)) {
        cast.aName = map.get(aId);
        cast.a_name = map.get(aId);
      }
      if (bId && map.has(bId)) {
        cast.bName = map.get(bId);
        cast.b_name = map.get(bId);
      }
      payload.cast = cast;
    }

    out.payload = payload;
    return out;
  });
}

router.get('/relationships', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const limit = req.query?.limit ? Number(req.query.limit) : 20;
  const relationships = await RelationshipService.listForAgent(petRow.id, { limit });

  const out = (relationships || []).map((r) => {
    const outRel = r?.out && typeof r.out === 'object' ? r.out : {};
    const inRel = r?.in && typeof r.in === 'object' ? r.in : {};
    return {
      other_id: r?.other?.id ?? null,
      other_name: r?.other_name ?? r?.other?.displayName ?? r?.other?.name ?? null,
      other_display_name: r?.other_display_name ?? r?.other?.displayName ?? null,
      affinity: Number(outRel.affinity ?? 0) || 0,
      trust: Number(outRel.trust ?? 0) || 0,
      jealousy: Number(outRel.jealousy ?? 0) || 0,
      rivalry: Number(outRel.rivalry ?? 0) || 0,
      debt: Number(outRel.debt ?? 0) || 0,
      updated_at: outRel.updated_at ?? null,
      incoming: {
        affinity: Number(inRel.affinity ?? 0) || 0,
        trust: Number(inRel.trust ?? 0) || 0,
        jealousy: Number(inRel.jealousy ?? 0) || 0,
        rivalry: Number(inRel.rivalry ?? 0) || 0,
        debt: Number(inRel.debt ?? 0) || 0,
        updated_at: inRel.updated_at ?? null
      }
    };
  });

  res.status(200).json(out);
}));

router.get('/timeline', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const events = await PetStateService.getTimeline(petRow.id, { limit: req.query?.limit });

  const ids = new Set();
  for (const e of events || []) {
    const p = e?.payload && typeof e.payload === 'object' ? e.payload : null;
    if (!p) continue;

    const withId = String(p.with_agent_id || '').trim();
    const otherId = String(p.other_agent_id || '').trim();
    if (withId) ids.add(withId);
    if (otherId) ids.add(otherId);

    const oppId = String(p?.opponent?.id || '').trim();
    if (oppId) ids.add(oppId);

    const aId = String(p?.cast?.aId || p?.cast?.a_id || '').trim();
    const bId = String(p?.cast?.bId || p?.cast?.b_id || '').trim();
    if (aId) ids.add(aId);
    if (bId) ids.add(bId);
  }

  const idList = [...ids];
  const rows =
    idList.length > 0
      ? await queryAll(
        `SELECT id, COALESCE(display_name, name) AS display
         FROM agents
         WHERE id = ANY($1::uuid[])`,
        [idList]
      ).catch(() => [])
      : [];
  const displayById = new Map((rows || []).map((r) => [String(r.id), String(r.display || '').trim()]));

  res.status(200).json(normalizeTimelineEvents(events, displayById));
}));

router.get('/arena/history', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await AgentService.findByOwnerUserId(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const limit = req.query?.limit ? Number(req.query.limit) : 20;
  const result = await transaction(async (client) => {
    return ArenaService.listHistoryForAgentWithClient(client, { agentId: petRow.id, limit });
  });

  res.status(200).json(Array.isArray(result?.history) ? result.history : []);
}));

module.exports = router;
