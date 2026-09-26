const { z } = require('zod');
const { zBooleanish } = require('./common');
const { VALID_EVENTS } = require('../services/webhook.service');

const createWebhookSchema = z.strictObject({
  // https:// only — this carries real order data (customer name, items,
  // totals) to an external URL, and only an admin session can set one, but
  // requiring TLS still costs nothing and rules out the most common
  // accidental-SSRF targets (plain-http localhost/cloud-metadata URLs) as
  // a side effect.
  url: z.string().trim().url().max(500).refine((v) => v.startsWith('https://'), 'URL webhook harus https://'),
  events: z.array(z.enum(VALID_EVENTS)).min(1),
});

const updateWebhookSchema = z.strictObject({
  isActive: zBooleanish,
});

module.exports = { createWebhookSchema, updateWebhookSchema };
