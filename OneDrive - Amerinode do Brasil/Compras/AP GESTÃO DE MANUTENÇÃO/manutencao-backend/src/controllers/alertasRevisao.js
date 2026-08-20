// controllers/alertasRevisao.js — alerta por e-mail de revisão se aproximando.
//
// NADA aqui é regra fixa: destinatários, antecedências (ex.: 10 e 7 dias),
// horário do disparo, incluir ou não as vencidas e o assunto vêm todos de
// `config_sistema` e são editados pelo operador na aba Próximas Revisões
// (subaba 🔔 Alertas por e-mail). O código só aplica o que estiver configurado.
//
// Anti-spam: cada (veículo, data da revisão, antecedência) é gravado em
// `alertas_revisao_log`. Se o veículo já foi avisado no marco de 10 dias, ele só
// volta a aparecer no marco de 7. Se o disparo falhar/pular um dia, o marco
// seguinte ainda pega o veículo (usa "menor antecedência ainda válida", não
// igualdade exata) — não perde aviso por causa de deploy/queda.

const supabase = require('../supabase')
const { enviarEmail, statusEmail } = require('../services/email')

const TZ = process.env.ALERTA_TZ || 'America/Sao_Paulo'
const VENCIDA = -1  // chave de dedupe do aviso "revisão vencida"

const PADRAO = {
  alerta_revisao_ativo: false,
  alerta_revisao_emails: [],
  alerta_revisao_dias: [10, 7],
  alerta_revisao_incluir_vencidas: true,
  alerta_revisao_hora: 8,
  alerta_revisao_assunto: '',
  alerta_revisao_mensagem: '',
  // Lista SEPARADA: avisos técnicos da integração (sessão TicketLog caiu).
  // Não usa alerta_revisao_emails de propósito — o alerta de revisão vai pro time
  // todo, e o técnico só interessa a quem administra a integração.
  alerta_tecnico_emails: []
}

// ── Datas no fuso de Brasília (o Railway roda em UTC) ────────────────────────
function partesAgora() {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date())
  const p = Object.fromEntries(f.map(x => [x.type, x.value]))
  return { data: `${p.year}-${p.month}-${p.day}`, hora: parseInt(p.hour, 10) }
}
const hojeISO = () => partesAgora().data

// "YYYY-MM-DD" → timestamp UTC do dia (evita o fuso deslocar a data)
function diaUTC(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  return Date.UTC(a, m - 1, d)
}
// diferença em dias entre uma data ISO e hoje (negativo = vencida)
const diasAte = dataISO => Math.round((diaUTC(dataISO) - diaUTC(hojeISO())) / 86400000)

const fmtBR = iso => { const [a, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${a}` }

// ── Normalização do que vem da tela ──────────────────────────────────────────
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normalizarEmails(valor) {
  const bruto = Array.isArray(valor) ? valor : String(valor || '').split(/[;,\s]+/)
  const vistos = new Set()
  const ok = [], invalidos = []
  for (const item of bruto) {
    const e = String(item || '').trim().toLowerCase()
    if (!e) continue
    if (!RE_EMAIL.test(e)) { invalidos.push(e); continue }
    if (vistos.has(e)) continue
    vistos.add(e); ok.push(e)
  }
  return { emails: ok, invalidos }
}

// Antecedências: inteiros 0..365, sem repetir, do maior pro menor.
function normalizarDias(valor) {
  const bruto = Array.isArray(valor) ? valor : String(valor || '').split(/[;,\s]+/)
  const set = new Set()
  for (const item of bruto) {
    const n = parseInt(item, 10)
    if (Number.isFinite(n) && n >= 0 && n <= 365) set.add(n)
  }
  return [...set].sort((a, b) => b - a)
}

// ── Config ───────────────────────────────────────────────────────────────────
async function lerConfig() {
  const { data, error } = await supabase
    .from('config_sistema').select('*').eq('id', 1).single()
  if (error) throw error
  const cfg = { ...PADRAO, ...(data || {}) }
  cfg.alerta_revisao_emails = normalizarEmails(cfg.alerta_revisao_emails).emails
  cfg.alerta_tecnico_emails = normalizarEmails(cfg.alerta_tecnico_emails).emails
  cfg.alerta_revisao_dias   = normalizarDias(cfg.alerta_revisao_dias)
  if (!cfg.alerta_revisao_dias.length) cfg.alerta_revisao_dias = PADRAO.alerta_revisao_dias
  const h = parseInt(cfg.alerta_revisao_hora, 10)
  cfg.alerta_revisao_hora = Number.isFinite(h) && h >= 0 && h <= 23 ? h : PADRAO.alerta_revisao_hora
  return cfg
}

// Só o que a tela precisa (o resto de config_sistema tem segredo do TicketLog).
function recorteConfig(cfg) {
  return {
    ativo:            !!cfg.alerta_revisao_ativo,
    emails:           cfg.alerta_revisao_emails,
    emails_tecnico:   cfg.alerta_tecnico_emails,
    dias:             cfg.alerta_revisao_dias,
    incluir_vencidas: cfg.alerta_revisao_incluir_vencidas !== false,
    hora:             cfg.alerta_revisao_hora,
    assunto:          cfg.alerta_revisao_assunto || '',
    mensagem:         cfg.alerta_revisao_mensagem || '',
    ultima_execucao:  cfg.alerta_revisao_ultima_execucao || null,
    ultimo_status:    cfg.alerta_revisao_ultimo_status || null,
    ultimo_detalhe:   cfg.alerta_revisao_ultimo_detalhe || null,
    fuso:             TZ,
    email:            statusEmail()   // { configurado, provedor, remetente, motivo }
  }
}

async function marcarExecucao(status, detalhe) {
  try {
    await supabase.from('config_sistema').update({
      alerta_revisao_ultima_execucao: new Date().toISOString(),
      alerta_revisao_ultimo_status:   status,
      alerta_revisao_ultimo_detalhe:  String(detalhe || '').slice(0, 500),
      atualizado_em: new Date().toISOString()
    }).eq('id', 1)
  } catch (e) {
    console.warn('[alerta-revisao] não gravou status:', e.message)
  }
}

// ── Quem entra no alerta ─────────────────────────────────────────────────────
// Para cada veículo com `proxima_revisao`, escolhe o MENOR marco configurado que
// já foi alcançado (diff <= marco). Assim, com marcos {10,7}: faltando 9 dias cai
// no marco 10; faltando 6, no marco 7. Vencida vira o marco especial -1.
async function montarCandidatos(cfg) {
  const brutos = await lerAgenda()

  const marcos = cfg.alerta_revisao_dias
  const maior  = Math.max(...marcos)
  const itens  = []

  for (const v of brutos) {
    const dias = diasAte(v.data)
    let marco
    if (dias < 0) {
      if (cfg.alerta_revisao_incluir_vencidas === false) continue
      marco = VENCIDA
    } else {
      if (dias > maior) continue
      marco = marcos.filter(m => dias <= m).pop()   // menor marco alcançado
      if (marco === undefined) continue
    }
    itens.push({ ...v, proxima_revisao: v.data, dias, marco, vencida: marco === VENCIDA })
  }
  return itens.sort((a, b) => a.dias - b.dias)
}

// Fonte da agenda: `revisoes_programadas` (uma linha por serviço agendado, com
// tipo e serviço). Se a tabela ainda não existir (SQL manual pendente), cai no
// modelo antigo — uma data solta em `veiculos.proxima_revisao`.
async function lerAgenda() {
  try {
    const { data, error } = await supabase
      .from('revisoes_programadas')
      .select('id, veiculo_id, placa, data_prevista, km_previsto, tipo, servico, observacao')
      .eq('status', 'Pendente')
      .order('data_prevista')
    if (error) throw error

    // localidade/km atual vêm do cadastro do veículo
    const { data: veics } = await supabase.from('veiculos').select('id, localidade, km_atual')
    const porId = new Map((veics || []).map(v => [v.id, v]))

    return (data || []).map(r => {
      const v = porId.get(r.veiculo_id) || {}
      return {
        revisao_id: r.id,
        veiculo_id: r.veiculo_id,
        placa: r.placa,
        localidade: v.localidade || '',
        km_atual: v.km_atual || null,
        km_previsto: r.km_previsto || null,
        tipo: r.tipo || 'Preventiva',
        servico: r.servico || 'Revisão preventiva',
        data: String(r.data_prevista).slice(0, 10)
      }
    })
  } catch (e) {
    console.warn('[alerta-revisao] usando veiculos.proxima_revisao (revisoes_programadas indisponível):', e.message)
    const { data, error } = await supabase
      .from('veiculos')
      .select('id, placa, localidade, km_atual, proxima_revisao')
      .not('proxima_revisao', 'is', null)
      .order('proxima_revisao')
    if (error) throw error
    return (data || []).map(v => ({
      revisao_id: null,
      veiculo_id: v.id,
      placa: v.placa,
      localidade: v.localidade || '',
      km_atual: v.km_atual || null,
      km_previsto: null,
      tipo: 'Preventiva',
      servico: 'Revisão preventiva',
      data: String(v.proxima_revisao).slice(0, 10)
    }))
  }
}

// Marca `ja_enviado` consultando o log (chave: veículo + data + marco).
async function marcarJaEnviados(itens) {
  if (!itens.length) return itens
  const ids = [...new Set(itens.map(i => i.veiculo_id))]
  let log = []
  try {
    const { data, error } = await supabase
      .from('alertas_revisao_log')
      .select('veiculo_id, data_revisao, dias_antecedencia, servico')
      .in('veiculo_id', ids)
    if (error) throw error
    log = data || []
  } catch (e) {
    // Tabela/coluna ainda não criada (SQL manual pendente): segue sem dedupe.
    console.warn('[alerta-revisao] log indisponível, seguindo sem dedupe:', e.message)
    return itens.map(i => ({ ...i, ja_enviado: false }))
  }
  // A chave inclui o SERVIÇO: pneu e alinhamento na mesma data são avisos distintos.
  const chaves = new Set(log.map(l =>
    `${l.veiculo_id}|${String(l.data_revisao).slice(0, 10)}|${l.dias_antecedencia}|${l.servico || ''}`))
  return itens.map(i => ({
    ...i,
    ja_enviado: chaves.has(`${i.veiculo_id}|${i.proxima_revisao}|${i.marco}|${i.servico || ''}`)
  }))
}

async function registrarEnvios(itens, destinatarios) {
  if (!itens.length) return
  const linhas = itens.map(i => ({
    veiculo_id: i.veiculo_id,
    placa: i.placa,
    data_revisao: i.proxima_revisao,
    dias_antecedencia: i.marco,
    servico: i.servico || '',
    revisao_id: i.revisao_id || null,
    destinatarios
  }))
  try {
    await supabase.from('alertas_revisao_log')
      .upsert(linhas, { onConflict: 'veiculo_id,data_revisao,dias_antecedencia,servico', ignoreDuplicates: true })
  } catch (e) {
    console.warn('[alerta-revisao] não gravou o log de envio:', e.message)
  }
}

// ── E-mail ───────────────────────────────────────────────────────────────────
function rotuloPrazo(i) {
  if (i.vencida) return `vencida há ${Math.abs(i.dias)} dia(s)`
  if (i.dias === 0) return 'vence HOJE'
  return `faltam ${i.dias} dia(s)`
}

function montarAssunto(cfg, itens) {
  const vencidas = itens.filter(i => i.vencida).length
  const base = (cfg.alerta_revisao_assunto || '').trim() ||
    '🛡️ Manutenção: {n} veículo(s) com revisão se aproximando'
  return base
    .replace(/\{n\}/g, String(itens.length))
    .replace(/\{vencidas\}/g, String(vencidas))
    .replace(/\{data\}/g, fmtBR(hojeISO()))
}

// O recado livre é digitado pelo operador → escapa HTML antes de injetar no e-mail
// e converte quebra de linha em <br> (parágrafo em branco vira espaço entre blocos).
const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function blocoMensagem(cfg) {
  const txt = String(cfg.alerta_revisao_mensagem || '').trim()
  if (!txt) return ''
  return `<div style="margin:0 0 16px;padding:12px 14px;background:#FAFCFE;border-left:3px solid #185FA5;border-radius:6px;font-size:13px;line-height:1.6;color:#33475B">
        ${escapeHtml(txt).replace(/\r?\n/g, '<br>')}
      </div>`
}

function montarHtml(cfg, itens) {
  const linhas = itens.map(i => {
    const cor = i.vencida ? '#B22222' : (i.dias <= 3 ? '#B26A00' : '#0C447C')
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #E6ECF2"><strong>${escapeHtml(i.placa)}</strong></td>
      <td style="padding:8px 10px;border-bottom:1px solid #E6ECF2">${escapeHtml(i.localidade || '-')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E6ECF2">${escapeHtml(i.tipo || 'Preventiva')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E6ECF2">${escapeHtml(i.servico || '-')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E6ECF2">${i.km_atual ? Number(i.km_atual).toLocaleString('pt-BR') + ' km' : '-'}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E6ECF2">${fmtBR(i.proxima_revisao)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E6ECF2;color:${cor};font-weight:600">${rotuloPrazo(i)}</td>
    </tr>`
  }).join('')

  const marcos = cfg.alerta_revisao_dias.join(', ')
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#F5F8FB;font-family:Arial,Helvetica,sans-serif;color:#333">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #E0E6ED;border-radius:10px;overflow:hidden">
    <div style="background:#185FA5;color:#fff;padding:16px 20px">
      <div style="font-size:17px;font-weight:700">🛡️ Revisões de manutenção se aproximando</div>
      <div style="font-size:12px;opacity:.9;margin-top:3px">Amerinode · Gestão de Manutenção Veicular · ${fmtBR(hojeISO())}</div>
    </div>
    <div style="padding:18px 20px">
      <p style="margin:0 0 14px;font-size:14px">
        <strong>${itens.length}</strong> veículo(s) precisam de atenção.
      </p>
      ${blocoMensagem(cfg)}
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#F5F8FB;color:#0C447C;text-align:left">
            <th style="padding:8px 10px;border-bottom:2px solid #E0E6ED">Placa</th>
            <th style="padding:8px 10px;border-bottom:2px solid #E0E6ED">Localidade</th>
            <th style="padding:8px 10px;border-bottom:2px solid #E0E6ED">Tipo</th>
            <th style="padding:8px 10px;border-bottom:2px solid #E0E6ED">Serviço</th>
            <th style="padding:8px 10px;border-bottom:2px solid #E0E6ED">KM atual</th>
            <th style="padding:8px 10px;border-bottom:2px solid #E0E6ED">Data prevista</th>
            <th style="padding:8px 10px;border-bottom:2px solid #E0E6ED">Prazo</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin:18px 0 0;font-size:12px;color:#777;line-height:1.6">
        Aviso automático configurado para <strong>${marcos}</strong> dia(s) de antecedência
        ${cfg.alerta_revisao_incluir_vencidas === false ? '' : ' (e revisões já vencidas)'}.
        Cada veículo é avisado uma vez por marco de antecedência.<br>
        Para alterar destinatários ou prazos: sistema → <strong>Próximas Revisões → 🔔 Alertas por e-mail</strong>.
      </p>
    </div>
  </div>
</body></html>`
}

function montarTexto(cfg, itens) {
  const recado = String(cfg.alerta_revisao_mensagem || '').trim()
  return 'Revisões de manutenção se aproximando:\n\n' +
    (recado ? recado + '\n\n' : '') +
    itens.map(i => `- ${i.placa} (${i.localidade || 's/ localidade'}) — ${i.servico || 'Revisão'} [${i.tipo || 'Preventiva'}] — ${fmtBR(i.proxima_revisao)} · ${rotuloPrazo(i)}`).join('\n') +
    '\n\nSistema de Gestão de Manutenção Veicular — Amerinode'
}

// ── Execução ─────────────────────────────────────────────────────────────────
// opcoes: { forcar: bool (reenvia mesmo já avisado), ignorarAtivo: bool, origem: string }
async function executarAlerta(opcoes = {}) {
  const cfg = await lerConfig()

  if (!cfg.alerta_revisao_ativo && !opcoes.ignorarAtivo) {
    return { enviado: false, status: 'desativado', motivo: 'Alerta automático desativado na configuração.', total: 0 }
  }
  if (!cfg.alerta_revisao_emails.length) {
    await marcarExecucao('sem_destinatarios', 'Nenhum e-mail cadastrado para receber o alerta.')
    return { enviado: false, status: 'sem_destinatarios', motivo: 'Nenhum e-mail cadastrado para receber o alerta.', total: 0 }
  }

  const candidatos = await marcarJaEnviados(await montarCandidatos(cfg))
  const itens = opcoes.forcar ? candidatos : candidatos.filter(i => !i.ja_enviado)

  if (!itens.length) {
    await marcarExecucao('sem_pendencias', `Nenhum veículo novo a avisar (${candidatos.length} já avisado(s)).`)
    return { enviado: false, status: 'sem_pendencias', motivo: 'Nenhum veículo novo a avisar.', total: 0, ja_avisados: candidatos.length }
  }

  try {
    const res = await enviarEmail({
      para: cfg.alerta_revisao_emails,
      assunto: montarAssunto(cfg, itens),
      html: montarHtml(cfg, itens),
      texto: montarTexto(cfg, itens)
    })
    await registrarEnvios(itens, cfg.alerta_revisao_emails)
    const detalhe = `${itens.length} veículo(s) para ${cfg.alerta_revisao_emails.length} destinatário(s)${opcoes.origem ? ' · ' + opcoes.origem : ''}`
    await marcarExecucao('ok', detalhe)
    return {
      enviado: true, status: 'ok', total: itens.length,
      destinatarios: cfg.alerta_revisao_emails, provedor: res.provedor,
      veiculos: itens.map(i => ({ placa: i.placa, proxima_revisao: i.proxima_revisao, dias: i.dias, marco: i.marco }))
    }
  } catch (err) {
    await marcarExecucao('erro', err.message)
    err.status = err.status || 500
    throw err
  }
}

// ── Handlers HTTP ────────────────────────────────────────────────────────────

// GET /api/alertas/revisao/config
async function getConfigAlerta(_req, res) {
  try {
    res.json(recorteConfig(await lerConfig()))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// PUT /api/alertas/revisao/config — tudo que o operador ajusta
async function putConfigAlerta(req, res) {
  try {
    const body = req.body || {}
    const payload = { atualizado_em: new Date().toISOString() }
    let invalidos = []

    if ('ativo' in body)  payload.alerta_revisao_ativo = !!body.ativo
    if ('emails' in body) {
      const n = normalizarEmails(body.emails)
      invalidos = n.invalidos
      if (invalidos.length) return res.status(400).json({ error: `E-mail inválido: ${invalidos.join(', ')}` })
      payload.alerta_revisao_emails = n.emails
    }
    if ('emails_tecnico' in body) {
      const n = normalizarEmails(body.emails_tecnico)
      if (n.invalidos.length) return res.status(400).json({ error: `E-mail inválido (avisos técnicos): ${n.invalidos.join(', ')}` })
      payload.alerta_tecnico_emails = n.emails
    }
    if ('dias' in body) {
      const dias = normalizarDias(body.dias)
      if (!dias.length) return res.status(400).json({ error: 'Informe ao menos uma antecedência em dias (ex.: 10 e 7).' })
      payload.alerta_revisao_dias = dias
    }
    if ('incluir_vencidas' in body) payload.alerta_revisao_incluir_vencidas = !!body.incluir_vencidas
    if ('hora' in body) {
      const h = parseInt(body.hora, 10)
      if (!Number.isFinite(h) || h < 0 || h > 23) return res.status(400).json({ error: 'Horário inválido (0 a 23).' })
      payload.alerta_revisao_hora = h
    }
    if ('assunto' in body) payload.alerta_revisao_assunto = String(body.assunto || '').trim().slice(0, 200) || null
    if ('mensagem' in body) payload.alerta_revisao_mensagem = String(body.mensagem || '').trim().slice(0, 2000) || null

    // Ligar o alerta sem nenhum destinatário é erro de operação, não config válida.
    if (payload.alerta_revisao_ativo) {
      const emails = 'alerta_revisao_emails' in payload
        ? payload.alerta_revisao_emails
        : (await lerConfig()).alerta_revisao_emails
      if (!emails.length) return res.status(400).json({ error: 'Cadastre ao menos um e-mail antes de ativar o alerta.' })
    }

    const { error } = await supabase.from('config_sistema').update(payload).eq('id', 1)
    if (error) throw error
    res.json(recorteConfig(await lerConfig()))
  } catch (err) {
    // Colunas novas → PostgREST reclama até o SQL manual rodar (ver CLAUDE.md).
    const falta = /schema cache|column .* does not exist|alerta_revisao|alerta_tecnico/i.test(err.message)
    res.status(500).json({
      error: falta
        ? `As colunas de configuração ainda não existem no banco. Rode "scripts/alertas-revisao.sql" no Supabase (SQL Editor) e depois NOTIFY pgrst, 'reload schema'. Detalhe: ${err.message}`
        : err.message
    })
  }
}

// GET /api/alertas/revisao/previa — quem seria avisado agora (não envia nada)
async function previaAlerta(_req, res) {
  try {
    const cfg = await lerConfig()
    const itens = await marcarJaEnviados(await montarCandidatos(cfg))
    res.json({
      hoje: hojeISO(),
      dias: cfg.alerta_revisao_dias,
      incluir_vencidas: cfg.alerta_revisao_incluir_vencidas !== false,
      destinatarios: cfg.alerta_revisao_emails,
      total: itens.length,
      novos: itens.filter(i => !i.ja_enviado).length,
      itens
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// POST /api/alertas/revisao/executar — botão "Enviar agora" e agendador externo
// body: { forcar?: bool, ignorarAtivo?: bool }
async function executarHandler(req, res) {
  try {
    const r = await executarAlerta({
      forcar: !!(req.body && req.body.forcar),
      ignorarAtivo: !!(req.body && req.body.ignorarAtivo),
      origem: 'manual'
    })
    res.json(r)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code || null })
  }
}

// POST /api/alertas/revisao/teste — e-mail de teste (não grava log, não filtra)
async function testeAlerta(req, res) {
  try {
    const cfg = await lerConfig()
    const destino = (req.body && req.body.email)
      ? normalizarEmails(req.body.email).emails
      : cfg.alerta_revisao_emails
    if (!destino.length) return res.status(400).json({ error: 'Cadastre ao menos um e-mail (ou informe um para o teste).' })

    const itens = (await montarCandidatos(cfg)).slice(0, 10)
    const exemplo = itens.length ? itens : [{
      placa: 'ABC1D23', localidade: 'Exemplo', km_atual: 120000,
      tipo: 'Preventiva', servico: 'Alinhamento e balanceamento',
      proxima_revisao: hojeISO(), dias: 7, marco: 7, vencida: false
    }]
    const r = await enviarEmail({
      para: destino,
      assunto: '[TESTE] ' + montarAssunto(cfg, exemplo),
      html: montarHtml(cfg, exemplo),
      texto: montarTexto(cfg, exemplo)
    })
    res.json({ enviado: true, destinatarios: destino, provedor: r.provedor, amostra: itens.length, exemplo: !itens.length })
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code || null })
  }
}

// GET /api/alertas/revisao/historico — últimos avisos já disparados
async function historicoAlerta(req, res) {
  try {
    const limite = Math.min(parseInt(req.query.limite, 10) || 50, 500)
    const { data, error } = await supabase
      .from('alertas_revisao_log')
      .select('placa, data_revisao, dias_antecedencia, destinatarios, enviado_em')
      .order('enviado_em', { ascending: false })
      .limit(limite)
    if (error) throw error
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Agendador interno (mesmo padrão do keep-alive do TicketLog) ──────────────
// Roda de tempos em tempos e dispara UMA vez por dia, a partir da hora escolhida
// pelo operador. Não depende de cron externo — mas o endpoint continua aberto
// pra quem preferir usar cron-job.org.
async function tickAgendado() {
  const cfg = await lerConfig()
  if (!cfg.alerta_revisao_ativo) return { pulado: 'desativado' }

  const { data: hoje, hora } = partesAgora()
  if (hora < cfg.alerta_revisao_hora) return { pulado: 'antes_da_hora' }

  const ultima = cfg.alerta_revisao_ultima_execucao
  if (ultima) {
    const dataUltima = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ultima))
    if (dataUltima === hoje) return { pulado: 'ja_rodou_hoje' }
  }
  return await executarAlerta({ origem: 'agendado' })
}

function iniciarAgendador() {
  const min = parseInt(process.env.ALERTA_REVISAO_TICK_MIN || '20', 10)
  if (!min || min <= 0) {
    console.log('🔕  Agendador de alertas de revisão desativado (ALERTA_REVISAO_TICK_MIN=0)')
    return
  }
  console.log(`🔔  Agendador de alertas de revisão a cada ${min} min (fuso ${TZ})`)
  const tick = () => tickAgendado()
    .then(r => { if (r && r.enviado) console.log(`[alerta-revisao] enviado: ${r.total} veículo(s)`) })
    .catch(e => console.warn('[alerta-revisao] tick falhou:', e.message))
  setTimeout(tick, 90 * 1000)          // 1ª checagem ~1,5 min após subir
  setInterval(tick, min * 60 * 1000)
}

module.exports = {
  getConfigAlerta, putConfigAlerta, previaAlerta, executarHandler, testeAlerta,
  historicoAlerta, iniciarAgendador, executarAlerta, tickAgendado
}
