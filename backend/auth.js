import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
export function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ status: 'error', message: 'NO_TOKEN' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ status: 'error', message: 'INVALID_TOKEN' });
  }
}
export function signToken(user) {
  return jwt.sign({ id: user.id, login: user.login, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}
