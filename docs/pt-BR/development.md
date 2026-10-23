# Desenvolvimento e qualidade

[English](../development.md) · [Início da documentação](./README.md)

## Ambiente e comandos

A execução nativa do bot/API suporta somente Windows e Linux. Os pontos de entrada recusam
outros sistemas antes de carregar configuração, acessar o banco ou iniciar gravações.

Use Node.js 22.23.2 e npm 10.9.8, fixados em `package.json` e na CI. Docker prepara esses runtimes,
Python 3.12.14 e o build controlado LGPL do FFmpeg. A execução nativa exige FFmpeg com `libopus`:
configure `FFMPEG_PATH` absoluto ou disponibilize `ffmpeg`/`ffmpeg.exe` no `PATH`. O bot o valida
antes de conectar ao Discord. A licença e os codecs do FFmpeg nativo são responsabilidade do desenvolvedor.

Instale as dependências fixadas na raiz:

```sh
npm ci
```

Prepare `.env` pelo [fluxo de instalação](./installation.md). Não o versione. Para banco nativo,
troque `DATABASE_URL` gerada para Compose de `postgres:5432` pelo endereço do host e `POSTGRES_PORT`
publicado.

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Bot supervisionado em desenvolvimento |
| `npm run dev:api:local` | API do dashboard em desenvolvimento, modo local |
| `npm run dev:api:public` | API do dashboard em desenvolvimento, modo público |
| `npm run dev:dashboard` | Dashboard Vite em `127.0.0.1:5173`, com proxy de `/api` para `127.0.0.1:8787` |
| `npm run build` | Compilar servidor e dashboard |
| `npm start` | Bot supervisionado compilado |
| `npm run api:local` | API compilada do dashboard, modo local |
| `npm run api:public` | API compilada do dashboard, modo público |

Execute bot, API e Vite em terminais separados conforme necessário. Vite é a origem do navegador
no desenvolvimento frontend, enquanto `PUBLIC_BASE_URL` determina a origem do callback Discord;
registre esse callback exato na aplicação Discord.

O script seleciona o modo de acesso por argumento `--access-mode local` ou `--access-mode public`.
O modo não é lido do `.env`; uma entrada antiga de `DASHBOARD_ACCESS_MODE` é ignorada. Sem argumento,
a API assume o modo local. No Docker, o launcher seleciona o comando correspondente da API.

`DASHBOARD_HOST` define o listener da API nativa e o endereço de publicação da porta do dashboard no
Docker. O listener interno do contêiner permanece em `0.0.0.0:8787`. Alterar o host não altera
as regras de autenticação, os cabeçalhos `Host` ou as origens aceitas pelo modo selecionado.
Use `DASHBOARD_HOST=127.0.0.1` ao executar o modo local, que dispensa senha. Ao alternar os scripts,
verifique esse valor: ele é compartilhado entre os modos.

Os scripts npm do modo público exigem `PUBLIC_BASE_URL` com origem HTTPS e `DASHBOARD_HOST` que aceite
conexões externas, como `0.0.0.0`. Eles não iniciam o Caddy nem configuram certificados: prepare o
proxy HTTPS antes de acessar esse modo. O launcher Docker público fornece o Caddy automaticamente.

Os clientes de IA local usam `http://ollama:11434` e `http://faster-whisper:8000`. Esses nomes resolvem
dentro do Compose e a pilha base não publica as portas no host. IA local nativa exige configuração
deliberada de rede e resolução de nomes; apenas iniciar serviços privados em Compose não torna
essas URLs acessíveis ao processo nativo. O fluxo Compose fornece a rede compartilhada automaticamente.

## Estrutura e convenções do projeto

O repositório usa npm workspaces com uma instalação e um `package-lock.json` na raiz.
O `package.json` da raiz coordena os comandos; cada aplicação e o pacote compartilhado
possuem seus próprios comandos, dependências, configuração TypeScript e testes.

```text
apps/
  bot/          src/ e tests/: Discord, gravação e execução do processamento
  api/          src/ e tests/: API HTTP, autenticação e administração
  dashboard/    src/, tests/ e public/: interface React
packages/
  shared/       src/ e tests/: persistência, modelos e contratos compartilhados
tests/
  integration/  contratos que atravessam aplicações
  repository/   Docker, launchers, CI e estrutura do repositório
services/
  faster-whisper/  serviço Python de transcrição
scripts/        ferramentas de desenvolvimento, avaliação e qualidade
```

As aplicações Node consomem `summyz-community-shared` por subcaminhos explícitos.
O pacote compartilhado não importa aplicações e uma aplicação não importa outra.
Contratos de manifestos, estados de processamento e resultados usados pela persistência
ficam no pacote compartilhado; captura de áudio e execução das etapas ficam no bot.
Os builds TypeScript usam referências entre projetos e geram `dist/` dentro de cada workspace.
Os comandos de desenvolvimento usam a condição `development` para carregar fontes TypeScript.
A API continua servindo o dashboard compilado no mesmo serviço Docker `dashboard`.

Testes pertencem ao workspace responsável pelo código, inclusive integrações PostgreSQL.
Somente verificações entre aplicações e do repositório ficam em `tests/` na raiz.
Helpers de teste não entram nos builds de produção nem na medição de código de produção.
O projeto de apresentação em `media/presentation` mantém sua configuração independente.

Siga [AGENTS.md](../../AGENTS.md). TypeScript é estrito; valide dados externos, modele estados
opcionais e trate rejeições e ciclos de vida explicitamente. Use identificadores de código/banco
e comentários em inglês. Segredos, cabeçalhos de autorização e áudio não devem aparecer nos logs;
erros Discord não podem expor detalhes internos. Há testes que falham quando credenciais vazam nos logs.

## TDD e verificações locais de qualidade

Para mudanças de lógica, use Vitest em red-green-refactor: escreva o teste falhando, implemente o
mínimo e refatore. Isole integrações substituíveis em fronteiras reais. Smoke tests de IA local
são separados da suíte rápida; interações manuais reais no Discord não são critérios automatizados.

```sh
npm run check
npm run security:audit
```

`check` executa Biome, a checagem de tipos de todo o monorepo, a cobertura agregada do backend,
a cobertura do dashboard e os testes unitários Python. Toda aplicação (bot, API, shared e
dashboard) precisa de no mínimo 85% de linhas, statements, branches e funções. No backend, a
cobertura é medida em conjunto: um teste do bot que executa código do shared conta para o shared.
O relatório agregado fica em `artifacts/coverage/server/` e o do dashboard em
`artifacts/reports/dashboard/coverage/`.

| Comando na raiz | Verificação |
| --- | --- |
| `npm test` | Todos os testes rápidos dos quatro workspaces, integrações, repositório e Python |
| `npm run test:bot` / `npm run test:api` | Testes do bot / API |
| `npm run test:dashboard` / `npm run test:shared` | Testes do dashboard / pacote compartilhado |
| `npm run test:integration` / `npm run test:repository` | Testes entre aplicações / do repositório |
| `npm run test:coverage` | Cobertura agregada do backend com mínimo de 85% por aplicação, cobertura do dashboard e testes unitários Python |
| `npm run test:coverage:workspaces` | Relatórios de cobertura isolados de cada workspace, sem limite mínimo |
| `npm run test:coverage:ci` | Cobertura agregada do backend, integrações e testes do repositório |
| `npm run test:dashboard:coverage` | Cobertura do dashboard |
| `npm run test:python` / `npm run test:python:coverage` | Testes unitários Python / cobertura Python |
| `npm run typecheck` | Tipos de todos os workspaces, scripts e testes |
| `npm run build` | Build das três aplicações e do pacote compartilhado |
| `npm run lint` / `npm run format:check` | Lint / formatação do monorepo |
| `npm run format` | Aplicar formatação |

Também é possível executar comandos diretamente em um workspace, por exemplo:

```sh
npm test --workspace apps/bot
npm run test:coverage --workspace packages/shared
npm run build --workspace apps/api
```

Os relatórios de cobertura de um workspace isolado ficam em `artifacts/reports/<workspace>/coverage/`
e não aplicam limite mínimo; o limite vale para a medição agregada.

O build de cada aplicação Node compila primeiro o pacote compartilhado quando necessário.
Os comandos nativos de execução de bot/API preservam a raiz como diretório de trabalho,
onde permanecem `.env` e os caminhos relativos de dados.

`npm test` não inicia serviços externos. Integrações PostgreSQL usam `POSTGRES_TEST_URL` e são
ignoradas quando ela não está configurada. Inferência real local permanece na suíte separada
`npm run test:smoke:local-ai`; os comandos globais rápidos não a executam.
Os testes Python exigem Python 3.12 e as dependências do serviço e de testes instaladas;
a imagem de testes Python fornece esse ambiente. Cobertura por domínio e cobertura alterada
também são verificadas pela CI.

### Atualização dos nomes de configuração

Na atualização para workspaces, renomeie em seu `.env` e nas configurações de implantação:
`WEB_HOST` para `DASHBOARD_HOST`, `WEB_PORT` para `DASHBOARD_PORT` e `WEB_STATIC_DIR` para
`DASHBOARD_STATIC_DIR`. Os nomes anteriores não são mais lidos. O diretório estático padrão
agora é `apps/dashboard/dist`, relativo à raiz. Scripts npm e relatórios antes chamados
`web` passam a usar `dashboard`, como `dev:dashboard` e `test:dashboard`.
Nenhum arquivo `.env` existente é alterado automaticamente pela reorganização.

## Testes de integração PostgreSQL

As suítes locais usam `POSTGRES_TEST_URL` e são ignoradas quando ela não existe. Aponte-a para um
banco PostgreSQL dedicado e descartável, nunca para a instalação em uso ou um backup: testes de
migração recriam schema e fixtures. A CI fornece PostgreSQL 18.4 real e executa essas suítes.

Para reproduzir a configuração mais ampla de cobertura do servidor na CI com esse banco configurado:

```sh
npm run test:coverage:ci
```

## Smoke de IA local e benchmark de transcrição

Com a pilha Docker configurada, execute a suíte isolada na rede privada:

```sh
docker compose --profile smoke run --rm smoke
```

Ela executa inferência local real, baixa modelos pequenos e pode demorar na primeira execução.
`npm run test:smoke:local-ai` é a entrada Vitest isolada; Compose fornece rede e runtime.
Escolha os overlays apropriados ao testar aceleração explicitamente. A inferência CI usa CPU;
construir o pacote CUDA não valida uma GPU física.

O CI obrigatório mantém `qwen3:1.7b` para validar download, execução do provedor e JSON
estruturado. Os testes rápidos verificam contratos, responsáveis, prazos e apresentação com
entradas determinísticas. Esses testes não comprovam a qualidade da interpretação do modelo.

### Avaliação semântica sob demanda

`eval:summary` executa o gerador real de resumos com um perfil explicitamente escolhido. A
suíte usa transcrições sintéticas versionadas em `scripts/evaluation/summary-cases.ts`, sem
áudios ou dados de calls. Não cria calls no Dashboard nem publica no Discord. O banco é aberto
em uma transação somente leitura para obter o perfil e, quando necessário, a credencial
configurada do OpenRouter; a conexão é encerrada antes da inferência. Não executa migrations.

Com a instalação e os serviços do provedor já disponíveis, liste os identificadores dos perfis:

```sh
docker compose --profile evaluation run --rm --build summary-evaluation npm run eval:summary -- --list-profiles
```

Escolha o identificador exibido e execute a suíte. Substitua `ID_DO_PERFIL` pelo valor real:

```sh
docker compose --profile evaluation run --rm --build summary-evaluation npm run eval:summary -- --profile-id ID_DO_PERFIL --runs 3
```

O modelo, os prompts de extração/consolidação, o idioma, os parâmetros de geração e o limite
de fragmentação vêm do perfil. Para perfis locais com dispositivo `auto`, acrescente
`--device cpu` ou `--device gpu`; um dispositivo fixado no perfil não pode ser substituído.
Use os overlays da instalação ao executar em GPU. A suíte não instala modelos nem inicia os
serviços de IA. Perfis externos fazem chamadas ao provedor configurado e podem gerar custos;
essas execuções não entram no histórico de custos de uma call.

Para investigar um cenário, acrescente `--case contextual-assignments`; a opção pode ser
repetida. `--help` lista os casos e as opções. Fora do Docker, a mesma entrada é
`npm run eval:summary -- --profile-id ID_DO_PERFIL`, desde que o banco e o provedor estejam
acessíveis pelos endereços da instalação. As transcrições sintéticas são em pt-BR; quando o
idioma do perfil e da transcrição são `auto`, esse é o idioma usado na avaliação.

Os casos incluem compromissos em primeira pessoa, confirmação em outra fala, múltiplos
responsáveis, pessoa ausente da call, tarefa sem responsável, ausência de compromisso,
dias da semana, hoje, amanhã e daqui a três dias. A comparação usa evidências para associar
as tarefas e verifica omissões, tarefas extras, o conjunto completo de responsáveis e datas.
Não exige correspondência literal do texto das ações. A equivalência semântica dessas ações
continua exigindo revisão humana: citar uma evidência correta não comprova que a ação foi
descrita corretamente. Não há um segundo modelo julgando os resultados.

Os relatórios JSON e Markdown ficam em `artifacts/evaluations/`, com entradas, resultados
esperados, saída efetiva, divergências, configuração do alvo e hash dos prompts efetivos.
Cada repetição é preservada, inclusive falhas; não há repetição até obter aprovação. A
consistência compara quantidade, responsáveis e datas, sem comparar literalmente a redação.
Os retries de transporte continuam seguindo a configuração normal do provedor. Erros de
geração/contrato são registrados como `error`, sem gravar mensagens brutas que possam conter
credenciais. O comando retorna `0` para verificações automáticas aprovadas, `1` para falha e
`2` para revisão pendente. Referências ambíguas têm variantes aceitas explicitamente e continuam
pendentes de revisão mesmo quando o modelo escolhe uma delas.

Execute e revise essa avaliação ao alterar prompts, modelos ou extração, e antes de releases
que afetem a interpretação. Ela é manual e não aumenta o tempo obrigatório de cada PR.
Uma aprovação automática não substitui a revisão do conteúdo dos relatórios.

### Benchmark de transcrição

O benchmark usa áudio retido e `transcript.raw.txt` como referência e informa WER, CER, tempo e
fator de tempo real sem conteúdo da reunião. Por padrão, monta `./data` do host somente para
leitura, em vez do volume nomeado do bot. Forneça uma montagem somente leitura do diretório retido
desejado ao medir gravações feitas pelo Docker.

```sh
docker compose --profile benchmark run --rm -e BENCHMARK_DEVICE -e BENCHMARK_BATCH_SIZE -e BENCHMARK_MODEL benchmark
```

Defina essas variáveis no host antes do comando. `BENCHMARK_DATA_DIR` é o diretório dentro do
contêiner (`/benchmark-data/recordings` por padrão). Somente reuniões com todos os áudios restantes
são medidas.
O conjunto também exige `manifest.json` e `transcript.raw.txt` por reunião. A limpeza terminal
remove esses arquivos locais mesmo com áudio retido; prepare um conjunto isolado somente leitura
com conteúdo e áudio preservados, sem presumir que o diretório terminal esteja completo.

## Migrations e preservação em upgrades

Migrations são definições SQL TypeScript ordenadas em `packages/shared/src/database/migrations*.ts`.
Depois de aplicadas são imutáveis: PostgreSQL registra checksum SHA-256 e a inicialização falha
de forma fechada se o SQL versionado divergir. Não corrija uma migration aplicada editando seu SQL histórico.

Da versão 10 em diante, migrations devem preservar todas as reuniões não terminais: sem exclusão de
dados de negócio, truncamento, remoção de colunas, exclusão em cascata ou atualização do
processamento de reuniões. Tabelas só podem ser removidas quando não guardam dados de reuniões nem
de configuração; as tabelas protegidas estão listadas em `packages/shared/src/database/migration-safety.ts`.
Limpeza pertence ao ciclo explícito de retenção após estado terminal. A inicialização deve
preservar artefatos pendentes. Upgrades de processamento/manifesto exigem testes de contrato
que comprovem preservação e recuperação de reuniões, jobs, custos, manifestos e catálogos de áudio.
Consulte os testes de integração de upgrade e `packages/shared/tests/database-migration-safety.test.ts`.

## Integração contínua

`CI` executa em PRs para `main` e pushes em `main`. Os jobs são `Quality`, `Security`, `Tests`,
`Runtime / Images`, `Quality Gate / Analysis` e `Quality Gate`. Novos commits cancelam execuções
anteriores do mesmo PR; pushes em `main` não cancelam uns aos outros. A proteção de branch determina
se pushes diretos são bloqueados.

Servidor, dashboard e Python exigem ao menos 85% de cobertura global por linhas e 85% em cada grupo
de domínio. A cobertura alterada é um agregado ponderado por linhas dos três componentes, também
de pelo menos 85%. As próprias etapas de teste também falham quando bot, API, shared ou dashboard
ficam abaixo de 85% em linhas, statements, branches ou funções. Relatórios HTML, JUnit, JSON e
SARIF são preservados como artefatos. PRs internos
recebem um comentário persistente em inglês; forks recebem checks, resumo e artefatos sem segredos
nem permissão de escrita. Analysis reúne resultados e guarda o baseline de main após pushes.

Em PRs, `Quality Gate / Analysis` consulta o SHA atual de `main` no início da análise de comparação
e executa novamente os testes de cobertura, as análises de qualidade e os scans de vulnerabilidades
desse commit. As colunas `Main` e `Δ from main` usam essa referência, sem depender de execuções
anteriores do CI de main. Todas as métricas de uma comparação pertencem ao mesmo SHA, preservado no
artefato `main-comparison.json`. Uma nova execução ou reexecução de Analysis consulta main novamente;
reexecutar somente `Quality Gate` reutiliza o relatório já calculado. Mudanças em main durante a análise entram na
próxima execução de Analysis.

Falhas na análise de main são informativas: métricas completas disponíveis continuam visíveis;
métricas ausentes ou inválidas e seus deltas aparecem como `-`, com a condição indicada no relatório.
Essa comparação não altera as regras de aprovação nem a classificação de `New code`, que continua
usando o diff e o baseline histórico conforme a métrica. Em pushes, `Main` apresenta as métricas do
próprio commit analisado. Os relatórios da comparação são preservados junto ao artefato do gate.

`Δ from main` subtrai o valor de `Main` do valor apresentado em `New code` em cada linha. Percentuais
usam pontos percentuais; módulos usam a quantidade acima do limite. Isso compara os recortes das
duas colunas, não a variação das métricas do repositório inteiro após aplicar o PR. A convenção de
cobertura de `New code` continua sendo 100% quando não há linhas novas medidas.

A complexidade cognitiva do comentário usa uma coleta separada de Biome e complexipy com limite 1,
sem transformar esses resultados em issues ou alterar o limite 15 dos checks de aprovação. O máximo
de `New code` considera funções novas ou alteradas pelo diff, inclusive mudanças dentro do corpo e
funções TSX. Valores acima de 1 são exatos; quando a coleta só permite afirmar que o máximo está
entre 0 e 1, a coluna mostra `≤ 1` e o delta mostra a faixa possível `[mínimo, máximo]`. Um conjunto
sem funções apresenta 0 exato. Ausência de evidência completa aparece como `-`. Análises de main
bem-sucedidas não adicionam uma linha de status ao comentário; falhas continuam indicadas.

Security conta vulnerabilidades únicas HIGH/CRITICAL com correção disponível como bloqueantes.
Severidades menores e achados sem correção publicada continuam nos detalhes e artefatos. Checks
de segredos e configuração têm regras próprias de reprovação no workflow.

Runtime constrói imagens de bot, dashboard e transcrição CPU, valida usuários/versões e variantes
Compose e analisa essas imagens. Em pushes de `main`, inferência CPU local e pacote CUDA sempre
executam. Em PRs, alterações de transcrição, FFmpeg, locks Python ou workflow selecionam ambos;
dependências de smoke/runtime/modelos selecionam smoke; alterações não relacionadas podem dispensar
ambos. Os filtros de caminhos do workflow são a fonte de verdade dessa seleção.

Node.js 22.23.2, npm 10.9.8, Python 3.12.14, digests de imagens, actions, locks de pacotes e snapshots
Debian estão fixados. Pacotes de sistema NVIDIA são obtidos nos repositórios oficiais HTTPS Ubuntu
durante o build. Runner GitHub e bases de vulnerabilidades dos scanners são serviços atualizados.
Caches de npm, pip, BuildKit e modelos verificados reduzem o tempo; o dashboard lê o cache de build
do bot sem substituí-lo. Novas entradas de cache de modelos só são salvas após smoke bem-sucedido em main.
