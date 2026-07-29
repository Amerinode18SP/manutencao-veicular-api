// services/ticketlog.js — baixa o relatório "Últimas Quilometragens/Horas" do
// portal LEGADO da TicketLog (ColdFusion) reproduzindo, server-side, a mesma
// requisição que o navegador dispara. Descoberto no passo B0 (ver CLAUDE.md):
//
//   POST https://legacy-soulog.ticketlog.com.br/GoodManagerSSL/Fuel/FuelRelUltimasKmLista.cfm?RequestTimeOut=360
//   content-type: application/x-www-form-urlencoded
//   auth: SÓ cookie de sessão (sem Bearer, sem CSRF, passo único)
//
// A sessão NÃO é IP-bound (testado de IP externo → 200 + dados), então dá pra
// rodar do Railway. O cookie expira com o tempo; quando isso acontece o portal
// devolve login/redirect em vez do relatório → detectamos e sinalizamos 401.

const URL_RELATORIO = 'https://legacy-soulog.ticketlog.com.br/GoodManagerSSL/Fuel/FuelRelUltimasKmLista.cfm?RequestTimeOut=360'
const URL_FORM      = 'https://legacy-soulog.ticketlog.com.br/GoodManagerSSL/Fuel/FuelRelUltimasKmForm.cfm'
const UA            = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'

// Parâmetros estáticos do cliente AMERINODE (cd_tipo_frota é o "Tipo Frota" fixo).
// Sobrescrevíveis por env se a conta mudar, sem novo deploy de código.
const CD_TIPO_FROTA = process.env.TICKETLOG_CD_TIPO_FROTA || '182386'
const CD_SITUACAO   = process.env.TICKETLOG_CD_SITUACAO   || 'A' // "Liberados para compra"

// Date -> "dd/mm/yyyy"
function ddmmyyyy(d) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

// Aceita o cookie "puro" (nome=val; nome2=val2) OU um comando cURL colado inteiro
// (Copy as cURL) e extrai só o cookie. Facilita a reautenticação pelo admin.
function extrairCookie(valor) {
  const v = String(valor || '').trim()
  if (!v) return ''
  // -b '...' ou --cookie '...'  (aspas simples ou duplas)
  let m = v.match(/(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/)
  if (m) return m[2].trim()
  // -H 'cookie: ...'
  m = v.match(/-H\s+(['"])cookie:\s*([\s\S]*?)\1/i)
  if (m) return m[2].trim()
  // já é uma string de cookie (tem = e ;), ou um único par nome=valor
  if (/=/.test(v)) return v.replace(/^cookie:\s*/i, '').trim()
  return ''
}

// Heurística: o corpo é mesmo o relatório? (vs página de login/redirect do SSO)
function pareceRelatorio(text) {
  return /Linha(?:Impar|Par)/.test(text) ||
         /Quilometragens\s*\/?\s*Horas/i.test(text) ||
         /class=["']gm_rel["']/i.test(text)
}

// "Toca" a sessão do portal sem baixar o relatório inteiro — o keep-alive chama
// isto de tempos em tempos pra impedir que o sistema legado derrube a sessão por
// INATIVIDADE (o navegador sobrevive ~90 dias porque é usado; o sync sozinho só
// repetia o cookie 1x/dia e a sessão caducava). Faz um GET leve no formulário e
// classifica pelo status (o portal responde 302 pro SSO quando a sessão morreu):
//   2xx         → { estado: 'viva' }
//   3xx/401/403 → { estado: 'expirada' }   (sinal claro de sessão morta)
//   demais/5xx  → { estado: 'erro' }        (erro transitório do portal, NÃO expiração)
// Só 'expirada' deve disparar o alerta — assim um 500 do portal não vira falso alarme.
// Lança Error .status=401 se não há cookie; .status=502 em falha de rede.
async function pingSessao(opts = {}) {
  const cookie = extrairCookie(opts.cookie)
  if (!cookie) { const e = new Error('sessao_ausente'); e.status = 401; throw e }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30000) // não deixa o ping pendurar
  let resp
  try {
    resp = await fetch(URL_FORM, {
      method:   'GET',
      redirect: 'manual', // sessão morta → 302 pro SSO; não seguir, tratar como morta
      signal:   ctrl.signal,
      headers: {
        'user-agent': UA,
        'referer':    URL_FORM,
        'cookie':     cookie
      }
    })
  } catch (e) {
    const err = new Error('falha_rede: ' + e.message); err.status = 502; throw err
  } finally {
    clearTimeout(timer)
  }

  let estado = 'erro'
  if (resp.status === 401 || resp.status === 403 || (resp.status >= 300 && resp.status < 400)) estado = 'expirada'
  else if (resp.ok) estado = 'viva'
  return { estado, status: resp.status }
}

// Baixa o relatório e devolve um Buffer (latin1) pronto pro parseRelatorio.
// opts: { inicio?: Date, fim?: Date, dias?: number, cookie: string }
// Lança Error com .status=401 quando a sessão está ausente/expirada.
async function baixarRelatorioKm(opts = {}) {
  const cookie = extrairCookie(opts.cookie)
  if (!cookie) { const e = new Error('sessao_ausente'); e.status = 401; throw e }

  // O portal devolve o relatório VAZIO quando o intervalo passa de ~1 mês.
  // Travamos a janela em 30 dias — suficiente pra pegar as leituras recentes.
  const fim    = opts.fim || new Date()
  const janela = Math.min(opts.dias || 30, 30)
  const inicio = opts.inicio || new Date(fim.getTime() - janela * 86400000)

  const body = new URLSearchParams({
    fl_cartao_veic:     'true',
    dt_ini:             ddmmyyyy(inicio),
    dt_fim:             ddmmyyyy(fim),
    consideraPeriodo:   'S',
    nr_cartao:          '',
    ds_placa:           '',
    nr_frota:           '',
    ds_responsavel:     '',
    cd_responsavel:     '',
    cd_tipo_frota:      CD_TIPO_FROTA,
    cd_familia_veiculo: '',
    cd_veiculo_modelo:  '',
    cd_situacao:        CD_SITUACAO,
    visual:             'E' // E = Excel-HTML (o mesmo que o parseRelatorio já lê)
  }).toString()

  let resp
  try {
    resp = await fetch(URL_RELATORIO, {
      method:   'POST',
      redirect: 'manual', // sessão morta → 302 pro SSO; não seguir, tratar como expirado
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent':   UA,
        'referer':      URL_FORM,
        'origin':       'https://legacy-soulog.ticketlog.com.br',
        'cookie':       cookie
      },
      body
    })
  } catch (e) {
    const err = new Error('falha_rede: ' + e.message); err.status = 502; throw err
  }

  // 3xx (redirect pro login) ou 401/403 → sessão expirada
  if (resp.status === 401 || resp.status === 403 || (resp.status >= 300 && resp.status < 400)) {
    const e = new Error('sessao_expirada'); e.status = 401; throw e
  }
  if (!resp.ok) {
    const e = new Error('http_' + resp.status); e.status = resp.status; throw e
  }

  const buf  = Buffer.from(await resp.arrayBuffer())
  const text = buf.toString('latin1')
  if (!pareceRelatorio(text)) {
    // 200 mas conteúdo não é o relatório (provável tela de login/erro de sessão)
    const e = new Error('sessao_expirada'); e.status = 401; throw e
  }
  return buf
}

module.exports = { baixarRelatorioKm, pingSessao, extrairCookie, ddmmyyyy }
