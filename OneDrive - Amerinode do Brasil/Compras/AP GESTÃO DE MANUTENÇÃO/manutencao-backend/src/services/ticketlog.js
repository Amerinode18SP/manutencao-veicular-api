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

const HOST          = 'https://legacy-soulog.ticketlog.com.br'
const URL_RELATORIO = 'https://legacy-soulog.ticketlog.com.br/GoodManagerSSL/Fuel/FuelRelUltimasKmLista.cfm?RequestTimeOut=360'
const URL_FORM      = 'https://legacy-soulog.ticketlog.com.br/GoodManagerSSL/Fuel/FuelRelUltimasKmForm.cfm'
const URL_LOGIN     = 'https://legacy-soulog.ticketlog.com.br/autenticacao/?urlretorno=/goodmanagerssl/index.cfm&skin=goodmanagerssl'
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

// ── Cookies ──────────────────────────────────────────────────────────────────
// O portal REEMITE CFID/CFTOKEN nas respostas (Max-Age=7200). Antes a gente
// descartava esses Set-Cookie e seguia mandando o valor antigo — a sessão morria
// "sozinha" em poucas horas. Agora todo Set-Cookie é mesclado no cookie guardado.
function lerSetCookie(resp) {
  if (typeof resp.headers.getSetCookie === 'function') return resp.headers.getSetCookie()
  const bruto = resp.headers.get('set-cookie')
  return bruto ? [bruto] : []
}

// "a=1; b=2" → Map { a=>1, b=>2 }
function paraMapa(cookie) {
  const mapa = new Map()
  for (const par of String(cookie || '').split(';')) {
    const i = par.indexOf('=')
    if (i <= 0) continue
    const nome = par.slice(0, i).trim()
    if (nome) mapa.set(nome, par.slice(i + 1).trim())
  }
  return mapa
}

// Mescla os Set-Cookie da resposta no cookie atual. Devolve a string nova, ou a
// original quando nada mudou (assim o chamador só grava no banco se precisar).
function mesclarCookies(cookieAtual, resp) {
  const novos = lerSetCookie(resp)
  if (!novos.length) return { cookie: cookieAtual, mudou: false }

  const mapa = paraMapa(cookieAtual)
  let mudou = false
  for (const linha of novos) {
    const [par] = String(linha).split(';')
    const i = par.indexOf('=')
    if (i <= 0) continue
    const nome  = par.slice(0, i).trim()
    const valor = par.slice(i + 1).trim()
    if (!nome || !valor || valor === 'deleted') continue
    if (mapa.get(nome) !== valor) { mapa.set(nome, valor); mudou = true }
  }
  if (!mudou) return { cookie: cookieAtual, mudou: false }
  return { cookie: [...mapa].map(([k, v]) => `${k}=${v}`).join('; '), mudou: true }
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

  // Cookie rotacionado pelo portal → devolve pro chamador regravar.
  const { cookie: atualizado, mudou } = mesclarCookies(cookie, resp)
  return { estado, status: resp.status, cookie: atualizado, cookieMudou: mudou }
}

// ── Login automático no portal legado ────────────────────────────────────────
// Descoberta jul/2026: `legacy-soulog.ticketlog.com.br/autenticacao/` tem login
// PRÓPRIO do SouLog — três campos (codigo, usuario, senha), sem MFA e sem captcha.
// O SSO Edenred é só a alternativa ("ou conectar com Conta Edenred"). Com isso o
// servidor renova a sessão sozinho e ninguém precisa colar cURL de novo.
//
// Fluxo: GET da tela (pega cookies iniciais + <meta name="csrf-token">) → POST com
// as credenciais + token (campo _csrf_token e header X-CSRF-Token) → segue os
// redirects mesclando cookies → confirma com pingSessao.
//
// `forceLogin` é um campo escondido do próprio formulário: assume a sessão quando
// o usuário já está conectado em outro lugar (é o que fazia a sessão do robô morrer
// quando alguém logava no portal).

function credenciaisPortal() {
  const codigo  = (process.env.TICKETLOG_CODIGO  || '').trim()
  const usuario = (process.env.TICKETLOG_USUARIO || '').trim()
  const senha   = (process.env.TICKETLOG_SENHA   || '').trim()
  if (!codigo || !usuario || !senha) return null
  return { codigo, usuario, senha }
}

function extrairCsrf(html) {
  const m = /<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i.exec(html || '')
  return m ? m[1] : ''
}

// Portal pede confirmação quando já existe sessão ativa do mesmo usuário.
const pedeForce = html => /j[áa]\s*(est[áa]\s*)?conectad|sess[ãa]o\s*(j[áa]\s*)?ativa/i.test(html || '')
const pareceLogado = html => !/name=["']senha["']/i.test(html || '')

// Extrai a mensagem que o portal mostrou (ex.: "Usuário ou senha inválidos").
// Sem isto o erro chega como um genérico e não dá pra saber o que corrigir.
// Só texto visível, cortado — nunca ecoa o que foi enviado.
function mensagemDoPortal(html) {
  if (!html) return ''

  // O portal manda o erro num alert() dentro de <script> — é ali que está a
  // mensagem útil ("Senha ou usuário inválido", "Usuário bloqueado", ...).
  // Precisa vir ANTES de remover os scripts, senão se perde.
  const m = /alert\(\s*(['"])([\s\S]*?)\1\s*\)/i.exec(String(html))
  if (m) {
    return m[2]
      .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\n/g, ' ')
      .replace(/\\'/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
  }

  const texto = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é').replace(/&oacute;/gi, 'ó')
    .replace(/&ccedil;/gi, 'ç').replace(/&atilde;/gi, 'ã').replace(/&otilde;/gi, 'õ')
    .replace(/\s+/g, ' ')
    .trim()

  // procura frases típicas de erro de autenticação
  const alvo = /([^.]{0,120}(inv[áa]lid|incorret|n[ãa]o (foi|est[áa]|encontrad)|bloquead|expirad|senha|usu[áa]rio|c[óo]digo|tentativ)[^.]{0,120})/i.exec(texto)
  const trecho = alvo ? alvo[1] : texto.slice(0, 200)
  return trecho.trim().slice(0, 240)
}

async function loginPortal(opts = {}) {
  const cred = opts.credenciais || credenciaisPortal()
  if (!cred) { const e = new Error('credenciais_ausentes'); e.status = 412; throw e }

  const base = { 'user-agent': UA, 'accept-language': 'pt-BR,pt;q=0.9' }

  // 1) tela de login: cookies iniciais + token CSRF
  let resp
  try {
    resp = await fetch(URL_LOGIN, { headers: base, redirect: 'manual' })
  } catch (e) {
    const err = new Error('falha_rede: ' + e.message); err.status = 502; throw err
  }
  let cookie = mesclarCookies('', resp).cookie
  const html = await resp.text()
  const csrf = extrairCsrf(html)

  // 2) POST das credenciais (com retry forçando a tomada da sessão)
  const tentar = async forcar => {
    const body = new URLSearchParams({
      codigo: cred.codigo,
      usuario: cred.usuario,
      senha: cred.senha,
      // OBRIGATÓRIO: o jquery-comum.js da própria tela faz $('#acao').val('login')
      // antes de enviar, e o form bloqueia o submit se 'acao' estiver vazio. Com o
      // campo vazio o portal apenas redesenha a tela de login, sem erro nenhum —
      // foi o que nos enganou na primeira tentativa.
      acao: 'login',
      forceLogin: forcar ? 'true' : '',
      // O navegador envia o campo do botão de submit; o ColdFusion costuma testar
      // a presença dele para saber que é um envio de login de verdade.
      'aem-login': 'ENTRAR'
    })
    if (csrf) body.set('_csrf_token', csrf)

    let r
    try {
      r = await fetch(URL_LOGIN, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          ...base,
          'content-type': 'application/x-www-form-urlencoded',
          'origin': HOST,
          'referer': URL_LOGIN,
          'cookie': cookie,
          ...(csrf ? { 'x-csrf-token': csrf } : {})
        },
        body: body.toString()
      })
    } catch (e) {
      const err = new Error('falha_rede: ' + e.message); err.status = 502; throw err
    }
    cookie = mesclarCookies(cookie, r).cookie

    // 3) segue os redirects (a sessão costuma se firmar no destino)
    let saltos = 0
    while (r.status >= 300 && r.status < 400 && saltos < 4) {
      const destino = new URL(r.headers.get('location'), HOST).toString()
      r = await fetch(destino, { headers: { ...base, cookie, referer: URL_LOGIN }, redirect: 'manual' })
      cookie = mesclarCookies(cookie, r).cookie
      saltos++
    }
    return r
  }

  let r = await tentar(false)
  let corpo = r.status < 300 ? await r.text() : ''
  if (pedeForce(corpo) && !pareceLogado(corpo)) {
    r = await tentar(true)                       // usuário já conectado → assume a sessão
    corpo = r.status < 300 ? await r.text() : ''
  }

  // 4) confirma de fato: a sessão abre o formulário do relatório?
  const { estado } = await pingSessao({ cookie })
  if (estado !== 'viva') {
    const e = new Error('login_recusado')
    e.status = 401
    e.detalhe = pareceLogado(corpo) ? 'sessão não firmou no portal' : 'credenciais ou código do usuário recusados'
    e.mensagem_portal = mensagemDoPortal(corpo)   // o que o portal escreveu na tela
    e.http_login = r.status
    throw e
  }
  return { cookie }
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
  // Anexa o cookie rotacionado no Buffer (compatível com quem só usa o retorno).
  const { cookie: atualizado, mudou } = mesclarCookies(cookie, resp)
  buf.cookieAtualizado = mudou ? atualizado : null
  return buf
}

module.exports = {
  baixarRelatorioKm, pingSessao, extrairCookie, ddmmyyyy,
  loginPortal, credenciaisPortal, mesclarCookies
}
