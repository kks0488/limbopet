/**
 * Economy Routes (Phase E1)
 * /api/v1/economy/*
 *
 * Notes:
 * - Uses User JWT auth (browser-friendly)
 * - Balances are read from `transactions` (SSOT)
 */

const { Router } = require('express');

const { asyncHandler } = require('../middleware/errorHandler');
const { requireUserAuth } = require('../middleware/userAuth');
const { success, created } = require('../utils/response');
const { BadRequestError, NotFoundError } = require('../utils/errors');

const AgentService = require('../services/AgentService');
const CompanyService = require('../services/CompanyService');
const EconomyService = require('../services/EconomyService');
const TransactionService = require('../services/TransactionService');

const router = Router();

async function getMyPetOrNull(userId) {
  return AgentService.findByOwnerUserId(userId);
}

function toSafeInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

router.get('/me/balance', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await getMyPetOrNull(req.user.id);
  if (!petRow) {
    success(res, { has_pet: false, balance: 0 });
    return;
  }
  const balance = await TransactionService.getBalance(petRow.id);
  success(res, { has_pet: true, balance });
}));

router.get('/me/transactions', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await getMyPetOrNull(req.user.id);
  if (!petRow) {
    success(res, { has_pet: false, transactions: [] });
    return;
  }

  const limit = toSafeInt(req.query?.limit ?? 50, 50);
  const offset = toSafeInt(req.query?.offset ?? 0, 0);
  const txType = req.query?.tx_type ? String(req.query.tx_type) : null;

  const transactions = await TransactionService.getTransactions(petRow.id, { limit, offset, txType });
  success(res, { has_pet: true, transactions });
}));

router.post('/me/transfer', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await getMyPetOrNull(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const toAgentId = String(req.body?.toAgentId ?? req.body?.to_agent_id ?? '').trim();
  const amount = req.body?.amount;
  const memo = req.body?.memo ?? null;

  if (!toAgentId) throw new BadRequestError('toAgentId is required');

  const tx = await TransactionService.transfer({
    fromAgentId: petRow.id,
    toAgentId,
    amount,
    txType: 'TRANSFER',
    memo: memo ? String(memo).slice(0, 200) : null,
    referenceType: 'p2p'
  });

  created(res, { tx });
}));

router.post('/companies', requireUserAuth, asyncHandler(async (req, res) => {
  const petRow = await getMyPetOrNull(req.user.id);
  if (!petRow) throw new NotFoundError('Pet');

  const name = String(req.body?.name ?? '').trim();
  const displayName = req.body?.displayName ?? req.body?.display_name ?? null;
  const description = req.body?.description ?? null;

  const result = await CompanyService.create({
    name,
    displayName,
    description,
    ceoAgentId: petRow.id
  });
  created(res, result);
}));

router.get('/companies', requireUserAuth, asyncHandler(async (req, res) => {
  const status = req.query?.status ? String(req.query.status) : 'active';
  const limit = toSafeInt(req.query?.limit ?? 50, 50);
  const offset = toSafeInt(req.query?.offset ?? 0, 0);

  const companies = await CompanyService.list({ status, limit, offset });
  success(res, { companies });
}));

router.get('/companies/:id', requireUserAuth, asyncHandler(async (req, res) => {
  const details = await CompanyService.getById(req.params.id);
  success(res, details);
}));

router.get('/dashboard', requireUserAuth, asyncHandler(async (_req, res) => {
  const dashboard = await EconomyService.getDashboard();
  success(res, dashboard);
}));

module.exports = router;

