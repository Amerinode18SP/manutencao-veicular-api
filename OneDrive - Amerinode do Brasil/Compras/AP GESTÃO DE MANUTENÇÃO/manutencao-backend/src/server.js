require('dotenv').config()
const express = require('express')
const cors    = require('cors')
const path    = require('path')

const ordensRoutes      = require('./routes/ordens')
const veiculosRoutes    = require('./routes/veiculos')
const fornecedoresRoutes = require('./routes/fornecedores')
const importRoutes      = require('./routes/importar')
const kmRoutes          = require('./routes/importarKm')
const dashboardRoutes   = require('./routes/dashboard')
const manutencaoRoutes  = require('./routes/manutencao')
const vidaUtilRoutes    = require('./routes/vidaUtil')
const distanciaRoutes   = require('./routes/distancia')
const configRoutes      = require('./routes/config')
const alertasRoutes     = require('./routes/alertas')
const revisoesRoutes    = require('./routes/revisoes')
const { runMigrations } = require('./migrate')
const { manterSessaoViva } = require('./controllers/importarKm')
const { iniciarAgendador: iniciarAlertasRevisao } = require('./controllers/alertasRevisao')

const app  = express()
const PORT = process.env.PORT || 3000

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Frontend estático ────────────────────────────────────────────────────────
// Serve os arquivos da pasta public/ (index.html como página inicial)
app.use(express.static(path.join(__dirname, '..', 'public')))

// ── Rotas ────────────────────────────────────────────────────────────────────
app.use('/api/ordens',       ordensRoutes)
app.use('/api/veiculos',     veiculosRoutes)
app.use('/api/fornecedores', fornecedoresRoutes)
app.use('/api/importar',     importRoutes)
app.use('/api/km',           kmRoutes)
app.use('/api/dashboard',    dashboardRoutes)
app.use('/api/manutencao',   manutencaoRoutes)
app.use('/api/vida-util',    vidaUtilRoutes)
app.use('/api/distancia',    distanciaRoutes)
app.use('/api/config',       configRoutes)
app.use('/api/alertas',      alertasRoutes)
app.use('/api/revisoes',     revisoesRoutes)

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' })
})

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erro interno:', err)
  res.status(500).json({ error: 'Erro interno do servidor', detail: err.message })
})

// ── Keep-alive da sessão TicketLog ───────────────────────────────────────────
// O sistema legado derruba a sessão por INATIVIDADE muito antes dos 90 dias do
// login SSO. Como o sync só rodava 1x/dia, a sessão caducava sozinha. Aqui o
// próprio servidor "toca" a sessão a cada N min (imita o navegador em uso).
// Desative com TICKETLOG_KEEPALIVE_MIN=0.
function iniciarKeepaliveTicketlog() {
  const min = parseInt(process.env.TICKETLOG_KEEPALIVE_MIN || '15', 10)
  if (!min || min <= 0) {
    console.log('🔌  Keep-alive TicketLog desativado (TICKETLOG_KEEPALIVE_MIN=0)')
    return
  }
  console.log(`🔄  Keep-alive TicketLog a cada ${min} min`)
  const tick = () => manterSessaoViva()
    .then(r => { if (r && r.alive === false) console.warn('[km-keepalive] sessão TicketLog expirada') })
    .catch(e => console.warn('[km-keepalive] tick falhou:', e.message))
  setTimeout(tick, 60 * 1000)          // 1ª verificação ~1 min após subir
  setInterval(tick, min * 60 * 1000)   // depois, a cada N min
}

app.listen(PORT, async () => {
  console.log(`✅  API rodando em http://localhost:${PORT}`)
  console.log(`📋  Ambiente: ${process.env.NODE_ENV || 'development'}`)
  await runMigrations()
  iniciarKeepaliveTicketlog()
  iniciarAlertasRevisao()   // alerta de revisão por e-mail (horário/dias vêm da config da tela)
})
