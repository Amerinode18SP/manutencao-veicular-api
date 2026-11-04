// routes/alertas.js — alertas por e-mail (hoje: revisão se aproximando)
const express = require('express')
const router  = express.Router()
const {
  getConfigAlerta, putConfigAlerta, previaAlerta,
  executarHandler, testeAlerta, historicoAlerta, enviarSelecao
} = require('../controllers/alertasRevisao')

router.get('/revisao/config',    getConfigAlerta)   // config atual + status do provedor de e-mail
router.put('/revisao/config',    putConfigAlerta)   // operador ajusta destinatários/dias/hora
router.get('/revisao/previa',    previaAlerta)      // quem seria avisado agora (não envia)
router.post('/revisao/executar', executarHandler)   // botão "Enviar agora" + agendador externo
router.post('/revisao/teste',    testeAlerta)       // e-mail de teste
router.get('/revisao/historico', historicoAlerta)   // últimos avisos disparados
router.post('/revisao/enviar-selecao', enviarSelecao) // avulso: só os filtrados, só para quem se escolhe

module.exports = router
