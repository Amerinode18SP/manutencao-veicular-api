const supabase = require('../supabase')

// Normaliza placa p/ casar independente de hífen/caixa (BRA-2025 == bra2025)
function normPlaca(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// dd/mm/yyyy -> yyyy-mm-dd
function dataIso(d) {
  const p = String(d || '').trim().split('/')
  if (p.length !== 3) return null
  const [dd, mm, yy] = p
  if (!yy || yy.length !== 4) return null
  return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// Km em PT-BR ("208.232") -> 208232 (odômetro é inteiro; ponto é separador de milhar)
function parseKm(v) {
  const digits = String(v || '').replace(/\D/g, '')
  if (!digits) return null
  return parseInt(digits, 10)
}

// Chave ordenável (yyyymmddHHMM) pra achar a leitura mais recente
function chaveOrdem(iso, hora) {
  return (iso || '').replace(/-/g, '') + String(hora || '').replace(/\D/g, '').padEnd(4, '0')
}

// Parseia o relatório "Últimas Quilometragens/Horas" (HTML disfarçado de .xls)
// e retorna a leitura de km MAIS RECENTE por placa.
function parseRelatorio(buffer) {
  const text = buffer.toString('latin1')
  const rowRe  = /<tr class="Linha(?:Impar|Par)">([\s\S]*?)<\/tr>/g
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g
  const latest = {}
  let m
  while ((m = rowRe.exec(text))) {
    const cells = []
    let c
    while ((c = cellRe.exec(m[1]))) {
      cells.push(c[1].replace(/&nbsp;/g, ' ').replace(/<[^>]*>/g, '').trim())
    }
    // colunas: [0]placa [1]tipo frota [2]data [3]hora [4]quilometragem ...
    if (cells.length < 5) continue
    const placa = cells[0].trim()
    const km    = parseKm(cells[4])
    if (!placa || km === null) continue // pula frota de horímetro / linhas sem km
    const iso  = dataIso(cells[2])
    const hora = cells[3].trim()
    const key  = chaveOrdem(iso, hora)
    const norm = normPlaca(placa)
    if (!latest[norm] || key > latest[norm].key) {
      latest[norm] = { placa, norm, km, data_leitura: iso, hora, key }
    }
  }
  return Object.values(latest)
}

const KM_INVALIDO = 999999 // placeholder digitado errado no posto/bomba

// POST /api/km/preview — lê o arquivo, compara com o banco e devolve o preview (não grava)
async function preview(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' })

    const leituras = parseRelatorio(req.file.buffer)
    if (!leituras.length) {
      return res.status(400).json({
        error: 'Não encontrei linhas de quilometragem no arquivo. Confira se é o relatório "Últimas Quilometragens/Horas" baixado do portal TicketLog.'
      })
    }

    const { data: veiculos, error } = await supabase
      .from('veiculos')
      .select('id, placa, km_atual')
    if (error) throw error

    const porPlaca = {}
    for (const v of (veiculos || [])) porPlaca[normPlaca(v.placa)] = v

    const itens = leituras.map(l => {
      const v = porPlaca[l.norm]
      let status = 'ok'
      if (l.km >= KM_INVALIDO)                                status = 'invalido'
      else if (!v)                                           status = 'nao_encontrado'
      else if (v.km_atual != null && l.km < v.km_atual)      status = 'regressao'
      return {
        placa:        l.placa,
        veiculo_id:   v ? v.id : null,
        km_sistema:   v ? v.km_atual : null,
        km_novo:      l.km,
        diff:         (v && v.km_atual != null) ? l.km - v.km_atual : null,
        data_leitura: l.data_leitura,
        hora:         l.hora,
        status
      }
    }).sort((a, b) => a.placa.localeCompare(b.placa))

    res.json({
      total:          itens.length,
      ok:             itens.filter(i => i.status === 'ok').length,
      regressao:      itens.filter(i => i.status === 'regressao').length,
      invalido:       itens.filter(i => i.status === 'invalido').length,
      nao_encontrado: itens.filter(i => i.status === 'nao_encontrado').length,
      itens
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// POST /api/km/aplicar — grava a km dos veículos selecionados
async function aplicar(req, res) {
  try {
    const lista = Array.isArray(req.body && req.body.atualizacoes) ? req.body.atualizacoes : []
    if (!lista.length) return res.status(400).json({ error: 'Nada para atualizar.' })

    let atualizados = 0
    const erros = []
    for (const it of lista) {
      if (!it.veiculo_id || it.km == null) continue
      const payload = {
        km_atual:         parseInt(it.km, 10),
        km_atualizado_em: it.data_leitura || null,
        updated_at:       new Date().toISOString()
      }
      // Resiliente: se a coluna km_atualizado_em ainda não existir no schema, refaz sem ela.
      let { error } = await supabase.from('veiculos').update(payload).eq('id', it.veiculo_id)
      if (error && /km_atualizado_em/.test(error.message)) {
        delete payload.km_atualizado_em
        ;({ error } = await supabase.from('veiculos').update(payload).eq('id', it.veiculo_id))
      }
      if (error) erros.push({ veiculo_id: it.veiculo_id, erro: error.message })
      else atualizados++
    }

    res.json({ atualizados, erros_count: erros.length, erros })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = { preview, aplicar, parseRelatorio }
