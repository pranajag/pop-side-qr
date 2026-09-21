const { z } = require('zod');

// 25% ceiling on any single tier — a hard safety boundary (store owner's
// own words: "batasnya hanya sekitar 25%"), not itself something a tier's
// own discountPercent can be configured past.
const MAX_TIER_DISCOUNT_PERCENT = 25;

const createLoyaltyTierSchema = z.object({
  minPoints: z.coerce.number().int().min(1).max(1000000),
  discountPercent: z.coerce.number().min(0).max(MAX_TIER_DISCOUNT_PERCENT),
});

const updateLoyaltyTierSchema = createLoyaltyTierSchema.partial();

module.exports = { createLoyaltyTierSchema, updateLoyaltyTierSchema, MAX_TIER_DISCOUNT_PERCENT };
