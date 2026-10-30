# FNS Gestão de Repasses e Baixas

Aplicação em React, TypeScript e Vite com API própria em Node.js, TypeScript e Hono. O FNS é a fonte dos dados oficiais; o Supabase fornece persistência compartilhada para os dados internos e repasses importados com procedência. Não há fluxo de login nesta etapa: a futura integração de sessão JWT será responsabilidade da autenticação.

## Executar

```sh
npm install
npm run dev
```

Em outro terminal, inicie a API:

```sh
npm run dev:server
```

O Vite encaminha `/api/*` para `http://127.0.0.1:3001`. Os padrões locais estão em `.env.example`; copie-o para `.env` quando precisar ajustar `HOST`, `PORT`, `FRONTEND_ORIGIN` ou `FNS_TIMEOUT_MS`. O backend aceita CORS somente da origem configurada.

Verificação de tipos e build de produção:

```sh
npm run build
npm run test:server
```

Para compilar e iniciar o backend de produção:

```sh
npm run build:server
npm run start:server
```

## Rotas

- `/` — indicadores, gráficos e baixas recentes.
- `/consultas` — consulta oficial do FNS, detalhes financeiros, seleção explícita de ações para importação e exportação de arquivos.
- `/repasses-importados` — consulta de repasses oficiais importados e histórico das importações.
- `/migracao-dados` — prévia e migração explícita dos dados locais elegíveis.
- `/emendas-estaduais` — cadastro interno de emendas estaduais.
- `/deputados` — cadastro de deputados.
- `/baixas` — pesquisa e gestão das baixas internas, locais ou compartilhadas conforme o ambiente.
- `/baixas/:id` — criação e edição de uma baixa.
- `/comparacao-parcelas` — comparação de ações financeiras do FNS entre o mês selecionado e o anterior.
- `/historico` — eventos de criação, edição e exclusão.

## Dados e integração futura

O backend disponibiliza `GET /api/fns/anos`, `GET /api/fns/tipos-consulta/:ano`, `GET /api/fns/repasses`, `GET /api/fns/ufs` e `GET /api/fns/meses`. Os caminhos de origem são fixos no servidor; não há parâmetro de URL upstream. Cada chamada tem timeout, validação do envelope e logs sem query strings. Respostas de erro usam `{ "error": { "code": "...", "message": "..." } }`.

Municípios: `GET /api/fns/municipios` carrega as 27 UFs com no máximo três consultas simultâneas; `GET /api/fns/municipios/:uf` carrega uma UF validada. O backend consulta `/recursos/municipios/uf/:UF` e cruza nome normalizado e UF com o catálogo oficial do IBGE para fornecer a identidade canônica de sete dígitos; usa o catálogo IBGE como fallback quando o FNS não retorna uma lista válida. Os resultados ficam em cache por seis horas. No caso de Alfredo Marcondes/SP, o FNS retorna `350080`, mas o IBGE confirma `3500808`; `3500800` não é o código publicado pelo IBGE. Blocos: `GET /api/fns/blocos?ano=2026&coTipoConsulta=2`; as duas entradas são validadas e os resultados também são cacheados por seis horas. A tela inicia com Fundo a Fundo (`2`) e o recarrega ao trocar o ano quando disponível; blocos usam o ano e o tipo selecionados.

O endpoint detalhado `GET /recursos/consulta-detalhada/entidades` e o detalhe financeiro `GET /recursos/consulta-detalhada/detalhe-acao` são consultados pelo backend, com validação da resposta e paginação. A importação não acontece ao pesquisar: na tela de detalhes financeiros, selecione ações com identificador oficial e confirme em **Importar selecionados**. O backend valida novamente os filtros e os IDs contra o FNS, preserva a resposta de origem e grava por upsert. A exportação CSV/Excel/PDF continua sendo somente download local e não grava no banco.

A comparação mensal usa as rotas oficiais já existentes para consultar as entidades e os detalhes financeiros do FNS para o mês escolhido e o imediatamente anterior. É necessário selecionar um município parceiro autorizado. A listagem de unidades é paginada e as consultas financeiras são realizadas com concorrência limitada; cada ação é relacionada apenas pelo identificador retornado pelo FNS. Registros sem identificador estável, valor financeiro ou resposta completa não são tratados como igualdade nem como divergência confirmada. O relatório separa aumentos, reduções, valores iguais, registros novos/ausentes e itens sem dados suficientes. Totais são omitidos quando não podem ser calculados a partir dos valores oficiais disponíveis. A disponibilidade e a consistência histórica dependem do retorno atual do FNS; sem resposta histórica para um dos meses, a comparação não é concluída.

O módulo não usa a série mensal demonstrativa de `src/data/mockRepasses.ts`. Com o modo Supabase de teste ativo, baixas, histórico, emendas estaduais, deputados, complementos financeiros, lançamentos e justificativas são enviados ao backend e persistidos no Supabase. Sem essa conexão, cadastros e alterações operacionais ficam desabilitados: o aplicativo não informa sucesso com base em gravação local.

Os repasses fictícios vivem em `src/data/mockRepasses.ts` e não são importados como dados oficiais. `RepasseRepository` mantém essa fonte demonstrativa separada. A baixa usa identificadores e snapshots próprios; o deputado continua sendo informado manualmente e não é obtido do FNS. A migração local exclui registros demonstrativos iniciais inalterados, preserva a origem e usa identificadores legados para permitir retentativas. Se o formato local estiver inválido ou incompatível, a aplicação informa o erro e não o substitui por dados demonstrativos.

As chaves locais existentes são preservadas e lidas somente pela migração: `fns-repasses-demo:v1` guarda baixas, histórico, emendas e complementos (formato versão 1 ou 2); `fns-financial-launch-drafts:v1` guarda rascunhos por ação (versão 1); `fns-installment-reviews:v1` guarda status e justificativas por alerta. A migração em `/migracao-dados` pede confirmação, ignora demonstrações iniciais inalteradas, usa identificadores legados para evitar duplicidades e não apaga nenhuma chave local. Os repositórios locais antigos permanecem apenas para compatibilidade da migração/testes; não são fonte de verdade operacional.

Ao registrar uma baixa, o gestor informa manualmente o deputado responsável; o nome não é obtido do FNS nem preenchido automaticamente. A emenda estadual relacionada é opcional. O nome do deputado fica na baixa e no evento histórico, junto com snapshots da baixa e das informações da emenda (UF, identificação, valor, objeto e observações), mesmo que o cadastro da emenda seja alterado ou excluído posteriormente.

## Supabase, segurança e migrações

O esquema reaproveitado está em `supabase/migrations/202610300001_initial_shared_backend.sql`: ele já define `fns_importacoes`, `fns_repasses`, `deputados`, `emendas_estaduais`, `baixas`, `baixa_historico`, complementos/lançamentos financeiros, análises e auditoria. A migration `202610300002_test_mode_without_auth.sql` permite que os campos de ator fiquem nulos até a autenticação existir; ela não apaga registros. A migration aditiva `202610300003_financial_change_audit.sql` acrescenta snapshots de auditoria para alterações em complementos e lançamentos financeiros. O estado real do banco remoto precisa ser confirmado no Dashboard Supabase, pois este repositório não contém acesso SQL remoto.

Para testar sem login, o frontend continua falando somente com a API local. No `.env` do servidor, configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_TEST_MODE=true`, apontando exclusivamente para o projeto de desenvolvimento. A chave `service_role` é necessária apenas no processo backend local, não é uma variável `VITE_*`, não deve ir ao navegador, Git ou logs. O backend recusa o modo de teste se `HOST` ou `FRONTEND_ORIGIN` não forem locais. Não publique nem exponha esse backend; esse modo contorna RLS pelo servidor privilegiado e destina-se exclusivamente ao projeto de teste local. Com `SUPABASE_TEST_MODE=false` (padrão), as alterações operacionais ficam desabilitadas e a API exige JWT para operações compartilhadas.

Copie `.env.example` para `.env`, preencha os valores no ambiente local e nunca substitua os valores de produção no código. No Dashboard do Supabase do projeto de teste, aplique as migrations em ordem pelo SQL Editor (ou pelo processo de migrations da equipe). Não há políticas temporárias para papel `anon`: o acesso sem login passa pelo backend de teste local com a chave privilegiada, e as políticas RLS existentes não são removidas. A página `/repasses-importados` consulta os dados diretamente via backend, com filtros por texto/ano/mês/UF e paginação no Supabase.

Esta etapa não implementa login, cadastro, recuperação de senha, emissão/renovação de sessão ou gerenciamento de usuários. O modo de teste não identifica usuários e não está pronto para produção multiusuário. O provisionamento de administradores, os papéis, as políticas de acesso por usuário e a integração de sessão JWT ficam para a etapa de autenticação.

Antes de habilitar usuários reais, desligue `SUPABASE_TEST_MODE`, remova a chave privilegiada do ambiente de execução compartilhado e valide a integração JWT e as políticas RLS com os papéis previstos. Não declare a persistência remota validada até aplicar as migrations e confirmar gravação/leitura no projeto de teste. A API FNS continua sendo a fonte dos dados oficiais, e alterações internas não modificam o portal.

A página `/migracao-dados` faz uma prévia e exige confirmação para selecionar categorias locais para envio, sem apagar as chaves do navegador. Registros inválidos são reportados e permanecem sem alteração. Repasses fictícios não são tratados como oficiais.

O LocalStorage é temporário, não sincroniza usuários, não deve armazenar dados pessoais sensíveis e não é auditoria inviolável. Status e datas de pagamento são controles internos e não alteram dados oficiais. O portal respondeu os recursos em JSON sem declarar charset; o primeiro texto de `/recursos/repasses` já chega com acentuação corrompida (`AÃ§Ã£o Judicial`), portanto o backend preserva o conteúdo recebido e não tenta corrigir texto de origem automaticamente.
