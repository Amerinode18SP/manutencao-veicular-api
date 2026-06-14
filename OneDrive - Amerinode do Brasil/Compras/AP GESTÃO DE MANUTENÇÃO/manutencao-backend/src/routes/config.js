// routes/config.js — config global do sistema (1 linha unica)
const express  = require('express')
const router   = express.Router()
const supabase = require('../supabase')

// GET /api/config — devolve a config atual
router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('config_sistema')
      .select('*')
      .eq('id', 1)
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/config — atualiza flags
router.put('/', async (req, res) => {
  try {
    const allowed = ['bloquear_fornecedor_nao_homologado']
    const payload = { atualizado_em: new Date().toISOString() }
    for (const k of allowed) if (k in req.body) payload[k] = req.body[k]

    const { data, error } = await supabase
      .from('config_sistema')
      .update(payload)
      .eq('id', 1)
      .select()
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
