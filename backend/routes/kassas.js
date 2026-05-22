import { Router } from 'express';
import db from '../db.js';
import { ok, keysToCamel } from '../utils.js';

const router = Router();

router.get('/', (req, res) => {
  const kassas = db.prepare('SELECT id AS kassa_id, name, owner, type, note FROM kassas').all();
  const balances = db.prepare(`
    SELECT kassa_id,
      SUM(CASE WHEN direction = 'приход' THEN amount ELSE 0 END) -
      SUM(CASE WHEN direction = 'расход' THEN amount ELSE 0 END) AS balance
    FROM kassa_ops WHERE direction IN ('приход','расход')
    GROUP BY kassa_id
  `).all();
  const balMap = {};
  balances.forEach(r => { balMap[r.kassa_id] = r.balance || 0; });
  const rows = kassas.map(k => ({
    ...k,
    balance_current: Math.round(balMap[k.kassa_id] || 0),
  }));
  return ok(res, { kassas: keysToCamel(rows) });
});

export default router;
