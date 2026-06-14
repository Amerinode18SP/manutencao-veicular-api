// routes/fornecedores.js
const express = require('express')
const router  = express.Router()
const {
  listarFornecedores,
  criarFornecedor,
  atualizarFornecedor,
  deletarFornecedor,
} = require('../controllers/outros')

router.get('/',       listarFornecedores)
router.post('/',      criarFornecedor)
router.put('/:id',    atualizarFornecedor)
router.delete('/:id', deletarFornecedor)

module.exports = router
