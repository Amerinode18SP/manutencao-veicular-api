const supabase  = require('../supabase')
const ticketlog = require('../services/ticketlog')

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

const KM_INVALIDO = 999999 // placeholder digitado errado no posto/bomba

// Parseia o relatório "Últimas Quilometragens/Horas" (HTML disfarçado de .xls)
// e retorna a leitura de km MAIS RECENTE por placa. Quando a leitura mais recente
// é o placeholder 999.999 (erro digitado no posto), cai para a leitura VÁLIDA
// anterior mais recente da mesma placa ("penúltima com valor real"), se existir.
function parseRelatorio(buffer) {
  const text = buffer.toString('latin1')
  const rowRe  = /<tr class="Linha(?:Impar|Par)">([\s\S]*?)<\/tr>/g
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g
  const latest   = {} // leitura mais recente (qualquer valor)
  const latestOk = {} // leitura mais recente com km VÁLIDO (< 999.999)
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
    const rec  = { placa, norm, km, data_leitura: iso, hora, key }
    if (!latest[norm]   || key > latest[norm].key)                     latest[norm]   = rec
    if (km < KM_INVALIDO && (!latestOk[norm] || key > latestOk[norm].key)) latestOk[norm] = rec
  }
  return Object.keys(latest).map(norm => {
    const top = latest[norm]
    const ok  = latestOk[norm]
    // topo inválido mas existe leitura válida anterior → usa a válida
    if (top.km >= KM_INVALIDO && ok) return { ...ok, invalido_ignorado: true }
    return top
  })
}

// Casa as leituras do relatório com os veículos do banco e classifica cada uma
// (ok | invalido | nao_encontrado | regressao). Usado pelo preview (import manual)
// e pelo sync online — mesma regra em ambos.
async function montarItens(leituras) {
  const { data: veiculos, error } = await supabase
    .from('veiculos')
    .select('id, placa, km_atual')
  if (error) throw error

  const porPlaca = {}
  for (const v of (veiculos || [])) porPlaca[normPlaca(v.placa)] = v

  return leituras.map(l => {
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
      status,
      invalido_ignorado: l.invalido_ignorado || false // caiu p/ leitura válida anterior (topo era 999.999)
    }
  }).sort((a, b) => a.placa.localeCompare(b.placa))
}

function resumoItens(itens) {
  return {
    total:          itens.length,
    ok:             itens.filter(i => i.status === 'ok').length,
    regressao:      itens.filter(i => i.status === 'regressao').length,
    invalido:       itens.filter(i => i.status === 'invalido').length,
    nao_encontrado: itens.filter(i => i.status === 'nao_encontrado').length
  }
}

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

    const itens = await montarItens(leituras)
    res.json({ ...resumoItens(itens), itens })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Grava a km dos veículos e registra no histórico.
// Reutilizada pelo import manual (aplicar) e pelo futuro sync online.
// `atualizacoes`: [{ veiculo_id, km, data_leitura, placa? }]
async function gravarKm(atualizacoes, origem = 'import') {
  const lista = Array.isArray(atualizacoes) ? atualizacoes : []
  let atualizados = 0
  const erros = []

  for (const it of lista) {
    if (!it.veiculo_id || it.km == null) continue
    const km = parseInt(it.km, 10)
    const dataLeitura = it.data_leitura || null

    const payload = {
      km_atual:         km,
      km_atualizado_em: dataLeitura,
      updated_at:       new Date().toISOString()
    }
    // Resiliente: se a coluna km_atualizado_em ainda não existir no schema, refaz sem ela.
    let { error } = await supabase.from('veiculos').update(payload).eq('id', it.veiculo_id)
    if (error && /km_atualizado_em/.test(error.message)) {
      delete payload.km_atualizado_em
      ;({ error } = await supabase.from('veiculos').update(payload).eq('id', it.veiculo_id))
    }
    if (error) { erros.push({ veiculo_id: it.veiculo_id, erro: error.message }); continue }
    atualizados++

    // Histórico (append-only, idempotente). Não deve derrubar o update se a tabela
    // ainda não existir — só loga. UNIQUE(veiculo_id, data_leitura, km) evita duplicar.
    try {
      const { error: eh } = await supabase
        .from('veiculo_km_historico')
        .upsert(
          { veiculo_id: it.veiculo_id, placa: it.placa || null, km, data_leitura: dataLeitura, origem },
          { onConflict: 'veiculo_id,data_leitura,km', ignoreDuplicates: true }
        )
      if (eh) console.warn('[km-historico] ignorado:', eh.message)
    } catch (e) {
      console.warn('[km-historico] falhou:', e.message)
    }
  }

  return { atualizados, erros }
}

// Salva o snapshot completo do relatório (TODAS as placas, mesmo as não cadastradas)
// na tabela km_ticketlog — é o que alimenta a subaba Quilometragem.
// Resiliente: se a tabela ainda não existir, só loga (não quebra o import).
async function salvarSnapshotRelatorio(relatorio) {
  const lista = Array.isArray(relatorio) ? relatorio : []
  if (!lista.length) return
  const nowIso = new Date().toISOString()
  const rows = lista.filter(it => it && it.placa).map(it => {
    const kmRaw = it.km_novo != null ? it.km_novo : it.km
    return {
      placa:        String(it.placa).toUpperCase().trim(),
      km:           kmRaw != null ? parseInt(kmRaw, 10) : null,
      data_leitura: it.data_leitura || null,
      hora:         it.hora || null,
      status:       it.status || null,
      veiculo_id:   it.veiculo_id || null,
      importado_em: nowIso
    }
  })
  try {
    const { error } = await supabase.from('km_ticketlog').upsert(rows, { onConflict: 'placa' })
    if (error) console.warn('[km_ticketlog] ignorado:', error.message)
  } catch (e) {
    console.warn('[km_ticketlog] falhou:', e.message)
  }
}

// POST /api/km/aplicar — grava a km dos veículos selecionados (import manual)
// e persiste o snapshot do relatório inteiro (body.relatorio) para a subaba.
async function aplicar(req, res) {
  try {
    const lista     = Array.isArray(req.body && req.body.atualizacoes) ? req.body.atualizacoes : []
    const relatorio = req.body && req.body.relatorio
    const temRelatorio = Array.isArray(relatorio) && relatorio.length > 0
    if (!lista.length && !temRelatorio) return res.status(400).json({ error: 'Nada para atualizar.' })

    const { atualizados, erros } = await gravarKm(lista, 'manual')
    await salvarSnapshotRelatorio(relatorio)
    res.json({ atualizados, erros_count: erros.length, erros })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// GET /api/km/ticketlog — placas do último relatório importado, com localidade e flag de cadastro
async function listarTicketlog(req, res) {
  try {
    const { data: rows, error } = await supabase.from('km_ticketlog').select('*').order('placa')
    if (error) {
      // tabela ainda não criada → devolve vazio (subaba mostra "nenhum relatório importado")
      if (/km_ticketlog/i.test(error.message) || error.code === '42P01') return res.json([])
      throw error
    }

    const { data: veiculos } = await supabase.from('veiculos').select('id, placa, localidade')
    const locById = {}, veiPorPlaca = {}
    for (const v of (veiculos || [])) {
      locById[v.id] = v.localidade
      veiPorPlaca[normPlaca(v.placa)] = v
    }

    const out = (rows || []).map(r => {
      const v = r.veiculo_id ? { localidade: locById[r.veiculo_id] } : veiPorPlaca[normPlaca(r.placa)]
      return {
        placa:        r.placa,
        km:           r.km,
        data_leitura: r.data_leitura,
        hora:         r.hora,
        status:       r.status,
        importado_em: r.importado_em,
        cadastrada:   !!(r.veiculo_id || v),
        localidade:   v ? v.localidade : null
      }
    })
    res.json(out)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Sync online (Parte B) ─────────────────────────────────────────────────────

// Lê o cookie da sessão do portal guardado em config_sistema. Resiliente se a
// coluna/tabela ainda não existir (SQL km-sync.sql não rodado) → devolve null.
async function getSessaoCookie() {
  try {
    const { data, error } = await supabase
      .from('config_sistema').select('ticketlog_sessao').eq('id', 1).single()
    if (error) return null
    return data && data.ticketlog_sessao ? data.ticketlog_sessao : null
  } catch (e) {
    return null
  }
}

// Regrava o cookie quando o portal rotaciona CFID/CFTOKEN (Max-Age=7200). Sem
// isto a sessão viva no portal aparecia como expirada aqui em poucas horas.
async function salvarCookieSessao(cookie) {
  if (!cookie) return
  try {
    await supabase.from('config_sistema').update({ ticketlog_sessao: cookie }).eq('id', 1)
  } catch (e) {
    console.warn('[km] não regravou o cookie rotacionado:', e.message)
  }
}

// Faz login no portal com as credenciais do ambiente e guarda a sessão nova.
// Devolve o cookie, ou null quando não há credenciais / o portal recusou.
async function renovarSessao(motivo) {
  if (!ticketlog.credenciaisPortal()) return null
  try {
    const { cookie } = await ticketlog.loginPortal()
    await salvarCookieSessao(cookie)
    await marcarKeepalive('ok')
    try { await supabase.from('config_sistema').update({ km_sync_ultimo_status: 'ok' }).eq('id', 1) } catch {}
    console.log(`🔑  [km] sessão TicketLog renovada automaticamente (${motivo})`)
    return cookie
  } catch (e) {
    console.warn(`[km] login automático falhou (${motivo}):`, e.message, e.detalhe || '')
    return null
  }
}

// Status de sessão já registrado, pra avisar só na TRANSIÇÃO para expirado
// (o keep-alive roda a cada 15 min — avisar sempre seria spam).
async function statusSessaoAnterior() {
  try {
    const { data } = await supabase.from('config_sistema')
      .select('km_sync_ultimo_status, km_keepalive_status').eq('id', 1).single()
    if (!data) return null
    return data.km_keepalive_status === 'expirado' || data.km_sync_ultimo_status === 'expirado'
      ? 'expirado' : (data.km_keepalive_status || data.km_sync_ultimo_status || null)
  } catch (e) {
    return null
  }
}

// Avisa por e-mail que a sessão caiu E o login automático não resolveu — sem isso
// a pessoa só descobre pela faixa vermelha, quando abre o sistema.
async function avisarSessaoCaiu(detalhe) {
  try {
    const { enviarEmail, statusEmail } = require('../services/email')
    if (!statusEmail().configurado) return
    const { data } = await supabase.from('config_sistema')
      .select('alerta_revisao_emails').eq('id', 1).single()
    const para = (data && data.alerta_revisao_emails) || []
    if (!para.length) return

    const temCred = !!ticketlog.credenciaisPortal()
    await enviarEmail({
      para,
      assunto: '⚠️ Atualização automática de KM parou (sessão TicketLog)',
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.6">
        <p><strong>A atualização automática de quilometragem parou.</strong></p>
        <p>Motivo: ${detalhe || 'sessão do portal TicketLog expirada'}.</p>
        <p>${temCred
          ? 'O login automático está configurado, mas o portal recusou — vale conferir se a senha do usuário da integração mudou.'
          : 'O login automático não está configurado; é preciso reconectar manualmente no sistema (Análise de Gastos → Quilometragem → 🔄 Atualizar (online)).'}</p>
        <p style="color:#777;font-size:12px">Aviso automático do Sistema de Gestão de Manutenção Veicular — Amerinode.</p>
      </div>`,
      texto: `A atualização automática de KM parou. Motivo: ${detalhe || 'sessão TicketLog expirada'}.`
    })
    console.log('[km] aviso de sessão caída enviado por e-mail')
  } catch (e) {
    console.warn('[km] não avisou por e-mail:', e.message)
  }
}

// Anota o resultado da última sync em config_sistema (não derruba a resposta).
async function marcarSync(status) {
  try {
    await supabase.from('config_sistema').update({
      km_sync_ultima_execucao: new Date().toISOString(),
      km_sync_ultimo_status:   status
    }).eq('id', 1)
  } catch (e) {
    console.warn('[km-sync] status ignorado:', e.message)
  }
}

// Anota o resultado do último keep-alive. Resiliente: se as colunas novas
// (km-sync.sql atualizado) ainda não existirem, cai pro campo de status que já
// existe só pra não perder o alerta de expiração.
async function marcarKeepalive(status) {
  const nowIso = new Date().toISOString()
  try {
    const { error } = await supabase.from('config_sistema')
      .update({ km_keepalive_em: nowIso, km_keepalive_status: status }).eq('id', 1)
    if (error && /km_keepalive/.test(error.message) && status === 'expirado') {
      await supabase.from('config_sistema')
        .update({ km_sync_ultimo_status: 'expirado' }).eq('id', 1)
    }
  } catch (e) {
    console.warn('[km-keepalive] status ignorado:', e.message)
  }
}

// Keep-alive: "toca" a sessão do portal periodicamente pra ela não morrer por
// inatividade. Chamado por um timer no server.js. Nunca lança — só loga.
// Falha de rede NÃO marca expirado (evita alarme falso); só um portal que
// devolve login/redirect conta como sessão morta.
async function manterSessaoViva() {
  const cookie = await getSessaoCookie()
  if (!cookie) {
    // Sem cookie guardado, mas com credenciais: já entra sozinho.
    const novo = await renovarSessao('sem sessão guardada')
    return novo ? { alive: true, renovada: true } : { skip: 'sem_sessao' }
  }
  try {
    const ping = await ticketlog.pingSessao({ cookie })
    const { estado } = ping
    if (estado === 'viva') {
      if (ping.cookieMudou) await salvarCookieSessao(ping.cookie)  // portal rotacionou
      await marcarKeepalive('ok')
      return { alive: true, cookieRotacionado: !!ping.cookieMudou }
    }
    if (estado === 'expirada') {
      // Antes de acusar expiração, tenta entrar de novo com as credenciais.
      const novo = await renovarSessao('keep-alive detectou expiração')
      if (novo) return { alive: true, renovada: true }
      const antes = await statusSessaoAnterior()
      await marcarKeepalive('expirado')
      console.warn('[km-keepalive] sessão TicketLog expirada — reconectar pelo modal')
      if (antes !== 'expirado') {
        await avisarSessaoCaiu('a sessão do portal expirou e o login automático não conseguiu renovar')
      }
      return { alive: false }
    }
    // 'erro' = portal instável; NÃO marca expirado pra não dar falso alarme
    console.warn('[km-keepalive] portal instável (não conta como expiração)')
    return { erro: 'portal' }
  } catch (e) {
    console.warn('[km-keepalive] ping falhou (não conta como expiração):', e.message)
    return { erro: e.message }
  }
}

// POST /api/km/sync — baixa o relatório do portal (server-side, cookie guardado),
// atualiza a km dos veículos com leitura 'ok' e regrava o snapshot da subaba.
// Chamado pelo botão "Atualizar (online)" e pelo Railway Cron.
async function sync(req, res) {
  try {
    let cookie = await getSessaoCookie()
    if (!cookie) {
      cookie = await renovarSessao('sync sem sessão guardada')
      if (!cookie) {
        await marcarSync('sem_sessao')
        return res.status(401).json({ error: 'sessao_ausente' })
      }
    }

    const dias = req.body && req.body.dias ? parseInt(req.body.dias, 10) : undefined

    // Sessão expirada no meio do caminho → entra de novo e repete UMA vez.
    let buffer
    try {
      buffer = await ticketlog.baixarRelatorioKm({ cookie, dias })
    } catch (e) {
      if (e.status !== 401) throw e
      const novo = await renovarSessao('sync recebeu 401')
      if (!novo) throw e
      cookie = novo
      buffer = await ticketlog.baixarRelatorioKm({ cookie, dias })
    }
    if (buffer.cookieAtualizado) await salvarCookieSessao(buffer.cookieAtualizado)

    const leituras = parseRelatorio(buffer)
    const itens   = await montarItens(leituras)

    const atualizacoes = itens
      .filter(i => i.status === 'ok' && i.veiculo_id)
      .map(i => ({ veiculo_id: i.veiculo_id, km: i.km_novo, data_leitura: i.data_leitura, placa: i.placa }))

    const { atualizados, erros } = await gravarKm(atualizacoes, 'sync')
    await salvarSnapshotRelatorio(itens)
    await marcarSync('ok')

    res.json({
      ok:            true,
      atualizados,
      total:         itens.length,
      erros_count:   erros.length,
      atualizado_em: new Date().toISOString()
    })
  } catch (err) {
    if (err.status === 401) {
      const antes = await statusSessaoAnterior()
      await marcarSync('expirado')
      if (antes !== 'expirado') {
        await avisarSessaoCaiu('o sync não conseguiu baixar o relatório: sessão expirada')
      }
      return res.status(401).json({ error: 'sessao_expirada' })
    }
    await marcarSync('erro')
    res.status(500).json({ error: err.message })
  }
}

// POST /api/km/sessao — admin cola o cURL (Copy as cURL) ou a string de cookies
// da sessão do portal; extraímos o cookie, guardamos e testamos na hora.
async function salvarSessao(req, res) {
  try {
    const valor  = req.body && (req.body.valor || req.body.cookie || req.body.curl)
    const cookie = ticketlog.extrairCookie(valor)
    if (!cookie) {
      return res.status(400).json({ error: 'Não consegui extrair o cookie. Cole o comando cURL (Copy as cURL) da requisição do relatório, ou a string de cookies.' })
    }

    const expira = req.body && req.body.expira_em ? req.body.expira_em : null
    const { error } = await supabase.from('config_sistema')
      .update({ ticketlog_sessao: cookie, ticketlog_sessao_expira_em: expira })
      .eq('id', 1)
    if (error) throw error

    // Teste rápido (janela curta) só pra informar se a sessão está valendo.
    let testada = false, testeErro = null
    try {
      await ticketlog.baixarRelatorioKm({ cookie, dias: 7 })
      testada = true
    } catch (e) {
      testeErro = e.status === 401 ? 'sessao_invalida' : e.message
    }
    // Reconectou com sucesso → limpa os flags de expiração pra o aviso global sumir na hora.
    if (testada) {
      await marcarKeepalive('ok')
      try {
        await supabase.from('config_sistema').update({ km_sync_ultimo_status: 'ok' }).eq('id', 1)
      } catch (e) { /* resiliente */ }
    }
    res.json({ ok: true, testada, testeErro })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// POST /api/km/login — entra no portal com as credenciais do ambiente e guarda a
// sessão. Serve para testar a configuração e para reconectar sem colar cURL.
async function loginAutomatico(_req, res) {
  if (!ticketlog.credenciaisPortal()) {
    return res.status(412).json({
      error: 'credenciais_ausentes',
      detalhe: 'Defina TICKETLOG_CODIGO, TICKETLOG_USUARIO e TICKETLOG_SENHA no Railway.'
    })
  }
  try {
    const { cookie } = await ticketlog.loginPortal()
    await salvarCookieSessao(cookie)
    await marcarKeepalive('ok')
    try { await supabase.from('config_sistema').update({ km_sync_ultimo_status: 'ok' }).eq('id', 1) } catch {}
    res.json({ ok: true, conectado: true })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, detalhe: err.detalhe || null })
  }
}

// GET /api/km/sessao/status — a tela usa pra saber se pode oferecer "reconectar
// sozinho". Devolve também um diagnóstico das credenciais: só PRESENÇA (nunca
// valores) e os nomes de env que começam com TICKETLOG_, pra pegar erro de
// digitação na variável do Railway.
async function statusSessao(_req, res) {
  try {
    const cookie = await getSessaoCookie()
    const preenchida = n => !!(process.env[n] || '').trim()
    res.json({
      sessao_configurada: !!cookie,
      login_automatico: !!ticketlog.credenciaisPortal(),
      ultimo_status: await statusSessaoAnterior(),
      credenciais: {
        TICKETLOG_CODIGO:  preenchida('TICKETLOG_CODIGO'),
        TICKETLOG_USUARIO: preenchida('TICKETLOG_USUARIO'),
        TICKETLOG_SENHA:   preenchida('TICKETLOG_SENHA')
      },
      variaveis_ticketlog_no_ambiente: Object.keys(process.env).filter(k => /^TICKETLOG/i.test(k)).sort()
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = {
  preview, aplicar, gravarKm, listarTicketlog, sync, salvarSessao, manterSessaoViva,
  parseRelatorio, loginAutomatico, statusSessao
}
