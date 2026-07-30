# Sistema de Gestão de Manutenção Veicular — Amerinode

> Contexto para continuidade entre sessões/chats do Claude.
> Atualize este arquivo conforme o projeto evolui.

## 🎯 O que é

App web da Amerinode para gerenciar manutenção de frota veicular.
Controla ordens de compra (OC) de peças/serviços, fornecedores, veículos,
revisões preventivas, importação via Excel, dashboard analítico,
relatórios financeiros e tabela de vida útil de componentes.

**Usado por:** equipe administrativa da Amerinode (Ana Paula e outros supervisores)
**Repositório:** https://github.com/Amerinode18SP/manutencao-veicular-api
**Produção:** https://manutencao-veicular-api-production.up.railway.app/
**Deploy:** Railway (auto-deploy em push para `main`)

## 🧰 Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express, deployed no Railway |
| Banco | Supabase (Postgres) |
| Auth | Supabase Auth (e-mail + senha + recuperação) |
| Frontend | Single-page HTML (`public/index.html`) com vanilla JS + Chart.js + SheetJS + jsPDF |
| Deploy | Railway (CI por push) |

⚠️ **Importante:** o frontend é UM ÚNICO arquivo `public/index.html` (>4000 linhas).
Tudo (HTML, CSS inline, JS inline) vive ali. Não há bundler. Edição via Edit tool.

## 📁 Estrutura

```
manutencao-backend/
├── public/
│   ├── index.html      ← TODO o frontend (SPA)
│   └── logo.svg
├── src/
│   ├── server.js       ← Express setup, rotas, CORS, migrate boot
│   ├── supabase.js     ← cliente Supabase (service role key)
│   ├── migrate.js      ← migrations automáticas (requer DATABASE_URL + dep 'pg', hoje inativa)
│   ├── controllers/
│   │   ├── ordens.js
│   │   ├── manutencao.js
│   │   ├── importar.js
│   │   ├── outros.js   ← veiculos, fornecedores, dashboard (resumo/rankings/serie)
│   │   └── vidaUtil.js
│   └── routes/         ← (cada arquivo monta um router Express)
├── scripts/
│   └── schema.sql      ← schema completo para reset manual
└── package.json
```

## 🗄️ Modelo de dados (Supabase)

- **veiculos** — placa (UNIQUE), localidade, km_atual, km_atualizado_em (data da leitura, via import TicketLog), proxima_revisao, observacao
- **fornecedores** — razao_social, cnpj (UNIQUE), observacao
- **ordens** — veiculo_id, fornecedor_id, supervisor, num_ordem, link_ordem, nota_fiscal,
  data_ordem, categoria (Serviço/Produto), item, valor_item, quantidade, valor_total,
  status (Pendente/Em Preparação/Concluído/Cancelado), origem (Manual/Excel/Cotabox), cotabox_id, observacao
- **manutencoes** — controle de veículos parados (em andamento, orçamento, aprovado, retornado, cancelado),
  com anexos JSONB e campo oficina
- **profiles** — perfis dos usuários (nome, perfil=administrador|visualizador)
- **vida_util** — tabela editável de vida útil dos componentes
  (item, vida_util, tipo, observacao, ordem) — criada via SQL manual no Supabase

## 🌐 Endpoints REST principais

| Rota | Métodos | Observação |
|---|---|---|
| `/api/ordens` | GET (paginado), POST, PUT, DELETE | edição propaga campos compartilhados por `num_ordem` |
| `/api/veiculos` | GET, PUT | UNIQUE por placa |
| `/api/fornecedores` | GET | UNIQUE por CNPJ |
| `/api/dashboard/resumo` | GET | KPIs, suporta `?placa=` e `?periodo=` |
| `/api/dashboard/rankings` | GET | `?tipo=placa\|localidade\|item\|fornecedor\|status\|categoria` |
| `/api/dashboard/serie` | GET | série temporal de gastos |
| `/api/manutencao/*` | CRUD | controle de veículos parados |
| `/api/manutencao/:id/converter` | POST | converte registro de manutenção em N ordens de compra |
| `/api/vida-util` | GET, POST, PUT, DELETE | edição inline; `/substituir` substitui tudo (usado em import XLSX) |
| `/api/importar` | POST | import em lote via Excel |

## 🧑‍💼 Perfis

- **administrador** — vê tudo, pode cadastrar/editar/excluir, pode importar
- **visualizador** — somente leitura

Verificação client-side via `currentPerfil === 'administrador'` (mas validação real fica no Supabase).

## ✅ Features implementadas nesta sessão (cronológico)

1. **Página "💰 Análise de Gastos"** (Dashboard analítico financeiro)
   - KPIs anuais (gasto total, ordens, placas ativas, ticket médio)
   - Pivot Placa × Mês com heatmap por intensidade
   - Top 15 itens e Top 15 placas com barras
   - Detalhamento por placa ao clicar
   - Gráfico mensal empilhado Serviço/Produto
   - Filtros: ano (incluindo "Todos os anos") + placa + categoria
   - Export XLSX (3 abas) e PDF (paisagem)
   - Seletor de ordenação na pivot (Maior gasto / Placa A→Z / Z→A / Mais ordens)

2. **Dashboard XLSX/PDF** mostra placa filtrada no cabeçalho e no nome do arquivo

3. **Lista de Ordens (📋)**:
   - Carregamento paginado (lotes de 1000, até 30k registros)
   - Filtro "Ordenar por": recentes / nº maior→menor / nº menor→maior / valor / data

4. **Cadastro de OC (➕)** com multi-itens:
   - Botão "+ Adicionar item" cria várias linhas
   - Cada item vira uma ordem separada compartilhando NF/placa/fornecedor/etc
   - Mesmo padrão da conversão de manutenção em OC

5. **Backup Completo (💾)** no sidebar (admin):
   - Baixa XLSX com 5 abas: INFO, Ordens, Veiculos, Fornecedores, JSON_RAW

6. **Fix bug: editar OC renomeava fornecedor compartilhado**
   - Backend agora detecta troca real de CNPJ → upsert + troca o `fornecedor_id` daquela ordem
   - Se CNPJ é o mesmo (só typo no nome) → atualiza o registro do fornecedor
   - Mesma lógica para veículo (placa)

7. **Edição propaga campos compartilhados por `num_ordem`**:
   - Ao salvar, campos da CABEÇA (placa, fornecedor, NF, supervisor, data, status, obs)
     são replicados em todas as ordens com o mesmo `num_ordem`
   - Campos do ITEM (item, categoria, valor_item, quantidade, valor_total) ficam isolados

8. **Fix bug: tela de cadastro fechava do nada**
   - `sb.auth.onAuthStateChange` rodava `iniciarSessao()` em CADA evento
   - Agora só roda em `SIGNED_IN` ou `INITIAL_SESSION`, ignorando `TOKEN_REFRESHED`

9. **Subaba "📋 Tabela de Vida Útil"** dentro de Próximas Revisões:
   - 34 itens padrão (óleo, filtros, freios, suspensão, etc)
   - Edição inline (✏️ → 💾/❌)
   - Filtros por tipo (Preventiva/Corretiva/Segurança) + busca
   - Import/export XLSX
   - Salvo no Supabase (compartilhado entre usuários)
   - **AÇÃO MANUAL UMA VEZ:** rodar SQL `CREATE TABLE vida_util` no Supabase SQL Editor
     (não conseguimos auto-migration porque adicionar `pg` quebra o `package-lock.json` no Railway)

## 🚧 Pendências / próximos passos

### Integração Cotabox
Usuário tem documentação em https://documenter.getpostman.com/view/38953592/2sAYQXnCU5
mas a API pública **NÃO TEM endpoint de leitura de Ordens de Compra** (só Criar/Editar/Inativar para fornecedor, item, projeto, etc).

Aguardando resposta do suporte Cotabox sobre:
1. Existência de API privada com `GET /purchase-orders/...`
2. Suporte a **webhooks** para notificar OCs aprovadas
3. Quando confirmar:
   - Se webhook → criar `POST /api/cotabox/webhook`
   - Se API leitura → criar tela "Importar do Cotabox" (cola números, busca em paralelo, preview, confirma)

### Auto-migration
- Hoje desativada porque adicionar `pg` ao package.json quebra `npm ci` (lockfile out of sync).
- Para reativar: rodar `npm install pg` localmente, commitar o `package-lock.json` atualizado, e voltar o `pg` no `package.json`.
- Por enquanto, **schema novo = SQL manual no Supabase** (cole no SQL Editor).

### Backup melhorado (futuro)
- Hoje só botão manual no sidebar (admin baixa XLSX)
- Sugestão: cron diário Railway → envia por e-mail para o admin

## 🔢 Importar Km (TicketLog) — atualiza `veiculos.km_atual`

Preenche a km atual dos veículos a partir do relatório **"Últimas Quilometragens/Horas"**
do portal TicketLog/Edenred (`plataforma.ticketlog.com.br`).

**Descoberta importante:** a API pública "Recolha Autônoma" (RAU) da TicketLog **NÃO serve**
para isso — ela é pra postos enviarem NF-e de abastecimento. A km vem do **relatório do portal**,
que é baixado como `.xls` mas na verdade é **HTML** (tabela). Não usamos RPA/navegador
(portal tem SSO Edenred + MFA); o fluxo é **exportar + importar**, à prova de quebra.

**Fluxo:** admin baixa o relatório no portal → botão "🔢 Importar Km (TicketLog)" na aba
Próximas Revisões → escolhe o arquivo → preview (placa, km atual, km nova, Δ, situação) → confirma.

- Parser dedicado (regex nas `<tr class="LinhaImpar|Par">`), pega a **leitura mais recente por placa**.
- Casa por placa normalizada (maiúscula, sem hífen). Km PT-BR (`208.232` → `208232`).
- Flags: `ok` (marcado), `regressao` (km menor que a atual — desmarcado, forçável),
  `invalido` (999.999 = placeholder do posto — bloqueado), `nao_encontrado` (placa não cadastrada).
- **Arquivos:** `src/controllers/importarKm.js`, `src/routes/importarKm.js` (montado em `/api/km`),
  funções JS `importarKmTicketlog`/`renderKmImport`/`confirmarImportKm` no `index.html`.
- **Rotas:** `POST /api/km/preview` (upload, retorna preview), `POST /api/km/aplicar` (grava selecionados).
- **AÇÃO MANUAL UMA VEZ:** rodar no Supabase SQL Editor:
  `ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS km_atualizado_em DATE;`
  (guarda a data da leitura. O endpoint é resiliente e já funciona sem a coluna, só não grava a data.)

### Subaba "Quilometragem" (Análise de Gastos) + histórico
- **Subaba 🔢 Quilometragem** dentro de Análise de Gastos: mostra as placas do **último
  relatório TicketLog importado** (não a lista de veículos cadastrados) — assim nenhuma placa do
  relatório se perde, inclusive as **não cadastradas** (marcadas em vermelho "sem cadastro").
  Colunas: placa, localidade, km, "lida em", situação. Filtro por localidade + busca + ordenação.
  - Padrão de subabas: `page-analise` tem `.subtabs` (`subtab-gastos`/`subtab-km`) e
    `subcontent-gastos`/`subcontent-km`. `abrirSubabaAnalise(qual)`, `carregarKmVeiculos`/
    `renderKmVeiculos` leem **`GET /api/km/ticketlog`**.
  - **Snapshot do relatório:** tabela `km_ticketlog` (uma linha por placa do relatório, PK placa),
    populada no `POST /api/km/aplicar` a partir do `body.relatorio` (todas as placas do preview,
    não só as selecionadas). `salvarSnapshotRelatorio()` + `listarTicketlog()` em `importarKm.js`.
    Resiliente se a tabela não existir. **AÇÃO MANUAL UMA VEZ:** rodar `scripts/km-ticketlog.sql`.
- **Histórico de km** — tabela `veiculo_km_historico` (append-only, idempotente por
  `UNIQUE(veiculo_id, data_leitura, km)`). Alimentada pela função `gravarKm(atualizacoes, origem)`
  em `importarKm.js` (extraída de `aplicar`) — usada pelo import manual e (futuro) pelo sync.
  Resiliente: se a tabela não existir, o update de `veiculos` não quebra (só loga).
  - **AÇÃO MANUAL UMA VEZ:** rodar `scripts/km-historico.sql` no Supabase SQL Editor.

### Parte B — sync online (IMPLEMENTADO jul/2026)
Atualiza a km **sem upload de arquivo**, baixando o relatório direto do portal server-side.

**Descoberta B0 (a requisição interna):**
`POST https://legacy-soulog.ticketlog.com.br/GoodManagerSSL/Fuel/FuelRelUltimasKmLista.cfm?RequestTimeOut=360`
(sistema **legado ColdFusion**, NÃO `plataforma.*`), `content-type: x-www-form-urlencoded`.
Corpo: `dt_ini`/`dt_fim` (dd/mm/yyyy), `consideraPeriodo=S`, `cd_tipo_frota=182386` (AMERINODE,
estático), `cd_situacao=A`, `visual=E` (Excel-HTML). Auth = **só cookie de sessão** (sem Bearer,
sem CSRF, passo único). **Testado: NÃO é IP-bound** → roda do Railway. Resposta = o mesmo
`.xls`-HTML que `parseRelatorio` já lê.

**Arquivos:** `src/services/ticketlog.js` (`baixarRelatorioKm({inicio,fim,dias,cookie})` +
`extrairCookie` que aceita cURL colado ou string de cookies; detecta sessão morta → `err.status=401`).
Em `importarKm.js`: `montarItens`/`resumoItens` (extraídos do preview, usados por preview e sync),
`sync`, `salvarSessao`, `getSessaoCookie`, `marcarSync`.

**Rotas:** `POST /api/km/sync` (baixa+grava; usado pelo botão e pelo Cron),
`POST /api/km/sessao` (admin cola o cURL/cookie; grava em `config_sistema.ticketlog_sessao` e testa).
`cd_tipo_frota`/`cd_situacao` sobrescrevíveis por env `TICKETLOG_CD_TIPO_FROTA`/`TICKETLOG_CD_SITUACAO`.

**Segredo (90 dias):** cookie em `config_sistema.ticketlog_sessao`. **GET /api/config NÃO devolve**
o cookie (só `ticketlog_sessao_configurada: true/false`). Status da sync (`km_sync_ultima_execucao`,
`km_sync_ultimo_status`) vem no GET /api/config e aparece na subaba.

**UI:** botão **🔄 Atualizar (online)** (admin) na subaba Quilometragem → `atualizarKmOnline()`.
Se a sessão expirou (401), abre `modal-km-sessao` com passo-a-passo → `salvarSessaoTicketlog()`.
`carregarStatusSync()` mostra "🔄 online: {data} ({status})".

- **AÇÃO MANUAL UMA VEZ:** rodar `scripts/km-sync.sql` (ALTERs em `config_sistema`).
- **AÇÃO MANUAL:** conectar a sessão pela 1ª vez — botão online → modal → colar o cURL
  (Copy as cURL da requisição `FuelRelUltimasKmLista.cfm`, logada no portal).
### Login automático no portal legado (RESOLVE a expiração — jul/2026)

A sessão morria em poucas horas mesmo com keep-alive. Investigando, três causas:

1. **O portal reemite `CFID`/`CFTOKEN` com `Max-Age=7200`** e o código **descartava** os
   `Set-Cookie` das respostas — seguíamos mandando o valor velho. Agora `mesclarCookies()`
   funde todo `Set-Cookie` no cookie guardado, e `pingSessao`/`baixarRelatorioKm` devolvem o
   cookie atualizado para `salvarCookieSessao()` regravar.
2. **O cookie era a MESMA sessão do navegador da usuária** — quando ela logava no portal, a
   sessão do robô caía (e vice-versa). O formulário tem um campo escondido `forceLogin`, que
   é exatamente a tomada de sessão.
3. **`legacy-soulog.ticketlog.com.br/autenticacao/` tem login PRÓPRIO do SouLog**, com três
   campos (`codigo`, `usuario`, `senha`), **sem MFA e sem captcha** — o SSO Edenred é só a
   alternativa ("ou conectar com Conta Edenred"). Havia uma crença antiga de que só existia
   SSO+MFA; é falsa para o legado.

**Como funciona:** `loginPortal()` em `services/ticketlog.js` faz GET da tela (pega cookies +
`<meta name="csrf-token">`), POST com as credenciais + `_csrf_token` e header `X-CSRF-Token`,
segue os redirects mesclando cookies e confirma com `pingSessao`. Se o portal responder "já
conectado", repete com `forceLogin=true`. `renovarSessao()` em `importarKm.js` é chamada
automaticamente pelo keep-alive e pelo `sync` (retry único no 401).

- **Env (Railway):** `TICKETLOG_CODIGO`, `TICKETLOG_USUARIO`, `TICKETLOG_SENHA`.
  Sem elas nada muda — o sistema volta a depender do cookie colado à mão.
- **Recomendado:** usuário dedicado à integração, para não brigar com o login da equipe.
- **Rotas novas:** `POST /api/km/login` (entra e guarda a sessão; usar para testar),
  `GET /api/km/sessao/status` (a tela pergunta se há login automático).
- **Aviso por e-mail:** quando a sessão cai E o login automático não resolve, sai e-mail pelos
  destinatários do alerta de revisão (`avisarSessaoCaiu`). Só na **transição** para expirado —
  `statusSessaoAnterior()` evita spam a cada 15 min do keep-alive.
#### Estado da investigação (parada em 29/jul/2026, 23h) — RETOMAR AQUI

**O que foi provado funcionando** no login do SouLog (`/autenticacao/`):
- `acao=login` é **obrigatório** — o `jquery-comum.js` da tela faz `$('#acao').val('login')`
  antes de submeter e o form cancela o envio se estiver vazio. Com vazio, o portal só
  redesenha a tela **sem mensagem de erro** (foi o que nos enganou por várias rodadas).
- Enviar também `aem-login=ENTRAR` (campo do botão de submit) e `_csrf_token` + header
  `X-CSRF-Token` (token vem da `<meta name="csrf-token">` da própria tela).
- O erro do portal vem dentro de um **`alert()` em `<script>`** — `mensagemDoPortal()` extrai
  de lá (antes o extrator removia os scripts e perdia justamente a mensagem).
- Validado com credenciais falsas: o portal responde *"Senha ou usuário inválido..."*, ou seja
  o fluxo chega na autenticação de verdade.

**Onde travou:** com as credenciais reais (`TICKETLOG_CODIGO=244457`, usuário = e-mail),
o SouLog respondeu *"Senha ou usuário inválido"*. A usuária **nunca usa essa tela** — ela
entra pela Conta Edenred (SSO), então provavelmente não existe senha própria no legado.
**Próximo passo barato:** usar o link "Esqueceu sua senha?" da tela do SouLog (precisa código
+ nome do usuário) para receber uma senha por e-mail e colocá-la em `TICKETLOG_SENHA`.

**Caminho do SSO (preferido pela usuária, ciclo de ~90 dias) — o que já se sabe:**
- Login real dela: `https://sso.sa.edenred.io/web/session/step/password?returnUrl=/connect/authorize/callback?...`
  · `client_id=fcfc49a2ff3b45ef9c5f245b37b4d567` · `acr_values=tenant:br-fleet-mobility`
  · `scope=openid profile email portal-fleet-and-mobility-ms_application-mfa offline_access`
  · PKCE S256 · `redirect_uri=https://plataforma.ticketlog.com.br/login-callback`
- **`grant_type=password` é BLOQUEADO** para esse client → `{"error":"unauthorized_client"}`
  (o SSO suporta o grant; o cliente não tem permissão).
- **A tela de login tem reCAPTCHA** (`data-sitekey=6LeDfbIZAAAAAF_IQ7_L0OFQQpf--fbWkMhwdfsq`)
  → automatizar o login server-side está **descartado**.
- **Sobrou o caminho do refresh token** (o scope pede `offline_access`): a pessoa loga no
  navegador (resolve o captcha), captura-se o refresh token uma vez, e o servidor renova
  sozinho por ~90 dias.
- **PONTE DESCOBERTA:** `https://plataforma.ticketlog.com.br/legacy?link=<base64 do caminho>`
  — o base64 de `GoodManagerSSL/Fuel/FuelRelUltimasKmForm.cfm` é
  `R29vZE1hbmFnZXJTU0wvRnVlbC9GdWVsUmVsVWx0aW1hc0ttRm9ybS5jZm0=`; o do relatório
  (`...FuelRelUltimasKmLista.cfm`) é `R29vZE1hbmFnZXJTU0wvRnVlbC9GdWVsUmVsVWx0aW1hc0ttTGlzdGEuY2Zt`.
  Essa rota da plataforma cria a sessão no legado e carrega o portal antigo num **iframe**.
- **PEÇA QUE FALTA:** qual requisição a rota `/legacy` dispara para criar a sessão (provável
  chamada a `plataformaapi.ticketlog.com.br/soulog/...` com Bearer, devolvendo um token/URL
  que o legado aceita). Capturar com F12 → Network → botão **Doc** ao abrir a URL da ponte.
  A API não expõe swagger (`/swagger/*` → 404).

**Ideia da usuária a validar antes de tudo isso:** a correção do cookie rotacionado subiu hoje
**depois** da sessão já ter expirado (15:20), então **nunca foi testada**. Reconectar pelo cURL
e, com a telemetria (`km_keepalive_em`/`km_keepalive_status`) agora gravando, medir quanto a
sessão dura. Se durar dias, toda a ponte/refresh token vira opcional.

- **AÇÃO MANUAL:** rodar as colunas de telemetria do keep-alive (não existiam):
  `ALTER TABLE config_sistema ADD COLUMN IF NOT EXISTS km_keepalive_em TIMESTAMPTZ;` e
  `... km_keepalive_status TEXT;` — sem elas não há como medir a duração real da sessão.

- **Risco em aberto (histórico):** longevidade do cookie. O login SSO dura ~90 dias (renovado jul/2026 →
  vale até ~out/2026, sem MFA nesse período), MAS o cookie legado (`JSESSIONID`/`CFID`) pode
  expirar antes. O sync detecta (`km_sync_ultimo_status='expirado'`) e a UI pede reautenticação.
  Ainda **não medido** quanto dura na prática.
- **PEGADINHA:** o relatório volta VAZIO se o intervalo passar de ~1 mês → `baixarRelatorioKm`
  trava a janela em `min(dias,30)`. Sync com `atualizados:0` + sessão válida = período largo demais.

**Agendamento (FEITO):** usuária configurou **cron-job.org** (não Railway) chamando
`POST https://manutencao-veicular-api-production.up.railway.app/api/km/sync` 1x/dia. Endpoint
idempotente (histórico por `UNIQUE`). Hoje `/api/km/sync` é aberto como os demais /api/km.
**Como reconectar quando expirar:** ver `COMO-RECONECTAR-TICKETLOG.md` (guia do usuário) ou o
próprio modal `modal-km-sessao` (botão 🔄 Atualizar (online) na subaba Quilometragem).

## 🚨 Recorrência de Manutenção / Veículos Críticos (subaba de Análise de Gastos)

3ª subaba de `page-analise` (`subtab-recorrencia`/`subcontent-recorrencia`). Identifica
veículos que **voltam muito à oficina** (não só os de maior gasto pontual) para apoiar
decisão de renovação da frota (TCO).

- **Backend:** `src/controllers/recorrencia.js` → `GET /api/dashboard/recorrencia?km_limite=&custo_limite=`
  (rota adicionada em `routes/dashboard.js`, sem tocar server.js). Agrega, com paginação estável
  (`fetchAll` + `order('id')`, contorna teto de 1000 do PostgREST):
  - **ordens** (exceto Canceladas): custo 12m/24m/total e nº de **entradas na oficina** = **dias
    distintos** com ordem (várias OCs/itens no mesmo dia = 1 entrada). Janelas 3/6/12m + 90/180 dias (alertas).
  - **manutencoes** (casadas por placa normalizada): **dias em oficina** (12m) e % indisponibilidade.
  - **veiculo_km_historico**: km rodado 12m → **custo por km**; + km do 1º registro (evolução).
- **Score 0-100** = 30% recorrência(manut 12m) + 30% custo(12m) + 20% km_atual + 20% dias oficina,
  cada dimensão normalizada pelo **pior caso da frota**. Faixas: <40 baixo, 40-69 atenção, 70+ substituição.
- **Alertas:** automáticos (>3 manut/90d, >6 manut/180d) + por limite configurável na UI
  (km acima de X, custo 12m acima de R$ Y). Passados como query params.
- **Frontend:** `carregarRecorrencia`/`renderRecorrencia`/`renderRecorrenciaKpis`/`recFaixa`/
  `abrirDetalheRec`/`exportarRecorrenciaXLSX`. KPIs, ranking clicável (badge de score por faixa),
  filtros (placa/localidade/faixa), export XLSX, modal `modal-rec-detalhe` com TCO por veículo.
  Reusa `.badge badge-red|amber|green`. Sem SQL manual novo (usa tabelas existentes).
- **Limitação honesta:** "km na 1ª manutenção" não é exato (ordens não guardam km) — usa o 1º
  registro do histórico de km como proxy; custo/km só aparece com ≥2 leituras de km no período.

## 🗓️ Revisões programadas (agenda com TIPO e SERVIÇO)

Antes existia **uma** data por veículo (`veiculos.proxima_revisao`), sem tipo nem serviço.
Agora há a tabela **`revisoes_programadas`**: várias revisões por veículo, cada uma com
`tipo` (Preventiva | Corretiva | Preditiva | Segurança) e `servico` (texto livre — troca de
pneu, alinhamento e balanceamento, troca de óleo…), `data_prevista`, `km_previsto`, `status`
(Pendente | Concluída | Cancelada), `observacao`, `origem` (Manual | Planilha | Migracao).

- **SQL:** `scripts/revisoes-programadas.sql` — cria a tabela, **migra** as datas que já existiam
  em `veiculos.proxima_revisao` (como Preventiva/"Revisão preventiva") e troca a UNIQUE de
  `alertas_revisao_log` para incluir o `servico` (pneu e alinhamento no mesmo dia são avisos
  distintos). A UNIQUE antiga é derrubada por um `DO $$` que a acha pela definição, já que o
  nome é gerado pelo Postgres.
- **Idempotência:** `UNIQUE (veiculo_id, data_prevista, servico)` — reimportar a mesma planilha
  não duplica (upsert com esse `onConflict`).
- **Backend:** `src/controllers/revisoesProgramadas.js`, rotas em `src/routes/revisoes.js` →
  `/api/revisoes` (GET lista, GET `/servicos`, POST, POST `/importar`, PUT `/:id`,
  POST `/:id/concluir`, DELETE `/:id`).
- **`veiculos.proxima_revisao` continua viva e sincronizada** com a data da revisão PENDENTE
  mais próxima (`sincronizarVeiculos`), a cada gravação — assim dashboard (`revisoes_proximas`/
  `revisoes_urgentes`), relatórios e exports antigos não mudam.
- **Ponte com os caminhos antigos:** `garantirRevisaoDaData()` espelha na agenda qualquer data
  gravada por fora (edição de veículo em `outros.js`, cadastro/edição de OC em `ordens.js`,
  import de Excel em `importar.js`). Sem isso, uma data digitada na OC nunca geraria alerta.
- **Concluir** aceita `{ proxima_em_dias }` e já reagenda o mesmo serviço (ciclo de manutenção).
- **Frontend:** subaba Próximas Revisões refeita — filtros (busca/tipo/status), colunas Tipo e
  Serviço, `abrirModalRevisao`/`salvarRevisao` (modal `modal-revisao`, datalists de placa e
  serviço), `concluirRevisaoProgramada`, `excluirRevisao`, `baixarTemplateRevisoes` (gera XLSX
  com abas *Revisoes* + *Instrucoes* via SheetJS), `importarRevisoesXLSX` → prévia server-side
  (`preview: true`) no modal `modal-rev-import` → `confirmarImportRevisoes`.
- **Colunas da planilha:** Placa, Tipo de Revisão, Tipo de Manutenção, Data Prevista, KM Previsto,
  Observação. Datas aceitam DD/MM/AAAA, ISO e serial do Excel — validadas no calendário
  (`dataReal`), então 31/13/2026 é recusada como "data inválida" em vez de estourar no banco.
- **A função antiga `concluirRevisao`** (marcava TODAS as ordens do veículo como Concluído e
  limpava a data) foi removida: concluir agora encerra só o agendamento específico.
- **AÇÃO MANUAL UMA VEZ:** rodar `scripts/revisoes-programadas.sql` **antes** de subir o deploy —
  se a tabela não existir, a aba lista vazio (o alerta por e-mail tem fallback, a listagem não).

## 🔔 Alerta de revisão por e-mail (subaba de Próximas Revisões)

3ª subaba de `page-revisoes` (`subtab-alertas`/`subcontent-alertas`). Avisa por e-mail quando a
revisão de um veículo está chegando. **Tudo é parametrizado pelo operador — não há regra fixa
no código:** destinatários, dias de antecedência (ex.: 10 e 7), horário do disparo, incluir ou
não as vencidas, e o assunto.

- **Config:** colunas `alerta_revisao_*` em `config_sistema` (linha única id=1). Rodar
  `scripts/alertas-revisao.sql` (cria também `alertas_revisao_log`). Inclui `alerta_revisao_mensagem`
  — recado livre do operador, renderizado acima da tabela (escapado com `escapeHtml`, `\n` → `<br>`).
- **Backend:** `src/services/email.js` (envio por API HTTP — Resend/Brevo/SendGrid, **sem
  dependência nova**, porque mexer no `package-lock` quebra o `npm ci` do Railway) e
  `src/controllers/alertasRevisao.js`; rotas em `src/routes/alertas.js` → `/api/alertas/*`.
- **Fonte da agenda:** `revisoes_programadas` (status Pendente) via `lerAgenda()`, com tipo e
  serviço no corpo do e-mail. Se a tabela não existir, cai no modelo antigo
  (`veiculos.proxima_revisao`) — não deixa de avisar por causa de SQL pendente.
- **Regra de seleção:** para cada revisão pendente, escolhe o **menor marco
  configurado já alcançado** (`dias <= marco`) — com marcos {10,7}, faltando 9 dias cai no marco
  10; faltando 6, no marco 7. Vencidas usam o marco especial `-1`. Usar "menor marco alcançado"
  (e não igualdade exata) garante que um dia sem disparo (deploy/queda) não perca o aviso.
- **Anti-spam:** `alertas_revisao_log` com `UNIQUE(veiculo_id, data_revisao, dias_antecedencia)`.
  Cada veículo recebe **um e-mail por marco**. Resiliente: se a tabela não existir, envia sem dedupe.
- **Agendamento:** interno, no `server.js` (`iniciarAgendador`, mesmo padrão do keep-alive
  TicketLog). Tick a cada `ALERTA_REVISAO_TICK_MIN` (default 20 min); dispara 1x/dia a partir da
  hora escolhida, no fuso `America/Sao_Paulo` (Railway roda em UTC). Não precisa de cron externo,
  mas `POST /api/alertas/revisao/executar` continua aberto pra cron-job.org se preferirem.

| Método | Rota | Descrição |
|---|---|---|
| GET  | `/api/alertas/revisao/config`    | config + status do provedor de e-mail |
| PUT  | `/api/alertas/revisao/config`    | operador ajusta emails/dias/hora/assunto |
| GET  | `/api/alertas/revisao/previa`    | quem seria avisado agora (não envia) |
| POST | `/api/alertas/revisao/executar`  | dispara (`{forcar}` reenvia, `{ignorarAtivo}` ignora o toggle) |
| POST | `/api/alertas/revisao/teste`     | e-mail de teste (não grava log) |
| GET  | `/api/alertas/revisao/historico` | últimos avisos disparados |

- **Frontend:** `carregarConfigAlertas`/`alertasSalvar`/`alertasVerPrevia`/`alertasEnviarTeste`/
  `alertasEnviarAgora` + chips de e-mail e de dias (`alertasAddEmail`/`alertasAddDia`).
- **AÇÃO MANUAL UMA VEZ:** rodar `scripts/alertas-revisao.sql` no Supabase SQL Editor.
- **AÇÃO MANUAL (Railway):** definir `EMAIL_FROM` (remetente verificado) + **uma** chave:
  `RESEND_API_KEY` | `BREVO_API_KEY` | `SENDGRID_API_KEY`. Enquanto faltar, a subaba mostra
  faixa laranja explicando o que falta — a config pode ser salva, mas nada é enviado.

## 🔧 Manutenção & operação — REGRAS PRÁTICAS (ler antes de mexer)

**Caminho real do projeto (pegadinha do OneDrive):** o repo tem uma cópia OneDrive **aninhada**.
A raiz de trabalho é
`...\manutencao-veicular-api\OneDrive - Amerinode do Brasil\Compras\AP GESTÃO DE MANUTENÇÃO\manutencao-backend\`.
Glob/paths relativos falham; use o caminho absoluto completo. Git roda da raiz `manutencao-veicular-api`.

**Deploy:** editar → `git add`/`commit`/`push origin main` → Railway auto-deploy (~1-2 min).
node_modules NÃO existe localmente (deps só no Railway) — `require('express')` falha ao testar
local; valide backend com `node --check <arquivo>` e o front extraindo o `<script>` + `new Function`.

**Entregar SQL para a usuária rodar — NÃO colar no chat.** A cópia do texto do terminal corrompe:
sumiram ~28 caracteres no meio de linhas longas (`FROM veiculos WHERE proxima_revi` → `FROsao`),
vírgulas se perderam e até os números dos passos entraram no SQL — 4 erros `42601` seguidos.
**O que funciona:** escrever o `.sql` em arquivo e abrir com `Start-Process notepad.exe <caminho>`;
ela copia dali (Ctrl+A/Ctrl+C) e cola no SQL Editor. Nos scripts, evitar comentário `--` no fim de
linha **dentro** de comandos: se uma quebra de linha se perder, o `--` comenta o resto do comando.

**Supabase (PostgREST) — cache de schema:** ao adicionar coluna via SQL, a API pode não enxergar
na hora ("Could not find the 'X' column ... in the schema cache"). Rodar `NOTIFY pgrst, 'reload schema';`
no SQL Editor; se persistir, **Settings → General → Restart project**. O SQL em si funciona antes disso.

**Ações manuais no Supabase (rodar 1x cada, SQL Editor, projeto `pjasyczbgghatkbgnovs`):**
- `scripts/km-ticketlog.sql` (snapshot subaba Quilometragem) — FEITO
- `scripts/km-historico.sql` (histórico de km) — verificar se rodou
- `scripts/km-sync.sql` (cria `config_sistema` se faltar + colunas do sync) — FEITO jul/2026
- `scripts/alertas-revisao.sql` (config do alerta de revisão por e-mail + log de envios) — FEITO jul/2026
- `scripts/revisoes-programadas.sql` (agenda com tipo/serviço + migra proxima_revisao) — FEITO jul/2026 (migrou 4 datas)
- `ALTER TABLE veiculos ADD COLUMN IF NOT EXISTS km_atualizado_em DATE;` — verificar
- `config_sistema` **não existia** neste projeto até jul/2026 (o toggle de bloqueio de fornecedor
  também dependia dela). `km-sync.sql` agora cria a tabela se faltar.

**Km via TicketLog:** sync diário por cron-job.org → `/api/km/sync`. Quando o status virar
"⚠️ sessão expirada", reconectar pelo modal (guia em `COMO-RECONECTAR-TICKETLOG.md`). Janela ≤30 dias.

**Dados:** ordens = 1 linha por ITEM (várias por `num_ordem`). "Entradas na oficina" da recorrência
= dias distintos com ordem. Placas com typo geram cadastros duplicados (ex.: `QNZ0H31`/`QN0ZH31`) —
o painel de recorrência os revela; vale unificar em Veículos.

## 🐛 Bugs históricos conhecidos (resolvidos)

- **Dashboard vazio no 1º dia do mês:** período padrão era `mes` (mês atual); na virada do mês
  (ex.: 01/07 sem ordens em julho) tudo zerava. Padrão mudado para `ano` (Ano atual). `currentPeriod`
  em index.html + botão `.active`. Endpoints resumo/rankings/serie usam `?periodo=${currentPeriod}`.
- **Ordens 3000+ não apareciam:** `limit=200` removido, agora pagina tudo
- **Edição de fornecedor afetava outras ordens:** corrigido com lógica de upsert por CNPJ
- **Cadastro fechava do nada:** `onAuthStateChange` agora ignora TOKEN_REFRESHED
- **`API_URL is not defined`:** variável global é `API`, não `API_URL`

## 🔧 Operações comuns (cheatsheet)

### Editar o frontend
- Tudo está em `public/index.html`
- Funções JS organizadas por seção (// ── NOME ──)
- IDs principais: `page-<nome>` (dashboard, ordens, cadastro, importar, revisoes, relatorios, analise, manutencao, usuarios)
- Padrão de tabela: `<table>` dentro de `.table-wrap`, header em `.card-header`
- Cores principais: azul Amerinode `#185FA5`/`#0C447C`, cinza `#666`, fundo `#F5F8FB`

### Deploy
1. Edit local → 2. `git add` → 3. `git commit` → 4. `git push origin main` → 5. Railway redeploy automático (~1 min)

### Worktree pode quebrar
Esta sessão trabalhou via worktree em `C:/Users/Ana/.claude/worktrees/...`. Se git parar de funcionar, o caminho usado anteriormente foi:
1. `git clone --depth 5 https://github.com/Amerinode18SP/manutencao-veicular-api.git /tmp/mvr`
2. Copiar arquivos editados do worktree para `/tmp/mvr/.../manutencao-backend/`
3. Commit + push do `/tmp/mvr`

### Restaurar dados
- **Banco:** Supabase Dashboard → Database → Backups (free = 7 dias)
- **Manual:** botão **💾 Backup Completo** no sidebar (admin) — baixa XLSX completo
- **Esquema:** `scripts/schema.sql` tem a estrutura inicial

## 📝 Convenções

- Commits em português, começando com `feat:`, `fix:`, `chore:`, `preview:`
- Sem emojis em código a não ser quando já tem (botões/UI)
- Não criar markdown novo sem necessidade
- Edit prefere alterar `index.html` existente, não criar arquivos novos

---

## 🚗 Módulo Distância & Combustível (PRODUÇÃO)

Integração com a API da **Cobli** para visualizar km rodados, gasto com combustível,
custo por km, top 10 veículos, gasto médio por modelo, alertas e recomendações de rodízio.

**Status:** ativo em produção. Flag `window.FEATURES.distanciaCobli = true` no `index.html`.
Aba visível para todos os perfis; botões de ação (Atualizar/Excel/PDF) só para administrador.

**Validado:** maio/2026 R$ 75.473,23 — bate exatamente com o dashboard da Cobli.

### Endpoints da Cobli consumidos
Auth via header `cobli-api-key: <token>` (NÃO usa Bearer).
- `GET  /public/v1/vehicles` — paginado, campos: id, license_plate, brand, model, groups[]
- `GET  /public/v1/groups` — grupos com vehicle_ids
- `POST /public/v1/vehicles/report/distance-driven` — body: {start_date, end_date, vehicle_ids[]}, response: data[].distance_driven_in_km
- `GET  /herbie-1.1/fuel/transactions/report?begin=&end=&tz=` — **retorna XLSX (não JSON)**, parseado server-side com SheetJS. É o que o dashboard da Cobli usa, inclui todas as fontes (TicketLog + outras). Uma linha por (Placa × Combustível) — `sync` dedupe por (cobli_id, ano_mes).

### Histórico de dados na Cobli
- Distância: disponível a partir de **janeiro/2025** (12 meses backfill funcionou)
- Combustível: disponível a partir de **agosto/2025** (quando o cartão Cobli foi ativado para a Amerinode). Períodos anteriores retornam vazios.

### Tabelas no Supabase
- `cobli_vehicles` (cobli_id, placa, modelo, grupo) — cache da frota
- `cobli_distance` (cobli_id, ano_mes, km) — km mensal por veículo
- `cobli_fuel_mensal` (cobli_id, ano_mes, placa, gasto_brl, litros, km_cobli, custo_km, custo_litro, consumo_km_l, combustivel) — **tabela usada hoje**, vem do relatório XLSX
- `cobli_fuel` (per-transaction, LEGADO) — não populada pelo sync atual
- `cobli_regiao_override` (grupo → região amigável) — admin sobrescreve sem alterar Cobli

### Arquivos
- `scripts/distancia.sql` — schema completo (rodar manualmente no Supabase)
- `src/services/cobli.js` — cliente HTTP (incluindo XLSX parse via require('xlsx'))
- `src/controllers/distancia.js` — handlers, lógica, dedupe, normalizers
- `src/routes/distancia.js` — registra em `/api/distancia/*`

### Rotas expostas
| Método | Rota | Descrição |
|---|---|---|
| GET  | `/api/distancia/resumo`  | KPIs + série mensal/anual (aceita `?ano`, `?meses=1,2,3`, `?placa`, `?regiao`, `?modelo`) |
| GET  | `/api/distancia/top`     | Top 10 veículos por km |
| GET  | `/api/distancia/modelo`  | Custo médio R$/km por modelo + alertas de desvio |
| GET  | `/api/distancia/placas`  | Lista de placas (dropdown) |
| GET  | `/api/distancia/modelos` | Lista de modelos (dropdown) |
| GET  | `/api/distancia/rodizio` | Recomendações de troca entre veículos do mesmo grupo |
| GET  | `/api/distancia/regioes` | Lista grupos Cobli + override |
| PUT  | `/api/distancia/regioes` | Admin sobrescreve grupo→região |
| POST | `/api/distancia/sync`    | Body `{ano: 2025}` ou `{periodo: 'mes'}` — chama Cobli e popula Supabase |

### Sincronização
**Manual** via botão "🔄 Atualizar agora" na UI (só admin). Não há cron. Os endpoints
de leitura servem do cache no Supabase, então são rápidos e não dependem da Cobli estar de pé.

### Env vars (Railway)
- `COBLI_API_TOKEN` — token gerado em painel.cobli.co → APIs (header `cobli-api-key`)

### Pontos de atenção
- O endpoint `fuel/transactions/report` ignora `Accept: application/json` e sempre devolve XLSX. Parsing feito com SheetJS server-side.
- Encoding dos nomes de coluna do XLSX vem com UTF-8 duplo-encoded (ex: `Ã­` para `í`). Por isso `pickColumn()` usa match por substring case-insensitive.
- Valores numéricos vêm como string com formato PT-BR. `numBR()` trata.
- O XLSX retorna 1 linha por (Placa × Combustível). O sync agrega por (cobli_id, ano_mes) somando gasto e litros, mantendo km como máximo (não é aditivo), e concatena combustíveis (`"ETANOL+GASOLINA"`).
