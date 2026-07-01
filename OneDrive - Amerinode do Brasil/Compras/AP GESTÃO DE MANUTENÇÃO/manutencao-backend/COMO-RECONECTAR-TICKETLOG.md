# Como reconectar a sessão do TicketLog (atualização automática de KM)

O sistema atualiza a quilometragem dos veículos **sozinho, todo dia**, baixando o
relatório direto do portal TicketLog. Para isso ele usa uma "sessão" (um código de
acesso) que **expira de tempos em tempos**. Quando isso acontece, a atualização
automática para e é preciso **reconectar** — este guia mostra como.

> ✅ **Não precisa refazer o SMS/MFA.** O login do portal dura ~90 dias, então
> reconectar leva 1 minuto e não pede código no celular.

## Como sei que a sessão expirou?

Na tela **Análise de Gastos → 🔢 Quilometragem**, no topo aparece o status da última
atualização automática:

- **🔄 online: {data} (✅ ok)** → está tudo funcionando, não precisa fazer nada.
- **🔄 online: {data} (⚠️ sessão expirada)** → precisa reconectar (passos abaixo).

## Passo a passo para reconectar

1. Abra o **portal TicketLog** (já logada) e vá no relatório **"Últimas Quilometragens/Horas"**.
2. Aperte **F12** no teclado. Vai abrir um painel; clique na aba **Network** (ou **Rede**).
3. Nessa linha de botões `All | Fetch/XHR | Doc | ...`, clique em **All**. Marque também **Preserve log**.
4. No formulário do relatório, deixe **Visualização = EXCEL** e clique no botão que **gera o relatório**.
5. Na lista que aparecer, procure a linha **FuelRelUltimasKmLista.cfm** (tipo *document*).
   - Se a lista estiver vazia, clique no ícone **🚫** (limpar) e gere o relatório de novo.
6. Clique nessa linha com o **botão direito** → **Copy** → **Copy as cURL (bash)**.
7. Volte no sistema → **Análise de Gastos → 🔢 Quilometragem** → botão **🔄 Atualizar (online)**.
8. No campo grande do modal, **cole** (Ctrl+V) o que você copiou → clique **Salvar e testar**.
9. Se aparecer "✅ Sessão válida e salva!", pronto — a atualização automática volta a funcionar.

## Observações

- Só **administradores** veem o botão "Atualizar (online)".
- O código copiado (cURL) contém a sua sessão; ele fica guardado no servidor e **nunca**
  é exibido de volta. Serve só para o sistema baixar o relatório.
- A atualização automática roda 1x/dia (via cron-job.org). O botão **🔄 Atualizar (online)**
  força uma atualização na hora, a qualquer momento.
- O relatório do portal só aceita intervalo de até ~1 mês; o sistema já usa 30 dias
  automaticamente (não precisa se preocupar com isso).
