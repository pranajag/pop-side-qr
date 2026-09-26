require('dotenv').config({ quiet: true });

const http = require('node:http');
const app = require('./app');
const realtime = require('./realtime');
const logger = require('./utils/logger');

const port = process.env.PORT || 3000;

// Satu server HTTP untuk Express dan Socket.IO (path /api/realtime), jadi
// realtime ikut port, CORS, dan reverse proxy yang sama dengan API.
const server = http.createServer(app);
realtime.pasang(server, { originDiizinkan: app.originDiizinkan });

server.listen(port, () => {
  logger.info(`api listening on port ${port}`);
});
