// ── routes/veiculos.js ──────────────────────────────────────────────────────
const express  = require('express')
const router   = express.Router()
const { listarVeiculos, revisoesPendentes, atualizarVeiculo, criarVeiculo, excluirVeiculo } = require('../controllers/outros')

router.get('/',         listarVeiculos)
router.get('/revisoes', revisoesPendentes)
router.post('/',        criarVeiculo)
router.put('/:id',      atualizarVeiculo)
router.delete('/:id',   excluirVeiculo)

module.exports = router
