// Pure function shared by cart.service.js (pre-checkout total/validation)
// and order.service.js (the real, enforced check at order creation) so the
// two can't silently drift on what counts as a valid variant selection.
// `product` must have variantGroups (each with its options) loaded.
function resolveProductVariants(product, selectedOptionIds) {
  const selectedSet = new Set(selectedOptionIds ?? []);
  const snapshots = [];
  let extraPerUnit = 0;

  const allOptionIds = new Set();

  for (const group of product.variantGroups) {
    const selectedInGroup = group.options.filter((option) => {
      allOptionIds.add(option.id);
      return selectedSet.has(option.id);
    });

    if (group.required && selectedInGroup.length === 0) {
      return { error: `Pilih ${group.nama} untuk ${product.nama}` };
    }
    if (!group.multiple && selectedInGroup.length > 1) {
      return { error: `${group.nama} untuk ${product.nama} cuma boleh pilih 1` };
    }

    for (const option of selectedInGroup) {
      extraPerUnit += Number(option.hargaTambahan);
      snapshots.push({ namaGroup: group.nama, namaOption: option.nama, hargaTambahan: option.hargaTambahan });
    }
  }

  // Any selected id that isn't one of this product's own options at all
  // (stale id, or one smuggled in from a different product's variant) —
  // without this check it would just be silently ignored by the loop above.
  for (const id of selectedSet) {
    if (!allOptionIds.has(id)) {
      return { error: `Pilihan varian untuk ${product.nama} tidak valid` };
    }
  }

  return { extraPerUnit, snapshots, error: null };
}

module.exports = { resolveProductVariants };
