const { createImageStore } = require('../lib/imageStore');

const store = createImageStore('settings');

module.exports = { SETTINGS_DIR: store.dir, save: store.save, remove: store.remove, serve: store.serve };
