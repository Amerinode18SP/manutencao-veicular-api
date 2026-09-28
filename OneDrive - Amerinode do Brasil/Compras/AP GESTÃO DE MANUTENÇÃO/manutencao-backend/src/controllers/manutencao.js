const supabase = require('../supabase')
const XLSX     = require('xlsx')
// Regra da placa: um lugar só (ver o aviso em utils/placa.js).
const { normPlaca, placaValida, erroPlacaCom } = require('../utils/placa')

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseData(valor) {
  if (!valor && valor !== 0) return null
  // Date object (cellDates: true)
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return null
    return valor.toISOString().split('T')[0]
  }
  const s = String(valor).trim()
  if (!s) return null
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // ISO com hora
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s.substring(0, 10)
  // DD/MM/YYYY
  const p = s.split('/')
  if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`
  // Serial numérico do Excel (ex: 46775)
  if (/^\d{4,5}$/.test(s)) {
    const d = new Date(Math.round((parseInt(s) - 25569) * 86400 * 1000))
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }
  return null
}

// Localidade, modelo, supervisor e oficina viram MAIÚSCULAS ao gravar — mesma
// regra do cadastro de veículos (outros.js). Sem isso, "campinas" e "CAMPINAS"
// voltam a ser dois lugares no painel e nos rankings, e ninguém percebe.
// ⚠️ observacoes NÃO entra: é texto corrido.
function caixaAlta(v) {
  const s = String(v == null ? '' : v).trim()
  return s === '' ? null : s.toUpperCase().replace(/\s+/g, ' ')
}

// Manutenção marcada como PERDA TOTAL dá baixa no veículo na mesma hora.
//
// ⚠️ POR QUE AUTOMÁTICO: os dois registros são a mesma notícia — o carro saiu da
// frota. Deixar para alguém lembrar de ir ao cadastro depois significa, no dia
// em que esquecer, um veículo destruído continuar ativo e sendo cobrado nas
// Próximas Revisões. O sistema sabe disso no instante em que o status muda.
//
// Não sobrescreve baixa que já exista (alguém pode ter registrado como Vendido
// por outro motivo) e nunca derruba o registro se o cadastro falhar: a
// manutenção já foi gravada, e perder isso seria pior.
async function darBaixaPorPerdaTotal(placa, dataSaida) {
  try {
    const { data: veic } = await supabase.from('veiculos')
      .select('id, motivo_baixa').eq('placa', normPlaca(placa)).maybeSingle()
    if (!veic || veic.motivo_baixa) return
    await supabase.from('veiculos').update({
      ativo: false,
      motivo_baixa: 'Perda total',
      data_baixa: dataSaida || new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    }).eq('id', veic.id)
    console.log(`[manutencao] ${placa}: baixa por perda total registrada no cadastro`)
  } catch (e) {
    console.warn('[manutencao] não deu baixa por perda total (rodar scripts/perda-total.sql):', e.message)
  }
}

// Campos pedidos pela direção (28/09/2026). Trata só o que VEIO, para um update
// parcial não apagar o resto.
// A placa do alugado passa pela MESMA conferência de formato das outras: é uma
// placa de verdade, e aceitar qualquer texto aqui recriaria o problema dos
// carros fantasma num campo novo.
function camposDirecao(b) {
  const out = {}
  if (b.placa_alugado !== undefined) {
    const p = normPlaca(b.placa_alugado)
    if (p && !placaValida(p)) { const e = new Error(erroPlacaCom(b.placa_alugado)); e.status = 400; throw e }
    out.placa_alugado = p || null
  }
  if (b.previsao_devolucao !== undefined) out.previsao_devolucao = parseData(b.previsao_devolucao)
  if (b.servico_realizado !== undefined) {
    const s = String(b.servico_realizado ?? '').trim()
    out.servico_realizado = s === '' ? null : s
  }
  if (b.em_seguro !== undefined) out.em_seguro = Boolean(b.em_seguro)
  return out
}

function diasEntre(inicio, fim) {
  if (!inicio) return null
  const d1 = new Date(inicio + 'T00:00:00')
  const d2 = fim ? new Date(fim + 'T00:00:00') : new Date()
  return Math.max(0, Math.round((d2 - d1) / 86400000))
}

// ── Listar ────────────────────────────────────────────────────────────────────
async function listar(req, res) {
  try {
    const { status, placa, supervisor, localidade, tipo_manutencao,
            data_inicio, data_fim, page = 1, limit = 50 } = req.query

    let query = supabase
      .from('manutencoes')
      .select('*', { count: 'exact' })
      .order('data_entrada', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (status)          query = query.eq('status', status)
    if (placa)           query = query.ilike('placa', `%${placa}%`)
    if (supervisor)      query = query.ilike('supervisor', `%${supervisor}%`)
    if (localidade)      query = query.ilike('localidade', `%${localidade}%`)
    if (tipo_manutencao) query = query.eq('tipo_manutencao', tipo_manutencao)
    if (data_inicio)     query = query.gte('data_entrada', data_inicio)
    if (data_fim)        query = query.lte('data_entrada', data_fim)

    const { data, error, count } = await query
    if (error) throw error

    // Adiciona dias_efetivos calculado
    const enriched = (data || []).map(m => ({
      ...m,
      dias_efetivos: diasEntre(m.data_entrada, m.data_saida)
    }))

    res.json({ data: enriched, total: count, page: Number(page), limit: Number(limit) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Buscar por ID ─────────────────────────────────────────────────────────────
async function buscarPorId(req, res) {
  try {
    const { data, error } = await supabase
      .from('manutencoes')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Registro não encontrado' })

    res.json({ ...data, dias_efetivos: diasEntre(data.data_entrada, data.data_saida) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Criar ─────────────────────────────────────────────────────────────────────
async function criar(req, res) {
  try {
    const {
      placa, modelo, localidade, supervisor,
      data_entrada, data_saida, previsao_retorno, dias_previstos,
      tipo_manutencao = 'Corretiva',
      veiculo_alugado = false, veiculo_devolvido = false, data_devolucao,
      num_os, oficina, status = 'Em Andamento', observacoes, anexos,
      placa_alugado, previsao_devolucao, servico_realizado, em_seguro = false
    } = req.body

    if (!placa || !data_entrada)
      return res.status(400).json({ error: 'Placa e data_entrada são obrigatórios.' })
    // Registrar manutenção CRIA o veículo no cadastro (upsert por placa mais
    // adiante). Sem esta conferência, uma placa digitada errada aqui nasce como
    // veículo novo lá — foi assim que o cadastro ganhou carros fantasma.
    if (!placaValida(placa)) return res.status(400).json({ error: erroPlacaCom(placa) })

    const payload = {
      placa: normPlaca(placa),
      modelo: caixaAlta(modelo),
      localidade: caixaAlta(localidade),
      supervisor: caixaAlta(supervisor),
      data_entrada: parseData(data_entrada),
      data_saida: parseData(data_saida),
      previsao_retorno: parseData(previsao_retorno),
      dias_previstos: dias_previstos ? parseInt(dias_previstos) : null,
      tipo_manutencao,
      veiculo_alugado: Boolean(veiculo_alugado),
      veiculo_devolvido: Boolean(veiculo_devolvido),
      data_devolucao: parseData(data_devolucao),
      num_os: num_os?.toString().trim() || null,
      oficina: caixaAlta(oficina),
      status,
      observacoes: observacoes?.toString().trim() || null,
      anexos: Array.isArray(anexos) ? anexos : [],
      convertido_ordem: false,
      ...camposDirecao({ placa_alugado, previsao_devolucao, servico_realizado, em_seguro }),
    }

    const { data, error } = await supabase
      .from('manutencoes')
      .insert(payload)
      .select()
      .single()

    if (error) throw error
    if (data && data.status === 'Perda total') await darBaixaPorPerdaTotal(data.placa, data.data_saida)
    res.status(201).json(data)
  } catch (err) {
    res.status(err.status === 400 ? 400 : 500).json({ error: err.message })
  }
}

// ── Atualizar ─────────────────────────────────────────────────────────────────
async function atualizar(req, res) {
  try {
    const campos = [
      'placa','modelo','localidade','supervisor',
      'data_entrada','data_saida','previsao_retorno','dias_previstos',
      'tipo_manutencao','veiculo_alugado','veiculo_devolvido','data_devolucao',
      'num_os','oficina','status','observacoes','anexos',
      'placa_alugado','previsao_devolucao','servico_realizado','em_seguro'
    ]

    const payload = {}
    for (const c of campos) {
      if (req.body[c] !== undefined) payload[c] = req.body[c]
    }

    // Normalizar datas
    for (const d of ['data_entrada','data_saida','previsao_retorno','data_devolucao']) {
      if (payload[d] !== undefined) payload[d] = parseData(payload[d])
    }

    // Caixa alta só no campo que veio — um update parcial não mexe no resto.
    for (const c of ['modelo','localidade','supervisor','oficina']) {
      if (payload[c] !== undefined) payload[c] = caixaAlta(payload[c])
    }
    Object.assign(payload, camposDirecao(payload))

    if (payload.placa) {
      if (!placaValida(payload.placa)) return res.status(400).json({ error: erroPlacaCom(payload.placa) })
      payload.placa = normPlaca(payload.placa)
    }

    const { data, error } = await supabase
      .from('manutencoes')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) throw error
    if (data && data.status === 'Perda total') await darBaixaPorPerdaTotal(data.placa, data.data_saida)
    res.json(data)
  } catch (err) {
    res.status(err.status === 400 ? 400 : 500).json({ error: err.message })
  }
}

// ── Excluir ───────────────────────────────────────────────────────────────────
async function excluir(req, res) {
  try {
    const { error } = await supabase
      .from('manutencoes')
      .delete()
      .eq('id', req.params.id)

    if (error) throw error
    res.json({ message: 'Registro excluído com sucesso.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Converter em Ordem de Compra ──────────────────────────────────────────────
async function converterEmOrdem(req, res) {
  try {
    // Buscar a manutenção
    const { data: man, error: me } = await supabase
      .from('manutencoes')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (me) throw me
    if (!man) return res.status(404).json({ error: 'Registro não encontrado' })
    if (man.convertido_ordem) return res.status(400).json({ error: 'Já convertido em ordem de compra.' })

    // Dados vindos do body para complementar a ordem
    const {
      fornecedor, cnpj,
      supervisor, nota_fiscal, data_ordem,
      // Item único (compat. retro)
      categoria = 'Serviço',
      item, valor_item = 0, quantidade = 1,
      // Lista de itens (novo formato — múltiplos itens por OC)
      itens,
      observacao, num_ordem, link_ordem,
      status = 'Pendente'
    } = req.body

    // Normaliza para array
    const listaItens = Array.isArray(itens) && itens.length
      ? itens.map(it => ({
          item:       (it.item || '').toString().trim(),
          categoria:  it.categoria || 'Serviço',
          valor_item: parseFloat(it.valor_item) || 0,
          quantidade: parseInt(it.quantidade) || 1
        })).filter(it => it.item)
      : (item ? [{ item: item.toString().trim(), categoria, valor_item: parseFloat(valor_item) || 0, quantidade: parseInt(quantidade) || 1 }] : [])

    if (!fornecedor || !cnpj || !nota_fiscal || listaItens.length === 0)
      return res.status(400).json({ error: 'fornecedor, cnpj, nota_fiscal e ao menos um item são obrigatórios.' })

    // Helper: tenta operação; se erro indicar coluna faltante, refaz sem ela
    async function tentarSemColunaFaltante(payload, fn) {
      let r = await fn(payload)
      let p = payload
      while (r.error && /Could not find the '([^']+)' column/.test(r.error.message)) {
        const col = r.error.message.match(/Could not find the '([^']+)' column/)[1]
        if (!(col in p)) break
        p = { ...p }
        delete p[col]
        r = await fn(p)
      }
      return r
    }

    // Upsert veículo
    const veiculoPayload = {
      placa: man.placa,
      localidade: man.localidade || '',
      km_atual: null,
      proxima_revisao: null
    }
    if (man.modelo) veiculoPayload.observacao = `Modelo: ${man.modelo}`

    const { data: v, error: ve } = await tentarSemColunaFaltante(
      veiculoPayload,
      p => supabase.from('veiculos').upsert(p, { onConflict: 'placa' }).select().single()
    )
    if (ve) throw ve

    // Upsert fornecedor
    const cnpjLimpo = cnpj.toString().replace(/\D/g, '')
    const { data: f, error: fe } = await tentarSemColunaFaltante(
      { razao_social: fornecedor.toString().trim(), cnpj: cnpjLimpo },
      p => supabase.from('fornecedores').upsert(p, { onConflict: 'cnpj' }).select().single()
    )
    if (fe) throw fe

    // Criar uma linha de ordem por item
    const dataOrdem = parseData(data_ordem) || new Date().toISOString().split('T')[0]
    const ordensCriadas = []
    for (const it of listaItens) {
      const ordemPayload = {
        veiculo_id:    v.id,
        fornecedor_id: f.id,
        supervisor:    supervisor || man.supervisor || '',
        num_ordem:     num_ordem || man.num_os || null,
        link_ordem:    link_ordem || null,
        nota_fiscal:   nota_fiscal.toString().trim(),
        data_ordem:    dataOrdem,
        categoria:     it.categoria,
        item:          it.item,
        valor_item:    it.valor_item,
        quantidade:    it.quantidade,
        valor_total:   it.valor_item * it.quantidade,
        observacao:    observacao || man.observacoes || null,
        status,
        origem:        'Manual'
      }
      const { data: o, error: oe } = await tentarSemColunaFaltante(
        ordemPayload,
        p => supabase.from('ordens').insert(p).select().single()
      )
      if (oe) throw oe
      ordensCriadas.push(o)
    }

    // Marcar manutenção como convertida (referencia a primeira ordem)
    await supabase
      .from('manutencoes')
      .update({
        convertido_ordem: true,
        ordem_id: ordensCriadas[0].id,
        status: man.status === 'Em Andamento' ? 'Retornado' : man.status,
        data_saida: man.data_saida || new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)

    res.status(201).json({ ordens: ordensCriadas, ordem: ordensCriadas[0], manutencao_id: req.params.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Dashboard: resumo ─────────────────────────────────────────────────────────
async function resumoDash(req, res) {
  try {
    const hoje = new Date().toISOString().split('T')[0]

    // Total em andamento
    const { count: emAndamento, error: e1 } = await supabase
      .from('manutencoes')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Em Andamento')
    if (e1) throw e1

    // Veículos alugados ativos (em andamento + alugado + não devolvido)
    const { count: alugadosAtivos, error: e2 } = await supabase
      .from('manutencoes')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Em Andamento')
      .eq('veiculo_alugado', true)
      .eq('veiculo_devolvido', false)
    if (e2) throw e2

    // Em atraso (data previsao_retorno < hoje e status Em Andamento)
    const { count: emAtraso, error: e3 } = await supabase
      .from('manutencoes')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Em Andamento')
      .lt('previsao_retorno', hoje)
    if (e3) throw e3

    // Retornados no mês atual
    const inicioMes = new Date(); inicioMes.setDate(1)
    const inicioMesStr = inicioMes.toISOString().split('T')[0]
    const { count: retornadosMes, error: e4 } = await supabase
      .from('manutencoes')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Retornado')
      .gte('data_saida', inicioMesStr)
    if (e4) throw e4

    // Média de dias (em andamento)
    const { data: andamento, error: e5 } = await supabase
      .from('manutencoes')
      .select('data_entrada, data_saida')
      .eq('status', 'Em Andamento')
    if (e5) throw e5

    const mediaDias = andamento?.length
      ? Math.round(andamento.reduce((s, m) => s + diasEntre(m.data_entrada, m.data_saida), 0) / andamento.length)
      : 0

    res.json({ emAndamento, alugadosAtivos, emAtraso, retornadosMes, mediaDias })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Situação atual (painel "em aberto") ───────────────────────────────────────
// Responde "o que está parado AGORA", numa lista só, do mais parado para o menos.
//
// "Em aberto" = tudo que ainda não voltou: Em Andamento, Orçamento e Aprovado
// (decisão da Luciana, 28/09/2026). Ficam de fora apenas Retornado e Cancelado.
// ⚠️ A lista é por EXCLUSÃO de propósito: um status novo no CHECK da tabela entra
// aqui sozinho. Listar os abertos um a um faria o veículo do status novo sumir do
// painel sem erro nenhum — parado na oficina e invisível para quem cobra.
// 'Perda total' entra aqui porque o carro NUNCA vai retornar: sem isso a
// manutenção dele ficaria em aberto para sempre, contando como veículo parado e
// inflando o "% da frota parada" todo mês.
const STATUS_FECHADOS = ['Retornado', 'Cancelado', 'Perda total']

// Lê o cadastro de veículos (régua da frota + baixas) e os SERVIÇOS.
//
// ⚠️ O QUE FOI FEITO NO CARRO ESTÁ NAS ORDENS DE COMPRA, não na manutenção.
// Descoberto em 28/09/2026: o DOBLO aparecia como "serviço não descrito"
// enquanto existia a ordem "ADITIVO DE RADIADOR" para a mesma placa. A
// manutenção guarda datas e status; o serviço em si é o item comprado. Sem
// juntar os dois, a coluna mente por omissão.
async function lerCadastroEServicos() {
  const vazio = { frotaAtiva: null, baixas: [], servicosPorPlaca: new Map() }
  try {
    const { veiculoAtivo } = require('./outros')
    const { data: veics, error } = await supabase.from('veiculos').select('*')
    if (error) return vazio

    const porId = new Map((veics || []).map(v => [v.id, v]))
    const servicosPorPlaca = new Map()
    try {
      const { data: ords } = await supabase.from('ordens')
        .select('item, categoria, data_ordem, veiculo_id')
        .order('data_ordem', { ascending: false })
        .limit(3000)
      for (const o of (ords || [])) {
        const v = porId.get(o.veiculo_id)
        if (!v || !o.item) continue
        const chave = normPlaca(v.placa)
        const lista = servicosPorPlaca.get(chave) || []
        if (lista.length < 3) {   // as 3 mais recentes bastam para a tela
          lista.push({ item: o.item, categoria: o.categoria || null, data: o.data_ordem || null })
          servicosPorPlaca.set(chave, lista)
        }
      }
    } catch (e) { /* sem ordens: a coluna cai no texto da manutenção */ }

    const baixas = (veics || [])
      .filter(v => v.motivo_baixa)
      .map(v => {
        const s = v.substituido_por_id ? porId.get(v.substituido_por_id) : null
        return {
          placa: v.placa, modelo: v.modelo, localidade: v.localidade,
          motivo: v.motivo_baixa, data_baixa: v.data_baixa,
          substituido_por: s ? { placa: s.placa, modelo: s.modelo } : null,
        }
      })
      .sort((a, b) => String(b.data_baixa || '').localeCompare(String(a.data_baixa || '')))

    return { frotaAtiva: (veics || []).filter(veiculoAtivo).length, baixas, servicosPorPlaca }
  } catch (e) {
    return vazio // cadastro indisponível: o painel funciona sem a régua
  }
}

async function situacaoAtual(req, res) {
  try {
    const hoje = new Date().toISOString().split('T')[0]
    // Traz TODAS as manutenções, não só as abertas: a direção pediu também a
    // ÚLTIMA manutenção de cada carro que está parado agora, e ela está no
    // histórico. São poucas centenas de linhas — uma consulta só resolve.
    const { data: todas, error } = await supabase
      .from('manutencoes')
      .select('*')
      .order('data_entrada', { ascending: true })
      .limit(5000)
    if (error) throw error

    const abertas = (todas || []).filter(m => !STATUS_FECHADOS.includes(m.status))

    // Última manutenção ENCERRADA de cada placa — a anterior à atual.
    // "Serviço realizado" sai das observações: o sistema não tem campo próprio
    // para isso (anotado como pendência em 28/09/2026).
    const ultimaPorPlaca = new Map()
    for (const m of (todas || [])) {
      if (m.status !== 'Retornado') continue
      const chave = normPlaca(m.placa)
      const atual = ultimaPorPlaca.get(chave)
      const quando = m.data_saida || m.data_entrada
      if (!atual || String(quando) > String(atual.data_saida || atual.data_entrada)) {
        ultimaPorPlaca.set(chave, m)
      }
    }

    // ⚠️ O cadastro e as ordens são lidos ANTES da lista: `itens` usa os dois
    // (serviço das ordens). Deixar para depois deixava a coluna vazia sem erro.
    const { frotaAtiva, baixas, servicosPorPlaca } = await lerCadastroEServicos()

    const data = abertas
    const itens = (data || []).map(m => {
      const dias_parado = diasEntre(m.data_entrada, null)
      // Atraso só existe quando há previsão. Sem previsão NÃO é 0 (isso viraria
      // "no prazo" na tela): é null, e a coluna mostra "sem previsão".
      const dias_atraso = m.previsao_retorno && m.previsao_retorno < hoje
        ? diasEntre(m.previsao_retorno, null) : (m.previsao_retorno ? 0 : null)
      const ult = ultimaPorPlaca.get(normPlaca(m.placa))
      return {
        ...m,
        dias_parado,
        dias_atraso,
        atrasado: dias_atraso != null && dias_atraso > 0,
        sem_previsao: !m.previsao_retorno,
        alugado_ativo: !!m.veiculo_alugado && !m.veiculo_devolvido,
        // Última passagem pela oficina, para a direção ver o que já foi feito
        // antes de o carro voltar a parar.
        ultima_manutencao: ult ? {
          data_saida: ult.data_saida || null,
          tipo: ult.tipo_manutencao || null,
          oficina: ult.oficina || null,
          num_os: ult.num_os || null,
          // Campo próprio quando existe; cai nas observações no histórico
          // antigo, que foi escrito antes de o campo nascer (28/09/2026).
          servico: ult.servico_realizado || ult.observacoes || null,
          servico_do_campo: !!ult.servico_realizado,
        } : null,
        // Devolução do alugado em ATRASO conta igual ao carro parado: o aluguel
        // segue correndo enquanto ninguém devolve.
        devolucao_atrasada: !!m.veiculo_alugado && !m.veiculo_devolvido &&
          !!m.previsao_devolucao && m.previsao_devolucao < hoje,
        // Serviços das ordens de compra — onde a descrição realmente está.
        ultimos_servicos: servicosPorPlaca.get(normPlaca(m.placa)) || [],
      }
    }).sort((a, b) => b.dias_parado - a.dias_parado) // mais parado primeiro

    // ALUGADOS saem de TODAS as manutenções, não só das abertas.
    // ⚠️ O carro alugado continua com a empresa depois que a manutenção fecha —
    // inclusive quando ela fecha como PERDA TOTAL, que é justamente quando o
    // substituto fica por mais tempo. Contar só as abertas fazia dois alugados
    // sumirem do painel no instante em que o carro virava perda total, e o
    // aluguel seguia correndo sem aparecer para ninguém (28/09/2026).
    const alugados = (todas || [])
      .filter(m => m.veiculo_alugado && !m.veiculo_devolvido)
      .map(m => ({
        placa_parada: m.placa,
        modelo: m.modelo,
        localidade: m.localidade,
        status: m.status,
        placa_alugado: m.placa_alugado || null,
        previsao_devolucao: m.previsao_devolucao || null,
        devolucao_atrasada: !!m.previsao_devolucao && m.previsao_devolucao < hoje,
        perda_total: m.status === 'Perda total',
      }))
      .sort((a, b) => String(a.previsao_devolucao || '9999').localeCompare(String(b.previsao_devolucao || '9999')))

    const soma = (f) => itens.filter(f).length
    const parados = itens.length
    res.json({
      gerado_em: new Date().toISOString(),
      resumo: {
        total: parados,
        // Sinistro é a única categoria que costuma envolver terceiro e seguro —
        // por isso sai destacada, e não só como mais uma linha de "por_status".
        sinistros: soma(i => String(i.tipo_manutencao || '').toUpperCase() === 'SINISTRO'),
        frota_ativa: frotaAtiva,
        // null quando o cadastro não respondeu — a tela mostra "—" em vez de 0%,
        // que seria mentira (0% parado é o oposto de "não sei").
        percentual_parado: (frotaAtiva && frotaAtiva > 0)
          ? Math.round((parados / frotaAtiva) * 100) : null,
        atrasados: soma(i => i.atrasado),
        sem_previsao: soma(i => i.sem_previsao),
        // Conta a lista completa de alugados, não só os das manutenções abertas.
        alugados_ativos: alugados.length,
        alugados_em_perda_total: alugados.filter(a => a.perda_total).length,
        // Alugado sem placa registrada: a direção quer saber QUAL carro está
        // substituindo, e essa contagem mostra quanto ainda falta preencher.
        alugados_sem_placa: alugados.filter(a => !a.placa_alugado).length,
        devolucoes_atrasadas: alugados.filter(a => a.devolucao_atrasada).length,
        // Seguro é marcação à parte (decisão da Luciana): corre em paralelo e
        // pode continuar depois de o carro voltar da oficina.
        em_seguro: (todas || []).filter(m => m.em_seguro).length,
        em_seguro_abertos: soma(i => !!i.em_seguro),
        parados_mais_30: soma(i => i.dias_parado > 30),
        media_dias: itens.length
          ? Math.round(itens.reduce((s, i) => s + i.dias_parado, 0) / itens.length) : 0,
        por_status: itens.reduce((acc, i) => {
          const k = i.status || '—'; acc[k] = (acc[k] || 0) + 1; return acc
        }, {}),
        // Saíram da frota — contagem acumulada, não do mês.
        perda_total: baixas.filter(b => b.motivo === 'Perda total').length,
        vendidos:    baixas.filter(b => b.motivo === 'Vendido').length,
        devolvidos:  baixas.filter(b => b.motivo === 'Devolvido').length,
      },
      itens,
      // Lista separada: são veículos que JÁ SAÍRAM, não carros parados. Misturar
      // com `itens` faria o "% da frota parada" contar carro que não existe mais.
      baixas,
      alugados,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Dashboard: rankings ───────────────────────────────────────────────────────
async function rankingsDash(req, res) {
  try {
    const { tipo = 'localidade', limit = 10 } = req.query

    const { data, error } = await supabase
      .from('manutencoes')
      .select('placa, localidade, supervisor, tipo_manutencao, status, data_entrada')

    if (error) throw error

    const map = new Map()
    for (const m of (data || [])) {
      let label
      if (tipo === 'localidade')     label = m.localidade
      else if (tipo === 'supervisor') label = m.supervisor
      else if (tipo === 'tipo')       label = m.tipo_manutencao
      else if (tipo === 'status')     label = m.status
      else if (tipo === 'placa')      label = m.placa
      if (!label) continue
      map.set(label, (map.get(label) || 0) + 1)
    }

    const ranking = [...map.entries()]
      .map(([label, qtd]) => ({ label, qtd }))
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, parseInt(limit) || 10)

    res.json(ranking)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Dashboard: série temporal de entradas ─────────────────────────────────────
async function serieDash(req, res) {
  try {
    const { granularidade = 'mes', data_inicio, data_fim } = req.query

    let query = supabase.from('manutencoes').select('data_entrada, status, tipo_manutencao')
    if (data_inicio) query = query.gte('data_entrada', data_inicio)
    if (data_fim)    query = query.lte('data_entrada', data_fim)

    const { data, error } = await query
    if (error) throw error

    const fmtChave = (dataIso) => {
      if (!dataIso) return null
      const s = String(dataIso).substring(0, 10)
      if (granularidade === 'dia')  return s
      if (granularidade === 'mes')  return s.substring(0, 7)
      if (granularidade === 'ano')  return s.substring(0, 4)
      return s.substring(0, 7)
    }

    const map = new Map()
    for (const m of (data || [])) {
      const k = fmtChave(m.data_entrada)
      if (!k) continue
      const cur = map.get(k) || { total: 0, corretiva: 0, preventiva: 0, outros: 0 }
      cur.total++
      const t = (m.tipo_manutencao || '').toLowerCase()
      if (t === 'corretiva')   cur.corretiva++
      else if (t === 'preventiva' || t === 'revisão') cur.preventiva++
      else cur.outros++
      map.set(k, cur)
    }

    const serie = [...map.entries()]
      .map(([periodo, v]) => ({ periodo, ...v }))
      .sort((a, b) => a.periodo.localeCompare(b.periodo))

    res.json(serie)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Importar Excel de manutenções ────────────────────────────────────────────
function normalizarChave(str) {
  return str
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^\w\s]/g, '')   // remove pontuação
    .replace(/\s+/g, '_')
}

function normalizeStatus(raw) {
  if (!raw) return 'Em Andamento'
  const s = raw.toString().replace(/[^\w\sÀ-ÿ]/gu, '').trim().toLowerCase()
  if (s.includes('retorn')) return 'Retornado'
  if (s.includes('cancel')) return 'Cancelado'
  // "perda total", "perda", "PT" — como a planilha costuma vir escrita.
  if (s.includes('perda') || s === 'pt') return 'Perda total'
  return 'Em Andamento'
}

function parseBool(val) {
  if (!val) return false
  return /^s(im)?$/i.test(String(val).trim())
}

async function importarManutencao(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' })

    const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true })
    const ws   = wb.Sheets[wb.SheetNames[0]]

    // Detectar linha de cabeçalho: pular linhas de título mescladas
    // Força leitura a partir da primeira linha que contém "placa" (case-insensitive)
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:Z100')
    let headerRow = range.s.r
    for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })]
      if (cell && /placa/i.test(String(cell.v || ''))) { headerRow = r; break }
    }

    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRow })

    if (!rows.length) return res.status(400).json({ error: 'Arquivo vazio ou sem dados.' })

    const normalizado = rows.map(row => {
      const obj = {}
      for (const k of Object.keys(row)) obj[normalizarChave(k)] = row[k]
      return obj
    })

    const erros    = []
    const inseridos = []

    for (let i = 0; i < normalizado.length; i++) {
      const r   = normalizado[i]
      const lin = headerRow + i + 2

      // Pular linhas totalmente vazias
      if (!r.placa && !r.data_entrada_na_oficina) continue

      if (!r.placa) {
        erros.push({ linha: lin, erro: 'Campo obrigatório faltando: placa' })
        continue
      }
      // Linha com placa fora do padrão é RECUSADA, não corrigida por conta
      // própria: a planilha vira manutenção E veículo novo no cadastro, e um
      // palpite errado aqui cria carro fantasma. A linha entra no relatório de
      // erros com a placa escrita, para a pessoa achar e corrigir no arquivo.
      if (!placaValida(r.placa)) {
        erros.push({ linha: lin, erro: erroPlacaCom(r.placa) })
        continue
      }

      // Mapear colunas do Excel para o schema
      const dataEntrada = parseData(r.data_entrada_na_oficina || r.data_entrada)
      if (!dataEntrada) {
        erros.push({ linha: lin, erro: `Placa ${r.placa}: data de entrada inválida ou ausente` })
        continue
      }

      // Tipo: normalizar emojis e variações
      let tipo = (r.tipo_de_manutencao || r.tipo_manutencao || 'Corretiva').toString().trim()
      const tiposValidos = ['Corretiva','Preventiva','Revisão','Sinistro','Outro']
      if (!tiposValidos.includes(tipo)) tipo = 'Corretiva'

      const payload = {
        placa:             normPlaca(r.placa),
        modelo:            caixaAlta(r.modelo),
        localidade:        caixaAlta(r.localidade),
        supervisor:        caixaAlta(r.supervisor),
        data_entrada:      dataEntrada,
        data_saida:        parseData(r.data_saida_da_oficina || r.data_saida),
        previsao_retorno:  parseData(r.previsao_de_retorno || r.previsao_retorno),
        dias_previstos:    r.dias_previstos_na_oficina ? parseInt(r.dias_previstos_na_oficina) : null,
        tipo_manutencao:   tipo,
        veiculo_alugado:   parseBool(r.veiculo_alugado),
        veiculo_devolvido: parseBool(r.veiculo_devolvido),
        data_devolucao:    parseData(r.data_devolucao_veic_alugado || r.data_devolucao),
        num_os:            r.no_os_sinistro || r.num_os || r.no_os ? String(r.no_os_sinistro || r.num_os || r.no_os).trim() : null,
        status:            normalizeStatus(r.status),
        observacoes:       r.observacoes ? r.observacoes.toString().trim() : null,
        convertido_ordem:  false
      }

      try {
        const { data, error } = await supabase
          .from('manutencoes')
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        inseridos.push(data)
      } catch (err) {
        erros.push({ linha: lin, erro: `Placa ${payload.placa}: ${err.message}` })
      }
    }

    res.json({
      total_linhas: normalizado.filter(r => r.placa || r.data_entrada_na_oficina).length,
      importados:   inseridos.length,
      erros_count:  erros.length,
      erros,
      data:         inseridos
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// ── Anexos: Supabase Storage ──────────────────────────────────────────────────
const ANEXO_BUCKET = process.env.SUPABASE_BUCKET_ANEXOS || 'manutencao-anexos'
let bucketReady = false

async function ensureBucket() {
  if (bucketReady) return
  try {
    const { data } = await supabase.storage.getBucket(ANEXO_BUCKET)
    if (!data) {
      await supabase.storage.createBucket(ANEXO_BUCKET, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']
      })
    }
    bucketReady = true
  } catch (e) {
    // se já existe ou erro de leitura, tenta criar mesmo assim
    try {
      await supabase.storage.createBucket(ANEXO_BUCKET, { public: true })
    } catch (_) {}
    bucketReady = true
  }
}

async function uploadAnexo(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' })
    const ok = req.file.mimetype === 'application/pdf' || req.file.mimetype.startsWith('image/')
    if (!ok) return res.status(400).json({ error: 'Apenas PDF ou imagem.' })

    await ensureBucket()
    const safeName = req.file.originalname.replace(/[^\w.\-]+/g, '_')
    const path = `anexos/${Date.now()}_${Math.random().toString(36).slice(2,8)}_${safeName}`

    const { error } = await supabase.storage
      .from(ANEXO_BUCKET)
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      })
    if (error) throw error

    const { data: pub } = supabase.storage.from(ANEXO_BUCKET).getPublicUrl(path)

    res.status(201).json({
      path,
      url: pub.publicUrl,
      arquivo_nome: req.file.originalname,
      mime: req.file.mimetype,
      tamanho: req.file.size
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

async function excluirAnexo(req, res) {
  try {
    const { path } = req.body
    if (!path) return res.status(400).json({ error: 'path é obrigatório.' })
    const { error } = await supabase.storage.from(ANEXO_BUCKET).remove([path])
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = {
  listar, buscarPorId, criar, atualizar, excluir,
  converterEmOrdem, importarManutencao,
  resumoDash, rankingsDash, serieDash, situacaoAtual,
  uploadAnexo, excluirAnexo
}
