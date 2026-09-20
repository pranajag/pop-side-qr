const crypto = require('crypto');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const VALID_EVENTS = ['order.created', 'order.status_changed'];

function toShaped(webhook) {
  return {
    id: webhook.id,
    url: webhook.url,
    events: webhook.events.split(',').filter(Boolean),
    isActive: webhook.isActive,
    createdAt: webhook.createdAt,
  };
}

async function list() {
  const webhooks = await prisma.webhook.findMany({ orderBy: { id: 'desc' } });
  return webhooks.map(toShaped);
}

// Returns the signing secret exactly once, same as apiKey.service.js's
// create() — unlike an API key this one IS kept in the DB afterward
// (dispatch() below needs to re-sign every future delivery with it), but
// it's never sent back to the client again after this single response.
async function create(url, events) {
  const invalid = events.filter((e) => !VALID_EVENTS.includes(e));
  if (invalid.length > 0) {
    throw new AppError(400, `Event tidak dikenal: ${invalid.join(', ')}`);
  }
  const secret = crypto.randomBytes(24).toString('hex');
  const webhook = await prisma.webhook.create({
    data: { url, events: events.join(','), secret },
  });
  return { ...toShaped(webhook), secret };
}

async function remove(id) {
  const existing = await prisma.webhook.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Webhook tidak ditemukan');
  }
  await prisma.webhook.delete({ where: { id } });
}

async function setActive(id, isActive) {
  const existing = await prisma.webhook.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError(404, 'Webhook tidak ditemukan');
  }
  const updated = await prisma.webhook.update({ where: { id }, data: { isActive } });
  return toShaped(updated);
}

// Called from order.service.js / orderManagement.service.js at the moment
// something worth telling an external system about happens. Deliberately
// fire-and-forget: awaited by nothing, callers never block on it, and a
// slow/dead/erroring receiving endpoint can never affect the real request
// (order creation, status update) that triggered it. Best-effort delivery
// only — no retry queue, matching this v1's stated scope.
async function dispatch(event, payload) {
  const webhooks = await prisma.webhook.findMany({ where: { isActive: true } });
  const targets = webhooks.filter((w) => w.events.split(',').includes(event));
  if (targets.length === 0) return;

  const body = JSON.stringify({ event, data: payload, sentAt: new Date().toISOString() });

  for (const webhook of targets) {
    const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
    fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Popside-Signature': signature },
      body,
      signal: AbortSignal.timeout(5000),
    }).catch((err) => {
      logger.warn({ webhookId: webhook.id, event, err: err.message }, 'webhook delivery failed');
    });
  }
}

module.exports = { list, create, remove, setActive, dispatch, VALID_EVENTS };
