# FNS Gestão de Repasses e Baixas

Aplicação em React 19, TypeScript e Vite com API própria em Node.js, TypeScript e Hono. O FNS é a fonte dos dados oficiais; o Supabase fornece persistência compartilhada para os dados internos e repasses importados com procedência.

A aplicação conta com autenticação integrada à plataforma MCK Soluções, suporte a Single Sign-On (SSO) direto pelo menu/card do MCK e tela de login própria com verificação Cloudflare Turnstile. **O acesso é restrito exclusivamente a usuários com perfil de Gestor ou Administrador.**

## Executar em Desenvolvimento

```sh
npm install
npm run dev
```

Em outro terminal, inicie a API:

```sh
npm run dev:server
```

O Vite encaminha `/api/*` para `http://127.0.0.1:3001`. Os padrões locais estão em `.env.example`; copie-o para `.env` quando precisar ajustar `HOST`, `PORT`, `FRONTEND_ORIGIN`, `FNS_TIMEOUT_MS`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` ou `TURNSTILE_SITE_KEY`. O backend aceita CORS somente da origem configurada.

Verificação de tipos e testes:

```sh
npm run build
npm run test:server
```

Para compilar e iniciar o backend de produção:

```sh
npm run build:server
npm run start:server
```

## Autenticação e SSO

### 1. Acesso via Single Sign-On (SSO a partir do MCK)
- No painel MCK Soluções (`C:\mcksolucoes`), ao clicar no card **FNS** (tela Início) ou na gaveta **Sistemas > FNS** (barra lateral), o gestor é direcionado para a nova aba do FNS com seu `access_token` no fragmento da URL (`#access_token=...&token_type=bearer&expires_at=...`).
- O FNS captura e limpa o token da URL imediatamente no escopo do módulo (protegendo contra o duplo mount do React 19 StrictMode), valida os dados do usuário via `GET /api/auth/me` no backend e armazena a sessão ativa em `sessionStorage` (`fns-auth:v1`).
- **Segurança de Sessão:** O SSO repassa **apenas** o `access_token` (sem `refresh_token`), evitando conflitos de rotação de token do Supabase entre o MCK e o FNS. Quando o token expira, o usuário é notificado para reabrir pelo MCK ou autenticar com login e senha.

### 2. Login Direto no FNS
- Caso o usuário abra o FNS diretamente sem sessão prévia, é apresentada a tela de login.
- O formulário normaliza o usuário para o domínio MCK (`${usuario.trim().replace(/[.\-]/g, '')}@sistema.mck`), solicita a senha e valida o desafio Cloudflare Turnstile.
- O GoTrue autentica o usuário via `POST {SUPABASE_URL}/auth/v1/token?grant_type=password` e o backend valida que o perfil em `profiles.cargo` é `'gestor'` ou `'admin'`.
- No modo de login direto por senha, a sessão renova o token automaticamente antes da expiração usando o `refresh_token` próprio.

### 3. Validação no Servidor (Hono)
- O middleware de autenticação (`server/auth.ts`) valida o token Bearer e verifica a autorização do cargo (`gestor` ou `admin`) em todas as rotas da API (`/api/*`), com cache em memória por hash SHA-256 (TTL de até 60 segundos limitado ao `exp` do JWT).
- Requisições sem token válido retornam `401 AUTH_REQUIRED` / `401 AUTH_INVALID`, e usuários com outros cargos (como operadores ou técnicos) recebem `403 GESTOR_ONLY`.
- Em modo de teste local (`SUPABASE_TEST_MODE=true`), a exigência de autenticação fica suspensa para facilitar desenvolvimento offline.

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

## Dados e FNS Oficial

O backend disponibiliza `GET /api/fns/anos`, `GET /api/fns/tipos-consulta/:ano`, `GET /api/fns/repasses`, `GET /api/fns/ufs` e `GET /api/fns/meses`. Os caminhos de origem são fixos no servidor; não há parâmetro de URL upstream. Cada chamada tem timeout, validação do envelope e logs sem query strings. Respostas de erro usam `{ "error": { "code": "...", "message": "..." } }`.

Municípios: `GET /api/fns/municipios` carrega as 27 UFs com no máximo três consultas simultâneas; `GET /api/fns/municipios/:uf` carrega uma UF validada. O backend consulta `/recursos/municipios/uf/:UF` e cruza nome normalizado e UF com o catálogo oficial do IBGE para fornecer a identidade canônica de sete dígitos; usa o catálogo IBGE como fallback quando o FNS não retorna uma lista válida. Os resultados ficam em cache por seis horas. No caso de Alfredo Marcondes/SP, o FNS retorna `350080`, mas o IBGE confirma `3500808`; `3500800` não é o código publicado pelo IBGE. Blocos: `GET /api/fns/blocos?ano=2026&coTipoConsulta=2`; as duas entradas são validadas e os resultados também são cacheados por seis horas. A tela inicia com Fundo a Fundo (`2`) e o recarrega ao trocar o ano quando disponível; blocos usam o ano e o tipo selecionados.

O endpoint detalhado `GET /recursos/consulta-detalhada/entidades` e o detalhe financeiro `GET /recursos/consulta-detalhada/detalhe-acao` são consultados pelo backend, com validação da resposta e paginação. A importação não acontece ao pesquisar: na tela de detalhes financeiros, selecione ações com identificador oficial e confirme em **Importar selecionados**. O backend valida novamente os filtros e os IDs contra o FNS, preserva a resposta de origem e grava por upsert. A exportação CSV/Excel/PDF continua sendo somente download local e não grava no banco.

A comparação mensal usa as rotas oficiais já existentes para consultar as entidades e os detalhes financeiros do FNS para o mês escolhido e o imediatamente anterior. É necessário selecionar um município parceiro autorizado. A listagem de unidades é paginada e as consultas financeiras são realizadas com concorrência limitada; cada ação é relacionada apenas pelo identificador retornado pelo FNS. Registros sem identificador estável, valor financeiro ou resposta completa não são tratados como igualdade nem como divergência confirmada. O relatório separa aumentos, reduções, valores iguais, registros novos/ausentes e itens sem dados suficientes. Totais são omitidos quando não podem ser calculados a partir dos valores oficiais disponíveis. A disponibilidade e a consistência histórica dependem do retorno atual do FNS; sem resposta histórica para um dos meses, a comparação não é concluída.

## Supabase e Segurança

O esquema compartilhado no Supabase define `fns_importacoes`, `fns_repasses`, `deputados`, `emendas_estaduais`, `baixas`, `baixa_historico`, complementos/lançamentos financeiros e auditoria. 

O backend e o frontend apontam para o mesmo projeto Supabase da plataforma MCK. Quando autenticado, o backend encaminha o token JWT do usuário para as consultas no PostgREST, garantindo que as políticas de segurança de linha (RLS) sejam aplicadas.
