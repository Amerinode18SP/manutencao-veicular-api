const express = require('express')
const multer  = require('multer')
const router  = express.Router()
const c = require('../controllers/manutencao')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
               file.mimetype.includes('excel') ||
               file.originalname.endsWith('.xlsx')
    cb(ok ? null : new Error('Apenas arquivos .xlsx são aceitos'), ok)
  }
})

const uploadAnexo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')
    cb(ok ? null : new Error('Apenas PDF ou imagem são aceitos'), ok)
  }
})

router.get('/',                   c.listar)
// ⚠️ Antes de '/:id', senão o Express trataria "situacao" como um id de registro.
router.get('/situacao',           c.situacaoAtual)
router.post('/situacao/email',    c.enviarSituacaoEmail)
router.get('/dashboard/resumo',   c.resumoDash)
router.get('/dashboard/rankings', c.rankingsDash)
router.get('/dashboard/serie',    c.serieDash)
router.post('/anexos',            uploadAnexo.single('arquivo'), c.uploadAnexo)
router.delete('/anexos',          c.excluirAnexo)
router.get('/:id',                c.buscarPorId)
router.post('/',                  c.criar)
router.post('/importar',          upload.single('arquivo'), c.importarManutencao)
router.post('/:id/converter',     c.converterEmOrdem)
router.put('/:id',                c.atualizar)
router.delete('/:id',             c.excluir)

module.exports = router
