const express = require('express')
const router  = express.Router()
const { listar, criar, atualizar, excluir, substituirTudo } = require('../controllers/vidaUtil')

router.get('/',           listar)
router.post('/',          criar)
router.put('/:id',        atualizar)
router.delete('/:id',     excluir)
router.post('/substituir', substituirTudo)

module.exports = router
