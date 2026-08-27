<p align="center">
  <img src="./assets/banner.png" width="820" alt="Summyz — bot de gravação e transcrição para Discord" />
</p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.pt-BR.md">Português</a>
</p>

<p align="center">
  <b>Summyz</b> é um bot para Discord que grava calls sob comando, transcreve o áudio de cada participante e publica resumos
  com decisões e tarefas.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/versão-1.0.0-blue" alt="Versão">
  <img src="https://img.shields.io/badge/node-%3E%3D22.5-339933?logo=node.js&logoColor=white" alt="Node >= 22.5" />
  <img src="https://img.shields.io/badge/PRs-welcome-23A559" alt="PRs welcome" />
  <img src="https://img.shields.io/badge/self--hosted-100%25-0A0B0F" alt="Self-hosted" />
</p>

---

O Summyz grava cada participante separadamente e, depois do encerramento normal da call, transcreve
os segmentos pelo provedor configurado e monta um arquivo único preservando falantes, timestamps e
falas sobrepostas. Uma segunda etapa revisa apenas o texto da transcrição, sem
permitir que o modelo altere IDs, falantes, timestamps ou ordem. Em seguida, gera um resumo
estruturado e publica em um post de fórum do Discord o resumo executivo, os tópicos discutidos, as
decisões, as tarefas e a transcrição completa.

## Requisitos

- Node.js 22.12 ou superior;
- npm;
- Docker com Compose para executar o bot, o PostgreSQL e os serviços locais;
- PostgreSQL 18;
- uma aplicação de bot criada no Discord Developer Portal;
- uma conta no OpenRouter com créditos e uma chave de API somente para as fases configuradas com
  `openrouter`;
- FFmpeg não precisa ser instalado separadamente: o projeto usa um binário empacotado.

## Configuração local

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env`.
3. Preencha `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `POSTGRES_PASSWORD` e `DATABASE_URL`; use o host
   `postgres` no Compose ou `localhost` ao executar o bot diretamente pelo npm.
4. Preencha `OPENROUTER_API_KEY` somente se algum perfil utilizar OpenRouter.
5. Defina `PERSIST_MEETING_CONTENT` e `PERSIST_MEETING_AUDIO` conforme a política desejada.
6. Para desenvolvimento, preencha `DISCORD_GUILD_ID` com o ID do servidor de teste. Sem essa
   variável, os comandos são registrados globalmente e podem demorar para aparecer.
7. Execute `npm run local-ai:up`. O inicializador detecta GPUs, escolhe os overlays seguros do
   Compose e sobe o bot, PostgreSQL, Ollama e faster-whisper. Os modelos locais escolhidos nos
   perfis são preparados quando necessários.
   `npm run dev` continua disponível para desenvolvimento, mas os serviços locais permanecem no
   Compose.

Se a porta local `5432` já estiver ocupada, altere `POSTGRES_PORT` e ajuste a porta de
`DATABASE_URL`. O PostgreSQL é publicado somente em `127.0.0.1`; entre containers, a conexão
continua usando `postgres:5432`.

Nunca versione o arquivo `.env` nem publique o token do bot.

As migrações e a conexão PostgreSQL são validadas antes do login no Discord; se o banco estiver
indisponível ou a URL for inválida, o processo encerra com uma mensagem segura. Os volumes
`postgres_data`, `summyz_data`, `ollama_models` e `faster_whisper_models` preservam o banco, os
arquivos e os modelos gerenciados após reinício.

## Persistência e privacidade

- o PostgreSQL guarda configurações, perfis, reuniões, fila e tentativas; `DATABASE_URL` é
  obrigatória;
- `PERSIST_MEETING_CONTENT=false` é o padrão. Depois do estado terminal, transcrições, resumo e
  estados locais são removidos. O backend mantém somente o mínimo operacional necessário à fila e
  ao diagnóstico de sua conclusão;
- com `PERSIST_MEETING_CONTENT=true`, o PostgreSQL conserva transcrição bruta e refinada, resumo,
  publicação e manifesto em `meeting_contents`;
- `PERSIST_MEETING_AUDIO=false` é o padrão: os áudios são excluídos depois de uma transcrição
  integralmente validada ou depois de esgotar as tentativas duráveis;
- com `PERSIST_MEETING_AUDIO=true`, os áudios permanecem indefinidamente em `DATA_DIR`, enquanto a
  tabela `meeting_audio_segments` guarda metadados e caminhos relativos;
- áudio nunca é armazenado como BLOB no PostgreSQL. Mesmo nesse modo, os bytes ficam no volume
  durável montado em `DATA_DIR`;
- o `manifest.json` local funciona como registro temporário de recuperação junto
  dos áudios; o processamento o sincroniza com o banco antes de reservar o job;
- não há expiração automática para conteúdo ou áudio preservado. A exclusão é uma operação manual
  do administrador no disco ou banco.
- registros de custos de provedores nunca expiram automaticamente e são independentes da retenção
  de conteúdo e áudio. O PostgreSQL usa `provider_cost_attempts`, com relacionamentos protegidos
  para reunião e servidor.

## Medição de custos dos provedores

Cada execução de modelo é registrada antes de ser enviada. Respostas do OpenRouter usam o
`usage.cost` em USD informado pelo próprio provedor; o Summyz não calcula estimativas de preço.
Retries da aplicação são tentativas separadas, e uma chamada que falhou é incluída sempre que o
OpenRouter confirma uma cobrança. O `generation_id` é preservado e consultado para reconciliar
respostas sem metadados completos de custo ou modelo efetivo.

Se uma falha de transporte impedir que a resposta e o identificador da geração cheguem ao Summyz,
a tentativa será marcada como não confirmável automaticamente, nunca como gratuita. Os relatórios
expõem essa condição e não apresentam o subtotal confirmado como necessariamente completo.
Chamadas locais ao Ollama e faster-whisper preservam o modelo efetivo com o campo de custo externo
como `null`, pois o custo computacional não faz parte desta etapa.

Somente o dono do servidor pode consultar uma reunião concluída com `/recording-cost meeting` ou agregar
reuniões concluídas pela data em que começaram com `/recording-cost period`; reuniões em andamento
ficam fora do relatório. As respostas são efêmeras e sempre limitadas ao servidor atual do Discord.
Os limites de data usam `SUMMARY_TIME_ZONE`; valores financeiros são armazenados e exibidos sem
arredondamento.

As escolhas de persistência e o perfil ativo completo — provedores, modelos, idiomas e parâmetros —
são copiados para o manifesto no início da reunião. Alterar ou ativar outro perfil depois não muda
uma reunião já iniciada.

O processamento usa uma fila durável no PostgreSQL. A entrega é *at least once*: se o processo cair
depois de reservar um job e antes de confirmar
o resultado, esse job pode executar novamente após o reinício ou vencimento do lease. As etapas e a
publicação são idempotentes para que a repetição não crie intencionalmente outra reunião. Além dos
retries rápidos dos provedores, uma falha transitória agenda execuções duráveis após 1 minuto,
5 minutos, 15 minutos, 1 hora e 6 horas (seis execuções no total, contando a inicial).

## Configuração no Discord Developer Portal

1. Abra a aplicação do Summyz no Discord Developer Portal.
2. Em **Bot**, crie ou redefina o token e salve-o como `DISCORD_TOKEN` no `.env`.
3. Ainda em **Bot**, mantenha desativados os **Privileged Gateway Intents**. A implementação atual
   usa somente os intents padrão `Guilds` e `Guild Voice States`.
4. Em **Installation**, configure **Guild Install** com os escopos `bot` e
   `applications.commands`.
5. Nas permissões padrão da instalação, conceda ao bot:

- Ver canais;
- Conectar;
- Enviar mensagens;
- Enviar mensagens em threads;
- Ler histórico de mensagens;
- Anexar arquivos;
- Usar comandos de aplicativo.

Use o link fornecido pela página **Installation** para adicionar o bot ao servidor. Se o bot já
estiver instalado, alterar as permissões padrão no Developer Portal não atualiza automaticamente o
cargo existente: ajuste as permissões do cargo do bot e as sobrescritas do canal onde as reuniões
serão publicadas, ou reinstale o bot com o novo link.

As permissões Enviar mensagens, Enviar mensagens em threads, Ler histórico de mensagens e Anexar
arquivos devem estar liberadas também nas configurações específicas do fórum, quando houver
sobrescritas. `Enviar mensagens` sozinho não permite responder dentro de um post.

Depois de adicionar o bot, use `/recording-role add` para autorizar os cargos desejados e
`/recording-summary-forum set` para definir o fórum das publicações. Novas gravações ficam
bloqueadas enquanto não houver um fórum configurado. Consulte [BOT_COMMANDS.md](./BOT_COMMANDS.md)
para ver todos os comandos e regras de acesso.

Somente o dono literal do servidor Discord pode gerenciar fórum, cargos autorizados e custos.
Permissões de Administrador ou Gerenciar servidor não concedem essa gestão. O dono e os cargos que
ele autorizar podem usar `/record` e `/stop`; os cargos não recebem outros poderes.

## Perfis de processamento

Cada servidor possui múltiplos perfis no PostgreSQL e exatamente um perfil ativo. Na primeira
inicialização, o Summyz cria e ativa `Profile 1`, mas não escolhe provedores nem modelos. Enquanto
transcrição, refinamento e resumo não tiverem uma escolha explícita, `/record` mostra um aviso
efêmero e não inicia a gravação. Esta etapa entrega o modelo de dados e a execução dos perfis; a
interface de configuração será implementada separadamente, portanto ainda não há comando Discord
nem configurador de terminal para editá-los.

Não existe modelo `auto` nem `openrouter/auto`. A escolha é livre e o Summyz nunca substitui o
modelo selecionado. A avaliação local usa os estados `recommended`, `compatible`,
`above_recommended`, `unknown` e `incompatible`: somente `incompatible` bloqueia a gravação;
`above_recommended` e `unknown` geram avisos privados. Um perfil guarda, por fase, o provedor,
modelo, idioma e parâmetros próprios. Isso inclui batching e opções de STT, tamanho de chunks e as
opções de geração `temperature`, `seed` e `think` quando aplicáveis. Valores não definidos não são
forçados pelo Summyz, preservando os padrões do provedor.

## Configurações de gravação

- `BOT_LANGUAGE`: idioma dos textos fixos e das descrições de comandos no Discord; `en` ou `pt-BR`;
  padrão `en`. Essa configuração não altera o idioma dos modelos;
- `DATA_DIR`: diretório dos arquivos; padrão `./data`;
- `SEGMENT_SILENCE_MS`: silêncio que encerra um segmento; padrão `1000` ms;
- `SEGMENT_MAX_SECONDS`: duração máxima de cada segmento contínuo; padrão `60` s;
- `VOICE_RECONNECT_MAX_MS`: tempo máximo de reconexão; padrão `300000` ms;
- `LOG_LEVEL`: nível dos logs estruturados; padrão `info`.

Os arquivos são salvos em
`data/recordings/<meetingId>/participants/<userId>/<segmentId>.ogg`. O `manifest.json` da reunião
registra participantes, segmentos, interrupções e métricas de recepção.

## Configurações de transcrição

- `OPENROUTER_API_KEY`: chave exigida somente quando alguma fase usa OpenRouter;
- `TRANSCRIPTION_CONCURRENCY`: lotes processados simultaneamente; padrão `2`;
- `TRANSCRIPTION_VAD_THRESHOLD`: probabilidade mínima de voz no detector Silero local; padrão `0.5`;
- `TRANSCRIPTION_VAD_MIN_SPEECH_MS`: duração mínima aproximada de voz; padrão `96` ms;
- `TRANSCRIPTION_WINDOW_MAX_SECONDS`: duração máxima de um lote consolidado; padrão `30` s;
- `TRANSCRIPTION_MAX_ATTEMPTS`: total de tentativas por lote; padrão `4`;
- `TRANSCRIPTION_TIMEOUT_MS`: timeout de cada tentativa; padrão `90000` ms;
- `TRANSCRIPTION_RETRY_BASE_MS`: espera inicial entre retries; padrão `1000` ms;
- `TRANSCRIPTION_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms;

Na fase de transcrição, cada perfil define:

- `provider` e `model`, ambos obrigatórios para o perfil ficar completo;
- `language`: `auto` ou um idioma explícito;
- `batchSize`: `auto`, `0` para desativar ou um inteiro de `1` a `64`;
- `temperature`: temperatura da transcrição;
- `timestampMode`: `word` para timestamps detalhados ou `batch` para texto sem timestamps;
- `interSpeechSilenceMs`: silêncio WAV inserido somente entre intervalos reais de voz do lote;
- `mergeMaxGapMs`: sobrescrita opcional do intervalo máximo global para consolidar falas da mesma
  pessoa;
- `prompt`: instrução textual opcional para orientar o estilo da transcrição;
- `providerOptions`: opções opcionais agrupadas pelo slug do provedor conforme o contrato do
  OpenRouter.

Antes da API, o Summyz decodifica o áudio localmente e usa Silero VAD para confirmar a presença de
voz. Segmentos sem voz são concluídos como silêncio, com zero tentativas externas, e não aproximam
falas que estavam distantes na call. Somente os intervalos detectados como voz são consolidados em
WAV sem perdas quando o intervalo real entre as vozes não passa de 2 segundos, em janelas de até 30
segundos da mesma pessoa. Conforme o perfil ativo, pequenos silêncios sintéticos podem separar esses
intervalos para preservar fronteiras de enunciados. Um mapa temporal exclui essas pausas e recoloca
cada trecho no relógio original depois da transcrição, sem misturar participantes.

O OpenRouter pode rotear uma requisição entre provedores compatíveis com o modelo selecionado. O
Summyz aceita esse roteamento dentro da fase OpenRouter. Uma fase configurada como local nunca envia
seu conteúdo ao OpenRouter e não possui fallback cruzado.

O Compose mantém Ollama e faster-whisper apenas na rede privada. Ollama usa saída JSON estruturada;
modelos que não cumprem a validação de contrato feita na inicialização são descarregados e, quando
nenhuma outra fase válida os utiliza, removidos do volume gerenciado. Uma resposta isolada
incompatível durante uma reunião não condena o modelo: se o lote tiver várias falas, o Summyz o
subdivide automaticamente e tenta novamente com partes menores. Indisponibilidade do serviço e uma
resposta incompatível para uma única fala continuam sob a política de retry durável. O
faster-whisper executa um warm-up real antes de declarar CUDA pronta, evitando descobrir bibliotecas
ou VRAM incompatíveis somente na primeira reunião.

O Summyz não força `think=false`, `temperature=0` nem `seed=0` globalmente. Essa combinação pode ser
salva no perfil para o hardware em que foi validada; quando omitida, os padrões do modelo e do
provedor são preservados.

`LOCAL_AI_DEVICE` controla todas as fases locais:

- `auto` detecta o hardware mais potente. Se houver GPU, mas ela for incompatível com a fase, não
  troca implicitamente para CPU;
- `gpu` exige uma GPU compatível para cada fase local configurada;
- `cpu` nunca disponibiliza nem utiliza GPU.

`LOCAL_AI_FALLBACK=none` é o padrão e não permite fallback implícito. Com o fallback `cpu`, uma GPU
incompatível ou uma falha ao inicializá-la pode usar CPU e gera aviso estruturado. Quando
`LOCAL_AI_DEVICE=cpu`, o fallback
efetivo é sempre `none`, mesmo que outro valor tenha sido escrito. O dispositivo efetivamente ativo
é exposto somente nos logs estruturados.

Nesta etapa, a transcrição faster-whisper acelera somente em NVIDIA/CUDA. Uma máquina apenas com AMD
pode usar a AMD no Ollama em Linux via ROCm, mas um perfil que exigir faster-whisper na GPU é
incompatível e não inicia a gravação. AMD para transcrição via whisper.cpp/Vulkan ou ROCm fica para
uma etapa futura.
Docker Desktop no Windows expõe GPU NVIDIA, não AMD; por isso o inicializador interrompe uma fase
Ollama/AMD nesse ambiente, salvo quando o fallback para CPU foi autorizado. GPUs Intel, Apple e de
fabricante desconhecido são detectadas, mas sem um perfil de container compatível nesta etapa o
mesmo princípio se aplica. Use `npm run local-ai:down` para encerrar a pilha iniciada pelo script.

Se o modelo escolhido estiver acima da recomendação de hardware, o Summyz mantém a escolha e avisa
somente o usuário que executou `/record`; não troca para um modelo menor. Modelos incompatíveis
bloqueiam a gravação.

## Configurações de refinamento

- `provider`, `model`, `maxChunkCharacters` e opções de geração pertencem ao perfil;
- `REFINEMENT_MAX_ATTEMPTS`: total de tentativas por bloco; padrão `3`;
- `REFINEMENT_TIMEOUT_MS`: timeout de cada tentativa; padrão `120000` ms;
- `REFINEMENT_RETRY_BASE_MS`: espera inicial entre retries; padrão `1000` ms;
- `REFINEMENT_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms.

O refinamento recebe os blocos estruturados produzidos pelo STT e devolve somente pares de
`id` e `text`. O código rejeita qualquer resposta que remova, acrescente ou reordene IDs e sempre
reutiliza falante e timestamps do Whisper. O prompt pede uma revisão conservadora de erros
ortográficos, fonéticos e contextuais evidentes, preservando o idioma original de cada fala; ele não
contém lista de nomes, palavras-chave ou vocabulário controlado e nunca traduz a reunião.

Antes da primeira chamada, o Summyz preserva atomicamente a saída original em
`transcript.raw.txt`. Se o modelo ou a resposta estruturada falhar nas três tentativas, restaura o
original em `transcript.txt`, registra o fallback em `refinement.json` e continua normalmente para
o resumo e a publicação. O Discord não recebe um aviso específico desse fallback, pois a
transcrição original continua disponível.

## Configurações de resumo

- `provider`, `model`, `language`, `maxChunkCharacters` e opções de geração pertencem ao perfil;
- `SUMMARY_MAX_ATTEMPTS`: total de tentativas por chamada ao modelo; padrão `4`;
- `SUMMARY_TIMEOUT_MS`: timeout de cada tentativa; padrão `120000` ms;
- `SUMMARY_RETRY_BASE_MS`: espera inicial entre retries; padrão `1000` ms;
- `SUMMARY_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms;
- `SUMMARY_TIME_ZONE`: fuso IANA usado no título do post e nos filtros de data dos relatórios de
  custo; padrão `America/Sao_Paulo`.

O resumo usa saída estruturada validada. Transcrições maiores que o limite configurado são divididas
somente entre falas, resumidas por blocos e consolidadas. O Summyz mantém internamente as referências
às falas que sustentam decisões e tarefas, mas não publica essas evidências. Uma decisão ou tarefa
sem referência válida é removida. Responsável e prazo só são preservados quando aparecem exatamente
na fala referenciada; tarefas explícitas podem permanecer sem esses campos.

Pedidos vagos, como “alguém precisa decidir a ferramenta”, não são promovidos a decisão ou tarefa:
eles aparecem em **Pendências e observações**. Prazos são mantidos no texto original, sem conversão
automática de expressões como “amanhã” ou “até sexta-feira”.

## Resultado da transcrição

A transcrição começa automaticamente quando `/stop` conclui a gravação ou quando todas as pessoas
saem do canal. Após um reinício, o bot retoma a gravação se ainda houver pessoas; se o canal estiver
vazio, finaliza o áudio parcial e o processa normalmente.

O resultado é escrito atomicamente em:

```text
data/recordings/<meetingId>/transcript.txt
```

Quando o refinamento é iniciado, a versão sem revisão fica preservada em
`data/recordings/<meetingId>/transcript.raw.txt`; `transcript.txt` passa a conter a versão revisada
ou permanece idêntico ao original quando ocorre fallback.

Cada trecho segue este formato:

```text
[00:00:10.000 – 00:00:15.000] Ana: Vamos publicar amanhã.
[00:00:12.000 – 00:00:14.000] Bruno: Concordo.
```

Intervalos coincidentes representam falas sobrepostas. Se dois participantes tiverem o mesmo nome
de exibição, o arquivo usa sufixos estáveis como `Ana #1` e `Ana #2`, mantendo os IDs apenas nos
artefatos internos.

O arquivo só é criado depois que todos os segmentos têm sucesso ou são confirmados localmente como
silêncio. Uma conversão PCM que falhou
durante a gravação é tentada novamente em Ogg e, se necessário, empacotada sem perdas como WAV. Se
algum segmento continuar impossível de analisar/processar ou o provedor esgotar os retries:

- nenhum `transcript.txt` é disponibilizado;
- a falha é persistida em `transcription.json`;
- o Discord recebe somente um aviso genérico, sem detalhes internos;
- os áudios são preservados entre tentativas duráveis;
- depois da última tentativa, o Discord recebe o aviso genérico e os artefatos temporários são
  excluídos.

## Publicação no Discord

Depois da transcrição e do resumo, o Summyz consulta a configuração mais recente do servidor e cria
um post no fórum escolhido. Com `BOT_LANGUAGE=en`, o post de sucesso usa o nome
`Summary — MM/DD/YYYY HH:mm — Voice channel name`; com `BOT_LANGUAGE=pt-BR`, usa
`Resumo — DD/MM/AAAA HH:mm — Nome do canal de voz`. O post contém:

- ID da reunião e resumo executivo na primeira mensagem;
- tópicos discutidos;
- decisões;
- tarefas, com responsável e prazo somente quando explícitos;
- pendências e observações;
- `transcript.txt` como arquivo anexo.

O Discord move o post para a área de posts antigos depois de até sete dias sem atividade; o
conteúdo não é apagado e pode ser reaberto.

Se o resumo continuar falhando depois dos retries, o título usa `Transcript` em inglês ou
`Transcrição` em português. A primeira mensagem informa que o resumo está indisponível e inclui
`transcript.txt` como anexo.

O chat onde `/record` foi executado concentra o histórico público da sessão: início, falha ao
iniciar, interrupção, retomada, falha definitiva de reconexão, encerramento manual, canal vazio,
desligamento, falha da transcrição e falha da publicação. Ao usar `/stop`, somente quem executou o
comando recebe uma confirmação efêmera no chat da interação, com referência ao chat original; o
aviso público de encerramento menciona essa pessoa no chat do `/record`. No encerramento automático,
o aviso identifica o canal de voz quando seu nome está disponível e informa que os segmentos serão
processados. Se o fórum for alterado antes de uma publicação começar, a reunião usa o destino mais
recente; uma publicação já iniciada ou concluída permanece no post original.

Enquanto o job está em andamento, os estados ficam no volume durável em `refinement.json`,
`summary.json` e `publication.json`. IDs de mensagem e thread são persistidos a cada passo e as
respostas usam nonces determinísticos, permitindo retomar a publicação após reinício e reduzir
duplicações. A criação inicial de posts de fórum não oferece
nonce pela API do Discord; portanto, a garantia é de idempotência nas condições normais, não de
atomicidade absoluta entre o volume e o Discord.

Quando `PERSIST_MEETING_AUDIO=false`, os áudios são excluídos assim que a transcrição completa é
validada e persistida, ou após a falha definitiva. Depois da publicação, os demais arquivos
temporários são excluídos se `PERSIST_MEETING_CONTENT=false`. As cópias habilitadas permanecem no
PostgreSQL ou em `DATA_DIR`, conforme o tipo, até que o operador as exclua.

## Qualidade

Use `npm run check` antes de enviar mudanças. Esse comando valida formatação, lint, tipos, testes e
cobertura. Use `npm run security:audit` para verificar as dependências.

O decodificador Opus do MVP é `opusscript`, evitando a cadeia vulnerável encontrada na dependência
nativa avaliada. O smoke test dos serviços locais é automatizado e executado dentro da rede privada
com `docker compose --profile smoke run --rm smoke`; ele baixa modelos pequenos e pode demorar na
primeira execução. Interações reais no Discord não são apresentadas como teste automatizado.

O benchmark de faster-whisper usa `transcript.raw.txt` como referência, calcula WER, CER, tempo e
fator de tempo real, e não inclui o conteúdo das reuniões no relatório. Configure
`BENCHMARK_DEVICE`, `BENCHMARK_BATCH_SIZE` e `BENCHMARK_MODEL`, depois execute
`npx tsx scripts/local-ai-compose.ts --profile benchmark run --rm benchmark`. Ele só mede reuniões
que ainda possuem todos os áudios. O inventário inicial está em
[`docs/benchmarks.md`](./docs/benchmarks.md).

## Contribuição

Contribuições são bem-vindas.

1. Faça um fork do repositório e crie uma branch para a funcionalidade.
2. Mantenha os módulos pequenos e com uma única responsabilidade, siga a estrutura existente.
3. Adicione testes para novas lógicas — `npm test` deve passar.
4. Abra um pull request descrevendo a mudança e sua motivação.

Para relatar bugs ou solicitar funcionalidades, abra uma issue.
