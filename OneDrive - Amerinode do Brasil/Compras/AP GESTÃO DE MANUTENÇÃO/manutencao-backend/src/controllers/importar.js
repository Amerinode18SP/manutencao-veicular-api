const XLSX     = require('xlsx')
const supabase = require('../supabase')

// Normaliza nomes de colunas: remove acentos, espaços → underscore, lowercase
function normalizarChave(str) {
  return str
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/\s+/g, '_')
}

// Converte data em qualquer formato → YYYY-MM-DD
function parseData(valor) {
  if (!valor) return null
  const s = String(valor).trim()
  if (!s) return null
  // YYYY-MM-DD (já correto)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // YYYY-MM-DD HH:mm:ss (Excel datetime)
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) return s.split(' ')[0]
  // YYYY-MM-DDTHH:mm (ISO)
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.split('T')[0]
  // DD/MM/YYYY
  const partes = s.split('/')
  if (partes.length === 3) {
    const [d, m, a] = partes
    if (a && a.length === 4) return `${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  // MM/DD/YYYY (formato americano)
  const partesUS = s.split('/')
  if (partesUS.length === 3 && partesUS[2].length === 4) {
    const [m, d, a] = partesUS
    return `${a}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  return null
}

function parseMoeda(valor) {
  if (!valor && valor !== 0) return 0
  return parseFloat(String(valor).replace(/[^\d,.-]/g, '').replace(',', '.')) || 0
}

async function importar(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' })

    const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: false })
    const ws   = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

    if (!rows.length) return res.status(400).json({ error: 'Arquivo vazio ou sem dados.' })

    // Normaliza chaves de todas as linhas
    const normalizado = rows.map(row => {
      const obj = {}
      for (const k of Object.keys(row)) obj[normalizarChave(k)] = row[k]
      return obj
    })

    const erros    = []
    const inseridos = []

    for (let i = 0; i < normalizado.length; i++) {
      const r   = normalizado[i]
      const lin = i + 2 // linha real no Excel (cabeçalho = 1)

      // Campos obrigatórios
      const obrigatorios = ['placa','localidade','supervisor','nota_fiscal','categoria','item','fornecedor','cnpj']
      const faltando = obrigatorios.filter(c => !r[c])
      if (faltando.length) {
        erros.push({ linha: lin, erro: `Campos obrigatórios faltando: ${faltando.join(', ')}` })
        continue
      }

      // Categoria válida
      if (!['Serviço','Servico','Produto'].includes(r.categoria)) {
        erros.push({ linha: lin, erro: `Categoria inválida: "${r.categoria}". Use "Serviço" ou "Produto"` })
        continue
      }

      try {
        // Helper: tenta operação; se erro indicar coluna faltante, refaz sem ela
        async function tentarSemColunaFaltante(payload, fn) {
          let r = await fn(payload)
          if (r.error && /Could not find the '([^']+)' column/.test(r.error.message)) {
            const col = r.error.message.match(/Could not find the '([^']+)' column/)[1]
            const novo = { ...payload }
            delete novo[col]
            r = await fn(novo)
          }
          return r
        }

        // Upsert veículo
        const veiculoPayload = {
          placa:            r.placa.toString().toUpperCase().trim(),
          localidade:       r.localidade.toString().trim(),
          km_atual:         r.km_atual ? parseInt(r.km_atual) : null,
          proxima_revisao:  parseData(r.proxima_revisao)
        }
        const obsVeic = r.observacao_veiculo || r.obs_veiculo
        if (obsVeic) veiculoPayload.observacao = obsVeic.toString().trim()
        const { data: v, error: ve } = await tentarSemColunaFaltante(veiculoPayload, p =>
          supabase.from('veiculos').upsert(p, { onConflict: 'placa' }).select().single()
        )
        if (ve) throw ve

        // Data de revisão da planilha também entra na agenda (fonte do alerta).
        if (veiculoPayload.proxima_revisao) {
          const { garantirRevisaoDaData } = require('./revisoesProgramadas')
          await garantirRevisaoDaData(v.id, v.placa, veiculoPayload.proxima_revisao)
        }

        // Upsert fornecedor
        const cnpjLimpo = r.cnpj.toString().replace(/\D/g, '')
        const fornecedorPayload = { razao_social: r.fornecedor.toString().trim(), cnpj: cnpjLimpo }
        const obsForn = r.observacao_fornecedor || r.obs_fornecedor
        if (obsForn) fornecedorPayload.observacao = obsForn.toString().trim()
        const { data: f, error: fe } = await tentarSemColunaFaltante(fornecedorPayload, p =>
          supabase.from('fornecedores').upsert(p, { onConflict: 'cnpj' }).select().single()
        )
        if (fe) throw fe

        // Inserir ordem
        const vi = parseMoeda(r.valor_item)
        const qt = parseInt(r.quantidade) || 1

        const ordemPayload = {
          veiculo_id:    v.id,
          fornecedor_id: f.id,
          supervisor:    r.supervisor.toString().trim(),
          num_ordem:     r.num_ordem  ? r.num_ordem.toString().trim()  : null,
          link_ordem:    r.link_ordem ? r.link_ordem.toString().trim() : null,
          nota_fiscal:   r.nota_fiscal.toString().trim(),
          data_ordem:    parseData(r.data_ordem) || new Date().toISOString().split('T')[0],
          categoria:     r.categoria === 'Servico' ? 'Serviço' : r.categoria,
          item:          r.item.toString().trim(),
          valor_item:    vi,
          quantidade:    qt,
          valor_total:   vi * qt,
          observacao:    r.observacao ? r.observacao.toString().trim() : null,
          status:        'Pendente',
          origem:        'Excel'
        }
        const { data: o, error: oe } = await tentarSemColunaFaltante(ordemPayload, p =>
          supabase.from('ordens').insert(p).select().single()
        )
        if (oe) throw oe

        inseridos.push(o)
      } catch (err) {
        erros.push({ linha: lin, erro: err.message })
      }
    }

    res.json({
      total_linhas:   normalizado.length,
      importados:     inseridos.length,
      erros_count:    erros.length,
      erros,
      data:           inseridos
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

module.exports = { importar }
