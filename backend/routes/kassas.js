import { Router } from 'express';
import db from '../db.js';
import { ok } from '../utils.js';

const router = Router();

router.get('/', (req, res) => {
  const kassas = db.prepare('SELECT * FROM kassas').all();
  const balances = db.prepare(`
    SELECT kassa_id,
      SUM(CASE WHEN direction = 'приход' THEN amount ELSE 0 END) -
      SUM(CASE WHEN direction = 'расход' THEN amount ELSE 0 END) AS balance
    FROM kassa_ops WHERE direction IN ('приход','расход')
    GROUP BY kassa_id
  `).all();
  const balMap = {};
  balances.forEach(r => { balMap[r.kassa_id] = r.balance || 0; });
  return ok(res, { kassas: kassas.map(k => ({
    kassaId: k.id, name: k.name, owner: k.owner,
    type: k.type, note: k.note,
    balanceCurrent: Math.round(balMap[k.id] || 0),
  }))});
});

export default router;
