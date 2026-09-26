const userService = require('../services/user.service');

async function list(req, res) {
  const users = await userService.list();
  res.json({ users });
}

async function create(req, res) {
  const user = await userService.create(req.body);
  res.status(201).json({ user });
}

async function update(req, res) {
  const user = await userService.update(req.params.id, req.session.user.id, req.body);
  res.json({ user });
}

async function remove(req, res) {
  await userService.remove(req.params.id, req.session.user.id);
  res.status(204).end();
}

async function reset2fa(req, res) {
  await userService.reset2fa(req.params.id, req.session.user.id, req.body.pin);
  res.json({ message: '2FA dicabut. Akun ini wajib memasang 2FA lagi saat login berikutnya.' });
}

module.exports = { list, create, update, remove, reset2fa };
