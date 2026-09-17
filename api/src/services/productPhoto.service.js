const { createImageStore } = require('../lib/imageStore');

const store = createImageStore('products');

module.exports = { PRODUCTS_DIR: store.dir, save: store.save, remove: store.remove, serve: store.serve };
