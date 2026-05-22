import { Router } from 'express';
import db from '../db.js';
import { signToken } from '../auth.js';
import { ok, fail } from '../utils.js';
const router = Router();

router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return fail(res, 'MISSING_FIELD: login или password');
  const user = db.prepare('SELECT id, login, role, password_hash FROM users WHERE login = ?').get(login);
  if (!user) return fail(res, 'INVALID_CREDENTIALS', 401);
  if (user.password_hash !== password) return fail(res, 'INVALID_CREDENTIALS', 401);
  const token = signToken(user);
  return ok(res, { token, user: { id: user.id, login: user.login, role: user.role } });
});

router.post('/login-pin', (req, res) => {
  const { pin } = req.body || {};
  if (!pin || String(pin).trim() === '') return fail(res, 'MISSING_FIELD: pin');
  const user = db.prepare(
    "SELECT id, login, role, name, email FROM users WHERE pin = ? AND status = 'активный'"
  ).get(String(pin).trim());
  if (!user) return fail(res, 'INVALID_PIN', 401);
  const token = signToken(user);
  return ok(res, { token, user: { id: user.id, login: user.login, role: user.role, name: user.name, email: user.email } });
});

router.post('/logout', (req, res) => ok(res, { message: 'logged_out' }));
export default router;
