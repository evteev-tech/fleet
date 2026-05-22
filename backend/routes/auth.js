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
router.post('/logout', (req, res) => ok(res, { message: 'logged_out' }));
export default router;
