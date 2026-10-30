# Auditoria da Identidade Visual MCK

Auditoria estática do código-fonte do frontend. Os valores abaixo foram identificados nos arquivos da aplicação; quando um valor vem do tema padrão do Tailwind ou depende de transparência/composição, isso é indicado explicitamente. A rota pública de referência é `/painel`.

## 1. Resumo da identidade visual

O painel combina uma base verde de marca (`#709E6C`) e verde-lima (`#C2EB99`) com superfícies escuras (`#1f2421`) na TV e superfícies brancas/cinza-claro na administração. A fonte é Lato, carregada do Google Fonts. O layout é implementado sobretudo com utilitários Tailwind diretamente nos componentes React; o CSS global é mínimo.

A tela `/painel` ocupa a viewport inteira: cabeçalho com logotipo, título, áudio e relógio; abaixo, chamada atual em destaque e uma coluna para histórico/fila a partir do breakpoint `md`. A administração usa uma navegação lateral escura, cabeçalho branco e conteúdo em cartões brancos.

## 2. Tipografia

| Item | Valor encontrado | Evidência |
|---|---|---|
| Família principal | `Lato` | `fontFamily.sans` no [tailwind.config.js](tailwind.config.js#L2); fonte carregada no [index.html](index.html#L2) |
| Alternativa/fallback | `sans-serif` genérico; a família concreta do fallback depende do navegador/sistema | [tailwind.config.js](tailwind.config.js#L2) |
| Origem | Google Fonts, CSS remoto `fonts.googleapis.com`; não foi encontrado arquivo de fonte local nem pacote de fontes | [index.html](index.html#L2); arquivos de fonte locais não encontrados |
| Pesos solicitados ao Google Fonts | 400, 700 e 900 | Parâmetro `wght@400;700;900` em [index.html](index.html#L2) |
| Pesos usados nas classes | 400 (padrão), 600 (`font-semibold`), 700 (`font-bold`) e 900 (`font-black`) | Por exemplo, [Painel.tsx](src/pages/painel/Painel.tsx#L100) e [components/ui/index.tsx](src/components/ui/index.tsx#L15) |
| Peso 600 | Usado pelo Tailwind, mas não solicitado na URL da fonte; o navegador pode sintetizar o peso a partir dos arquivos carregados | URL da fonte e usos `font-semibold` em componentes |

Não há regras próprias para `font-size` no tema nem tamanho base explícito no `body`; valem o preflight e a escala padrão Tailwind. Tamanhos recorrentes identificados:

| Uso | Classes/valor | Tamanho CSS aproximado |
|---|---|---:|
| Texto padrão | base/preflight | 16 px |
| Secundário | `text-xs`, `text-sm` | 12 px, 14 px |
| Texto médio/destaque | `text-lg`, `text-xl` | 18 px, 20 px |
| Títulos e dados | `text-2xl`, `text-3xl`, `text-4xl` | 24 px, 30 px, 36 px |
| Nome do paciente em `/painel` | `clamp(2rem, 6vw, 6rem)` | mínimo 32 px, preferencial 6vw, máximo 96 px |
| Título da chamada | `text-xl`, `sm:text-2xl` | 20 px; 24 px a partir de `sm` |
| Botões | administração: `text-xs`; áudio: `text-sm` | 12 px; 14 px |
| Informação secundária | geralmente `text-xs`/`text-sm`; horário do painel usa `text-sm` | 12 px/14 px |

O preflight do Tailwind estabelece `line-height: 1.5` como base. Utilitários de tamanho de texto usam as alturas de linha da escala Tailwind; na chamada do paciente, `leading-none` define altura 1. Textos em caixa alta aparecem em status, nome do paciente, risco e títulos da fila. O selo de modo usa `tracking-[0.2em]`, e o status principal usa `tracking-wide`. Data usa `capitalize`; hora usa `tabular-nums`. Evidência de aplicação na [tela pública](src/pages/painel/Painel.tsx#L90) e na [chamada atual](src/pages/painel/Painel.tsx#L102).

## 3. Paleta de cores

### Cores de marca e cores explícitas

| Papel | Valor exato | Origem/uso |
|---|---|---|
| Primária `brand` | `#709E6C` | Token Tailwind e fundo da chamada atual; [tailwind.config.js](tailwind.config.js#L2), [Painel.tsx](src/pages/painel/Painel.tsx#L100) |
| Verde escuro `brand-dark` | `#4f7a4b` | Token usado em texto/ações e gráficos; [tailwind.config.js](tailwind.config.js#L2) |
| Verde-lima `brand-lime` | `#C2EB99` | Token secundário/destaque, status e foco; [tailwind.config.js](tailwind.config.js#L2), [index.css](src/styles/index.css#L3) |
| Cinza `brand-gray` | `#C2C3C2` | Token usado em bordas, divisores e estados; [tailwind.config.js](tailwind.config.js#L2) |
| Tinta `brand-ink` | `#1f2421` | Texto principal e fundo escuro do painel/sidebar; [tailwind.config.js](tailwind.config.js#L2), [Painel.tsx](src/pages/painel/Painel.tsx#L87) |
| Fundo global do `body` | `#f6f7f6` | CSS global; [index.css](src/styles/index.css#L2) |
| Branco | `#fff`/`white` | Cartões administrativos, local em destaque e cabeçalho administrativo |
| Grade de gráficos | `#e5e5e5` | Linhas da grade em gráficos; [Dashboard.tsx](src/pages/admin/Dashboard.tsx#L12), [Vacinacao.tsx](src/pages/admin/Vacinacao.tsx#L7) |
| Cores suplementares do gráfico | `#2f3a33`, `#9cc48f` | Array `COLORS`; [components/ui/index.tsx](src/components/ui/index.tsx#L5) |
| Pulso da chamada | `rgba(194,235,153,.6)` no anel inicial | Keyframe global; [index.css](src/styles/index.css#L5) |

A escala `COLORS` completa declarada para gráficos é `#709E6C`, `#C2EB99`, `#4f7a4b`, `#C2C3C2`, `#2f3a33`, `#9cc48f`. Ela alimenta o gráfico de pizza do dashboard; gráficos de vacinação usam explicitamente `#709E6C` e `#C2C3C2` ([Dashboard.tsx](src/pages/admin/Dashboard.tsx#L13), [Vacinacao.tsx](src/pages/admin/Vacinacao.tsx#L8)).

### Fundos e cores por contexto

- **Página pública:** raiz com `bg-brand-ink text-white`; chamada atual com `bg-brand`; histórico/fila com `bg-white/10`; local/sala em `bg-white` com texto `brand-ink`. [Painel.tsx](src/pages/painel/Painel.tsx#L87) [Painel.tsx](src/pages/painel/Painel.tsx#L100) [Painel.tsx](src/pages/painel/Painel.tsx#L107) [Painel.tsx](src/pages/painel/Painel.tsx#L110)
- **Administração:** fundo do `body` `#f6f7f6`; cabeçalho administrativo e cartões `white`; sidebar `brand-ink`. [index.css](src/styles/index.css#L2) [AdminLayout.tsx](src/layouts/AdminLayout.tsx#L11) [components/ui/index.tsx](src/components/ui/index.tsx#L9)
- **Texto principal:** `brand-ink` (`#1f2421`) nos componentes que definem a cor explicitamente; texto branco na área pública. Texto secundário administrativo usa utilitários padrão `neutral-500`/`neutral-600`.
- **Histórico:** cartões translúcidos `white/10`, texto principal branco, metadados `white/70`, status `brand-lime`.
- **Chamada atual:** fundo `brand`; texto branco; status em cápsula `brand-lime` com texto `brand-ink`; local/sala em cápsula branca.
- **Estados de status administrativos:** aguardando = `neutral-100`/`neutral-700`; chamando = `brand-lime`/`brand-ink`; chamada novamente = `amber-100`/`amber-800`; em atendimento = `brand/15`/`brand-dark`; finalizado = `brand-gray/40`/`neutral-700`. [components/ui/index.tsx](src/components/ui/index.tsx#L11)
- **Status de enfermagem:** observação = `brand-lime`; em andamento = `brand/15`; aguardando = `neutral-100`; finalizado = `brand-gray/40`. [ListaAtendimentos.tsx](src/pages/admin/enfermagem/ListaAtendimentos.tsx#L24)
- **Erro/risco:** mensagens administrativas usam `red-700`; exclusão usa `red-700` com hover `red-800`; alerta de indisponibilidade pública usa `amber-300/60`, `amber-500/10` e `amber-100`. [Vinculos.tsx](src/pages/admin/Vinculos.tsx#L123) [Vinculos.tsx](src/pages/admin/Vinculos.tsx#L130) [Painel.tsx](src/pages/painel/Painel.tsx#L99)

### Cores fornecidas pelo tema padrão Tailwind

O `tailwind.config.js` estende cores de marca sem substituir a paleta `neutral`, `amber`, `red` ou cores básicas. Portanto, as classes abaixo usam os valores padrão Tailwind 3.4, não tokens MCK próprios: `neutral-50 #fafafa`, `neutral-100 #f5f5f5`, `neutral-300 #d4d4d4`, `neutral-400 #a3a3a3`, `neutral-500 #737373`, `neutral-600 #525252`, `neutral-700 #404040`; `amber-100 #fef3c7`, `amber-200 #fde68a`, `amber-300 #fcd34d`, `amber-500 #f59e0b`, `amber-700 #b45309`, `amber-800 #92400e`; `red-200 #fecaca`, `red-700 #b91c1c`, `red-800 #991b1b`. As classes correspondentes estão nos componentes citados acima. Esses valores são padrão do framework, não definições hex literais locais.

Classes com opacidade, como `brand/10`, `brand/15`, `brand-gray/60`, `white/70` e `black/40`, usam a cor base com alpha; a aparência final depende do fundo sob elas. Não são cores sólidas independentes e não devem ser convertidas para HEX sem especificar/compor sobre um fundo. As opacidades são parte das classes encontradas no JSX.

### Interação e acessibilidade

- Foco visível global: contorno sólido `3px` `#C2EB99`, afastamento `2px`. [index.css](src/styles/index.css#L3)
- Botão administrativo compartilhado: contorno `brand`; hover aplica fundo `brand` e texto branco; disabled aplica opacidade `0.4`. [components/ui/index.tsx](src/components/ui/index.tsx#L15)
- Botão de áudio: borda/texto `brand-lime`; disabled usa cursor bloqueado e opacidade `0.6`. Não há hover próprio declarado. [Painel.tsx](src/pages/painel/Painel.tsx#L94)
- Navegação lateral: ativo usa fundo `brand`, inativo texto `white/75` e hover `white/10`; links “em breve” usam `white/40`. [AdminLayout.tsx](src/layouts/AdminLayout.tsx#L13)
- O CSS global desativa as animações da chamada para `prefers-reduced-motion: reduce`. [index.css](src/styles/index.css#L7)

Não existe tema claro/escuro com alternância ou conjunto de variáveis CSS. O painel TV é escuro por classe; a administração tem corpo claro e sidebar escura.

## 4. Tokens de design

Não há custom properties CSS (`--...`) definidas no código-fonte. Os tokens da marca existem como extensão do tema Tailwind em [tailwind.config.js](tailwind.config.js#L2). A escala abaixo registra espaçamentos vistos nos componentes; o Tailwind usa incrementos de `0.25rem` (4 px): `gap-1` 4 px, `gap-2` 8 px, `gap-3` 12 px, `gap-4` 16 px, `p-4` 16 px, `p-5` 20 px, `px-6` 24 px, `p-6` 24 px e `px-10` 40 px.

| Token/uso | Valor identificado |
|---|---|
| Marca base | `#709E6C` |
| Marca escura | `#4f7a4b` |
| Destaque lima | `#C2EB99` |
| Cinza de borda | `#C2C3C2` |
| Tinta escura | `#1f2421` |
| Fundo global | `#f6f7f6` |
| Raio padrão de card admin | `rounded-lg` = 8 px |
| Raio de botão/input admin | `rounded-md` = 6 px |
| Raio do card atual em `/painel` | `rounded-2xl` = 16 px; em `sm`, `rounded-3xl` = 24 px |
| Sombra de modal | `shadow-xl` Tailwind; sem valor customizado no projeto |
| Espaçamento recorrente | 12 px (`gap-3`), 16 px (`gap-4`/`p-4`), 20 px (`p-5`) |
| Foco visível | contorno 3 px lima, offset 2 px |

Os raios acima são correspondências dos utilitários para o tema padrão Tailwind, não declarações próprias de CSS.

## 5. Layout e espaçamentos

### Tela pública `/painel`

- Raiz em `h-screen`, grade com linhas `auto 1fr`, `overflow-hidden`; o conteúdo inferior rola verticalmente. Não há container central nem largura máxima global. [Painel.tsx](src/pages/painel/Painel.tsx#L87)
- Cabeçalho flexível e com quebra de linha: padding `px-4 py-3`, em `sm` `px-6`, em `lg` `px-10 lg:py-5`; elementos separados por `gap-3`, controles por `gap-3` ou `sm:gap-6`. [Painel.tsx](src/pages/painel/Painel.tsx#L88)
- Logo reservado em `w-44 h-12` (176 × 48 px), aumenta em `sm` para `w-48 h-14` (192 × 56 px); imagem `object-contain`. [AdminLayout.tsx](src/layouts/AdminLayout.tsx#L6)
- Corpo usa `gap-4`, padding horizontal `px-4`, `md:px-6`, `lg:px-10`; bottom padding 16 px e em `lg` 32 px. [Painel.tsx](src/pages/painel/Painel.tsx#L98)
- Mobile: uma coluna; desktop: coluna principal flexível e sidebar de 20 rem (320 px) em `md`, 26 rem (416 px) em `lg`. A chamada ocupa no mínimo 20 rem (320 px) de altura. [Painel.tsx](src/pages/painel/Painel.tsx#L98) [Painel.tsx](src/pages/painel/Painel.tsx#L100)
- Chamada atual centralizada em eixo horizontal/vertical, com alinhamento central e padding `px-3 py-6`; em `sm`, padding horizontal 24 px. O raio muda de 16 px para 24 px em `sm`. [Painel.tsx](src/pages/painel/Painel.tsx#L100)
- Histórico em lista vertical com `space-y-3`; cartões `p-4`; fila com `space-y-2`. [Painel.tsx](src/pages/painel/Painel.tsx#L110) [Painel.tsx](src/pages/painel/Painel.tsx#L112)
- Área de chamada sem proporção fixa: ocupa o espaço flexível disponível; sidebar tem largura fixa em breakpoints maiores.

### Administração

- Shell `lg:flex`; sidebar fixa de 16 rem (256 px), em telas menores posicionada fixa fora da viewport e aberta/fechada por estado. [AdminLayout.tsx](src/layouts/AdminLayout.tsx#L11)
- Cabeçalho administrativo `sticky top-0`, padding `px-4 py-3`; conteúdo `p-4`, passando para `md:p-6`. [AdminLayout.tsx](src/layouts/AdminLayout.tsx#L18) [AdminLayout.tsx](src/layouts/AdminLayout.tsx#L23)
- Cartões e seções: borda `brand-gray/60`, fundo branco, raio 8 px e `p-4`; alguns usam `sm:p-5`. [components/ui/index.tsx](src/components/ui/index.tsx#L9) [Vinculos.tsx](src/pages/admin/Vinculos.tsx#L10)
- Grid de dashboard: 1 coluna por padrão, 2 em `sm`, até 5 em `xl`; gráficos em 1 coluna por padrão e 3 em `lg`. [Dashboard.tsx](src/pages/admin/Dashboard.tsx#L10)
- Unidades: 1 coluna por padrão, 2 em `md`, 3 em `xl`. [Unidades.tsx](src/pages/admin/Unidades.tsx#L69)
- Formulários empilham campos no mobile e passam a duas colunas em `sm` em alguns fluxos; configuração de salas/dispositivos usa linha em `sm`; etapas usam duas colunas em `xl`. [Vinculos.tsx](src/pages/admin/Vinculos.tsx#L135) [Atendimento.tsx](src/pages/admin/enfermagem/Atendimento.tsx#L107)
- Modais usam overlay `black/40`, centralização em grid, padding externo `p-4`, fundo branco, raio 8 px e `shadow-xl`. Larguras comuns: `max-w-sm` (24 rem), `max-w-md` (28 rem), `max-w-xl` (36 rem) e `max-w-2xl` (42 rem). [Chamadas.tsx](src/pages/admin/Chamadas.tsx#L29) [Unidades.tsx](src/pages/admin/Unidades.tsx#L87)

### Breakpoints

Não há breakpoints customizados no `tailwind.config.js`; aplicam-se os padrões Tailwind 3.4: `sm` 640 px, `md` 768 px, `lg` 1024 px, `xl` 1280 px e `2xl` 1536 px. No `/painel`, `sm` altera paddings/tipografia/raios, `md` abre a coluna do histórico e `lg` aumenta essa coluna e os espaçamentos. Na administração, `lg` fixa a sidebar e `md`/`xl` expandem conteúdo em grids.

## 6. Componentes visuais

| Componente | Identidade e estados | Arquivos responsáveis |
|---|---|---|
| Logotipo | Imagem `logobranca.png`, dimensões responsivas 176×48 e 192×56 px; `object-contain`. O mesmo componente é renderizado no painel TV e sidebar escura. Favicon separado `logo-mck.png`. | [AdminLayout.tsx](src/layouts/AdminLayout.tsx#L4), [index.html](index.html#L2) |
| Cabeçalho público | Logo, “Painel”, selo `Modo real`/`Modo demo`, controle de áudio, mensagem de status, relógio e data. Layout flexível com quebra. | [Painel.tsx](src/pages/painel/Painel.tsx#L88) |
| Chamada atual | Card verde, centralizado, animação de entrada; status em cápsula lima; risco opcional; paciente em caixa alta com fonte responsiva; horário opcional; local/sala em cápsula branca; tipo e profissional opcionais. | [Painel.tsx](src/pages/painel/Painel.tsx#L100) |
| Nova chamada | Mudança da chave do evento remonta a área principal; `anim-chamada` dura 0,7 s e `anim-pulse` 2 s quando está chamando. O pulso usa a cor lime com alpha; animação respeita redução de movimento. | [Painel.tsx](src/pages/painel/Painel.tsx#L100), [index.css](src/styles/index.css#L4) |
| Histórico | Título lime 24 px; cards translúcidos, paciente 24 px negrito, sala/horário 18 px, status 14 px lime. | [Painel.tsx](src/pages/painel/Painel.tsx#L109) |
| Próximos atendimentos | Título lime 18 px em caixa alta; itens em fundo branco/10, nome em 18 px, posição numérica lime. Estado vazio “Nenhum paciente aguardando”. | [Painel.tsx](src/pages/painel/Painel.tsx#L112) |
| Indicadores de status admin | `StatusBadge`, cápsula arredondada (`rounded-full`), padding horizontal 10 px, vertical 2 px e fonte 12 px. Cores variam por status. | [components/ui/index.tsx](src/components/ui/index.tsx#L11) |
| Botões admin | Utilitário compartilhado com borda da marca, texto `brand-dark`, 12 px negrito, raio 6 px; hover preenche verde e texto branco; disabled 40% opaco. Ações destrutivas têm vermelho específico. | [components/ui/index.tsx](src/components/ui/index.tsx#L15), [Vinculos.tsx](src/pages/admin/Vinculos.tsx#L130) |
| Áudio | Botão delineado lime, 14 px, ícone 18 px; estados ativo, ativando, erro, indisponível e desativado comunicados em texto `text-xs`. | [Painel.tsx](src/pages/painel/Painel.tsx#L94) |
| Menu lateral | Sidebar `brand-ink`, 256 px, logo, links com ícones; ativo verde, hover translúcido, itens indisponíveis a 40% de branco. Em mobile abre como drawer com overlay preto/40. | [AdminLayout.tsx](src/layouts/AdminLayout.tsx#L11) |
| Cabeçalho admin | Sticky branco, divisor inferior `brand-gray/60`, breadcrumb e selo “Administrador (demo)”. | [AdminLayout.tsx](src/layouts/AdminLayout.tsx#L18) |
| Formulários | Inputs/selects geralmente brancos, borda `brand-gray`, raio 6 px, padding `px-3 py-2`, fonte 14 px; algumas declarações são constantes locais de classe. | [Vinculos.tsx](src/pages/admin/Vinculos.tsx#L7), [Chamadas.tsx](src/pages/admin/Chamadas.tsx#L26) |
| Modais | Overlay centralizado preto/40; card branco e `shadow-xl`; conteúdo rolável para formulários/listas maiores; dialogs com papéis ARIA. | [Chamadas.tsx](src/pages/admin/Chamadas.tsx#L29), [Unidades.tsx](src/pages/admin/Unidades.tsx#L87) |
| Estado vazio | `Empty`: ícone `Inbox`, texto cinza, coluna central, espaçamento 8 px e padding vertical 48 px. O painel público não tem cartão de histórico vazio; a fila tem mensagem textual. | [components/ui/index.tsx](src/components/ui/index.tsx#L8), [Painel.tsx](src/pages/painel/Painel.tsx#L112) |
| Carregamento | Spinner de 32×32 px, borda 4 px cinza com topo verde, centralizado numa área de 192 px de altura. | [components/ui/index.tsx](src/components/ui/index.tsx#L7) |
| Erro público | Banner âmbar com borda, fundo translúcido, texto âmbar; só aparece quando a fonte real está indisponível com erro. | [Painel.tsx](src/pages/painel/Painel.tsx#L99) |
| Administração/configuração | Etapas em cards brancos, números em círculos verdes, feedback sucesso verde/erro vermelho, modal de confirmação e controles de ativação. | [Vinculos.tsx](src/pages/admin/Vinculos.tsx#L10), [Vinculos.tsx](src/pages/admin/Vinculos.tsx#L119) |

O ícone `Inbox` vem de `lucide-react`; os controles de áudio usam `Volume2`/`VolumeX`. Navegação e administração importam ícones da mesma biblioteca. Os PNG de logo são assets locais; não foram encontrados assets locais de fonte.

## 7. Responsividade

| Breakpoint padrão | Valor | Efeito observado |
|---|---:|---|
| `sm` | 640 px | Aumenta dimensões do logo, paddings e tipografia da chamada; troca algumas linhas de formulário para horizontal. |
| `md` | 768 px | `/painel` vira duas colunas, com histórico de 320 px; conteúdo administrativo ganha padding de 24 px e alguns grids viram duas colunas. |
| `lg` | 1024 px | Sidebar administrativa passa a fixa; painel usa sidebar de 416 px e espaçamentos maiores; gráficos podem usar três colunas. |
| `xl` | 1280 px | Grids administrativos passam a três ou cinco colunas; configuração e enfermagem ganham layouts de duas colunas. |
| `2xl` | 1536 px | Nenhuma regra visual própria identificada. |

Em telas pequenas, a área pública permanece dentro da altura da viewport e a região de conteúdo rola; chamada e sidebar ficam empilhadas. A administração transforma a sidebar em drawer com overlay. Não foram encontrados breakpoints CSS manuais: as mudanças são utilitários responsivos Tailwind.

## 8. Bibliotecas e tecnologias

- **Frontend:** React 18 com TypeScript; aplicação montada em `ReactDOM` e roteada por `BrowserRouter`. [main.tsx](src/main.tsx#L1) [routes/index.tsx](src/routes/index.tsx#L1)
- **Build:** Vite. Scripts e dependências em [package.json](package.json#L1); configuração de plugin em `vite.config.ts`.
- **Estilos:** Tailwind CSS 3.4 via diretivas `@tailwind` no CSS global e plugin PostCSS. [index.css](src/styles/index.css#L1) [postcss.config.js](postcss.config.js#L1) [tailwind.config.js](tailwind.config.js#L1)
- **Fonte:** Google Fonts Lato, importada no HTML. Não há dependência de tipografia no `package.json` nem arquivo de fonte local. [index.html](index.html#L2)
- **Ícones:** `lucide-react`, importado e usado no painel, layout, componentes e páginas admin; não é apenas uma dependência declarada. [Painel.tsx](src/pages/painel/Painel.tsx#L2) [components/ui/index.tsx](src/components/ui/index.tsx#L3)
- **Gráficos:** `recharts`, efetivamente usado pelo dashboard e telas de vacinação. [components/ui/index.tsx](src/components/ui/index.tsx#L2) [Dashboard.tsx](src/pages/admin/Dashboard.tsx#L1)
- **Biblioteca de componentes:** não foi identificado kit de UI; os componentes reutilizáveis são locais, em `src/components/ui/index.tsx`.
- **CSS Modules/styled-components:** não encontrados. Só há um CSS de fonte em `src/styles/index.css`; buscas no código não encontraram `style=`, `<style>`, CSS Modules, styled-components ou custom properties CSS.

### Sobreposições e precedência

O CSS global aplica `font-sans`, fundo `#f6f7f6` e `text-brand-ink` ao `body`. O componente raiz de `/painel` define explicitamente `bg-brand-ink text-white`, portanto a área visível dessa rota é escura, não o fundo global claro. Na administração, o `body` permanece claro; o cabeçalho e cartões brancos e a sidebar escura são definidos localmente. Utilitários de texto/fundo nos elementos descendentes controlam esses elementos em vez da cor herdada do `body`. Não há uma regra CSS concorrente mais específica observada nas folhas-fonte.

## 9. Arquivos de referência

- [index.html](index.html#L2): idioma, título, favicon e import da fonte Lato.
- [tailwind.config.js](tailwind.config.js#L1): fonte `sans` e cores de marca.
- [src/styles/index.css](src/styles/index.css#L1): diretivas Tailwind, fundo global, foco e animações.
- [src/pages/painel/Painel.tsx](src/pages/painel/Painel.tsx#L87): layout e aparência da rota pública `/painel`.
- [src/layouts/AdminLayout.tsx](src/layouts/AdminLayout.tsx#L4): logo, sidebar, navegação e cabeçalho admin.
- [src/components/ui/index.tsx](src/components/ui/index.tsx#L5): paleta de gráficos e componentes reutilizáveis.
- [src/pages/admin/Chamadas.tsx](src/pages/admin/Chamadas.tsx#L26): tela de chamadas, filtros, ações e modais.
- [src/pages/admin/Vinculos.tsx](src/pages/admin/Vinculos.tsx#L7): formulário e configuração do painel.
- [src/pages/admin/Unidades.tsx](src/pages/admin/Unidades.tsx#L69): cards, formulário e modal de unidades.
- [src/pages/admin/Dashboard.tsx](src/pages/admin/Dashboard.tsx#L10): composição e gráficos do dashboard.
- [src/pages/admin/enfermagem/ListaAtendimentos.tsx](src/pages/admin/enfermagem/ListaAtendimentos.tsx#L24): cores de status de enfermagem.
- [postcss.config.js](postcss.config.js#L1) e [package.json](package.json#L1): pipeline e dependências.

## 10. Referência rápida

| Elemento | Valor encontrado | Arquivo de origem |
|---|---|---|
| Fonte principal | `Lato`, fallback `sans-serif`; pesos baixados 400/700/900 | [index.html](index.html#L2), [tailwind.config.js](tailwind.config.js#L2) |
| Cor primária | `#709E6C` | [tailwind.config.js](tailwind.config.js#L2) |
| Cor secundária/destaque | `#C2EB99` | [tailwind.config.js](tailwind.config.js#L2) |
| Fundo principal global | `#f6f7f6` | [index.css](src/styles/index.css#L2) |
| Fundo do painel público | `#1f2421` | [Painel.tsx](src/pages/painel/Painel.tsx#L87), token em [tailwind.config.js](tailwind.config.js#L2) |
| Fundo da chamada atual | `#709E6C` | [Painel.tsx](src/pages/painel/Painel.tsx#L100) |
| Texto principal | `#1f2421` (admin); branco (`#fff`) na área pública | [tailwind.config.js](tailwind.config.js#L2), [Painel.tsx](src/pages/painel/Painel.tsx#L87) |
| Texto secundário | `neutral-500 #737373` e `neutral-600 #525252` (padrão Tailwind) | [components/ui/index.tsx](src/components/ui/index.tsx#L8) |
| Bordas | `brand-gray #C2C3C2`, com uso comum `/60` | [tailwind.config.js](tailwind.config.js#L2), [components/ui/index.tsx](src/components/ui/index.tsx#L9) |
| Raio dos cards | `rounded-lg` = 8 px nos cards admin; card atual 16 px, 24 px em `sm` | [components/ui/index.tsx](src/components/ui/index.tsx#L9), [Painel.tsx](src/pages/painel/Painel.tsx#L100) |
| Espaçamento padrão observado | 12 px (`gap-3`) e 16 px (`gap-4`/`p-4`); escala base em passos de 4 px | [Painel.tsx](src/pages/painel/Painel.tsx#L98), [components/ui/index.tsx](src/components/ui/index.tsx#L9) |
| Breakpoints | Tailwind padrão: `sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536 px | [tailwind.config.js](tailwind.config.js#L1), usos em [Painel.tsx](src/pages/painel/Painel.tsx#L98) |

## 11. Instruções para replicar

1. Carregue Lato do Google Fonts nos pesos 400, 700 e 900 e defina a família `Lato, sans-serif`. Se forem reproduzidos os usos `font-semibold`, inclua também peso 600 no carregamento para não depender de síntese do navegador; esse peso adicional é uma recomendação para replicação, não um peso atualmente baixado pelo projeto.
2. Reproduza os cinco tokens `brand`, `dark`, `lime`, `gray` e `ink` com os HEX da seção de paleta. Preserve separadamente o fundo global `#f6f7f6` e os fundos específicos da aplicação.
3. Na rota pública, use uma raiz de viewport com duas linhas (`auto 1fr`), fundo `ink`, texto branco e conteúdo rolável. Mantenha a chamada atual em verde, centralizada, com o paciente em caixa alta e tamanho limitado por `clamp(2rem, 6vw, 6rem)`.
4. A partir de 768 px, apresente o histórico em uma coluna lateral de 320 px; a partir de 1024 px, amplie para 416 px. Mantenha a chamada com mínimo de 320 px de altura.
5. Use cartões admin brancos, borda `brand-gray/60`, raio 8 px e padding 16 px; botões/inputs com raio 6 px. Modais são brancos, `shadow-xl`, raio 8 px e overlay preto com 40% de opacidade.
6. Reproduza estados e animações sem converter as classes com alpha em cores opacas inventadas. A chamada usa a animação de entrada de 0,7 s e o pulso lima de 2 s, respeitando `prefers-reduced-motion`.
7. Use ícones Lucide para manter o estilo linear existente. O uso de Recharts restringe-se a gráficos administrativos; não é necessário para replicar a tela pública estática.

### Tokens CSS reutilizáveis

A nomenclatura abaixo é conveniente para o projeto de destino; os valores são os efetivamente encontrados na configuração/código de origem. O código original não declara estas custom properties.

```css
:root {
  --mck-font-sans: "Lato", sans-serif;

  --mck-brand: #709E6C;
  --mck-brand-dark: #4f7a4b;
  --mck-brand-lime: #C2EB99;
  --mck-brand-gray: #C2C3C2;
  --mck-brand-ink: #1f2421;

  --mck-page-background: #f6f7f6;
  --mck-white: #ffffff;
  --mck-chart-grid: #e5e5e5;

  --mck-focus-outline: #C2EB99;
  --mck-call-pulse: rgba(194, 235, 153, 0.6);
}
```

## 12. Pontos não determinados

- O aspecto final de cores com alpha depende do fundo real e do ambiente de exibição; por isso os tokens semitransparentes foram mantidos como classes/opacidades, não convertidos em HEX.
- A aparência visual exata do logotipo depende dos arquivos PNG locais. O código determina arquivo, dimensão e `object-contain`, mas esta auditoria estática não mede as cores/pixels internos da imagem.
- `font-semibold` (600) é solicitado no CSS gerado, mas o link do Google Fonts só baixa 400, 700 e 900. O navegador pode sintetizar 600; o resultado varia conforme plataforma.
- Valores como `shadow-xl`, espaçamentos e cores `neutral`/`amber`/`red` dependem da escala padrão Tailwind 3.4 e não de tokens próprios do MCK.
- Não há valor de largura máxima geral, largura mínima global de container, altura fixa do cabeçalho, dimensões fixas dos cards ou tema escuro alternável definidos no código.
- A análise é estática do código-fonte. Estados reais de dados, fontes de sistema, renderização de gráficos e diferenças entre navegadores/displays não podem ser comprovados apenas pelas classes declaradas.
