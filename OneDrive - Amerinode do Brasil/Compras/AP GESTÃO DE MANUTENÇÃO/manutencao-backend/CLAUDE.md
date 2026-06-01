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

- **veiculos** — placa (UNIQUE), localidade, km_atual, proxima_revisao, observacao
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

## 🐛 Bugs históricos conhecidos (resolvidos)

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
