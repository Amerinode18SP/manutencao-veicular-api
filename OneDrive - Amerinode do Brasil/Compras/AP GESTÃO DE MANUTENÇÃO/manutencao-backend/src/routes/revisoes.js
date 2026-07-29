// routes/revisoes.js — revisões programadas (agendamento manual ou por planilha)
const express = require('express')
const router  = express.Router()
const {
  listar, listarServicos, criar, atualizar, concluir, remover, importar
} = require('../controllers/revisoesProgramadas')

router.get('/',             listar)          // ?status=&placa=&dias=
router.get('/servicos',     listarServicos)  // tipos + sugestões de serviço (autocomplete)
router.post('/',            criar)           // 1 item ou { itens: [...] }
router.post('/importar',    importar)        // { itens: [...], preview: true|false }
router.put('/:id',          atualizar)
router.post('/:id/concluir', concluir)       // { concluida_em?, proxima_em_dias?, proxima_data? }
router.delete('/:id',       remover)

module.exports = router
