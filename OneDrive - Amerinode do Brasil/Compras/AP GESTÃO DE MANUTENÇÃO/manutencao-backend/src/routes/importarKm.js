const express = require('express')
const multer  = require('multer')
const router  = express.Router()
const { preview, aplicar } = require('../controllers/importarKm')

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

module.exports = router
