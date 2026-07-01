const express = require('express')
const router  = express.Router()
const { resumo, rankings, serie } = require('../controllers/outros')
const { recorrencia } = require('../controllers/recorrencia')
router.get('/resumo',      resumo)
router.get('/rankings',    rankings)
router.get('/serie',       serie)
router.get('/recorrencia', recorrencia)
module.exports = router
