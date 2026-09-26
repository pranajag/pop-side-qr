const auditLogService = require('../services/auditLog.service');

async function list(req, res) {
  res.json(await auditLogService.list(req.validQuery));
}

module.exports = { list };
