// ── routes/distancia.js ─────────────────────────────────────────────────
// Endpoints do módulo Distância & Combustível (integração Cobli).
// Status: preview — só funciona quando FEATURES.distanciaCobli=true no front.

const express = require('express')
const router  = express.Router()
const c = require('../controllers/distancia')

router.get('/resumo',  c.resumo)
router.get('/top',     c.top)
router.get('/modelo',  c.modelo)
router.get('/placas',  c.placas)
router.get('/modelos', c.modelos)
router.get('/rodizio', c.rodizio)
router.get('/regioes', c.regioes)
router.put('/regioes', c.salvarRegiao)
router.post('/sync',   c.sync)
router.get('/_probe',  c.probe)
router.get('/_fuelreport', c.fuelReportDebug)

module.exports = router
