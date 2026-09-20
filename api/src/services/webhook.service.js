const crypto = require('crypto');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { isUrlSafe } = require('../utils/ssrfGuard');

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
  // https:// (webhook.validator.js) blocks the obvious plain-http
  // localhost/metadata targets, but a public hostname can still resolve to
  // a private IP — reject at registration time so this only ever bites an
  // admin setting the URL up, not a customer waiting on an order.
  if (!(await isUrlSafe(url))) {
    throw new AppError(400, 'URL webhook tidak valid atau mengarah ke alamat internal/private');
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
    // Re-checked here, not just at create() — a hostname that resolved to
    // a public IP when the webhook was registered can be repointed at a
    // private one at any time afterward (DNS rebinding, or just the
    // admin's own domain changing later); dispatch happens on an
    // unpredictable future schedule, so this is the check that actually
    // matters. Async, so it can't live in the synchronous filter above.
    isUrlSafe(webhook.url).then((safe) => {
      if (!safe) {
        logger.warn({ webhookId: webhook.id, event }, 'webhook delivery blocked: URL resolves to a private/internal address');
        return;
      }
      const signature = crypto.createHmac('sha256', webhook.secret).update(body).digest('hex');
      fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Popside-Signature': signature },
        body,
        signal: AbortSignal.timeout(5000),
        // Manual, not the default 'follow' — a redirect response could
        // silently retarget an already-validated public URL at a private
        // one (the fetch itself would then reach it directly, bypassing
        // both isUrlSafe checks entirely). A redirect target is never
        // trusted automatically; treated as a failed delivery instead.
        redirect: 'manual',
      })
        .then((res) => {
          if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
            logger.warn({ webhookId: webhook.id, event }, 'webhook delivery blocked: endpoint returned a redirect');
          }
        })
        .catch((err) => {
          logger.warn({ webhookId: webhook.id, event, err: err.message }, 'webhook delivery failed');
        });
    });
  }
}

module.exports = { list, create, remove, setActive, dispatch, VALID_EVENTS };
