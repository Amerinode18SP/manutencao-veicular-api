const express = require('express')
const multer  = require('multer')
const router  = express.Router()
const { preview, aplicar, listarTicketlog, sync, salvarSessao } = require('../controllers/importarKm')

// O relatório do portal TicketLog vem como .xls, mas é HTML por dentro.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const n = file.originalname.toLowerCase()
    const ok = n.endsWith('.xls') || n.endsWith('.html') || n.endsWith('.htm') ||
               file.mimetype.includes('html') || file.mimetype.includes('excel')
    cb(ok ? null : new Error('Envie o relatório .xls baixado do portal TicketLog.'), ok)
  }
})

router.post('/preview', upload.single('arquivo'), preview)
router.post('/aplicar', aplicar)
router.get('/ticketlog', listarTicketlog)
router.post('/sync', sync)          // baixa o relatório server-side e atualiza a km (botão online + Railway Cron)
router.post('/sessao', salvarSessao) // admin cola o cookie/cURL da sessão do portal

module.exports = router
