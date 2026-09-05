<p align="center">
  <img src="./assets/banner.png" width="820" alt="Summyz — bot de gravação e transcrição para Discord" />
</p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.pt-BR.md">Português</a>
</p>

<p align="center">
  <b>Summyz Community</b> é um bot para Discord que grava calls sob comando, transcreve o áudio de cada participante e publica resumos
  com decisões e tarefas.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/versão-1.0.0-blue" alt="Versão">
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white" alt="Node >= 22.12" />
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

- Docker com Compose;
- uma aplicação de bot criada no Discord Developer Portal;
- uma conta no OpenRouter com créditos e uma chave de API somente para as fases configuradas com
  `openrouter`;
- drivers e integração Docker compatíveis se a aceleração NVIDIA ou AMD for utilizada.

Node.js 22.12, npm e uma instalação do FFmpeg com `libopus` são necessários somente para
desenvolvimento nativo. PostgreSQL, Ollama, faster-whisper, Python, Node e FFmpeg são preparados
automaticamente no fluxo Docker.

## Configuração local

1. Copie `.env.example` para `.env`.
2. Preencha `POSTGRES_PASSWORD`, `DATABASE_URL`, `SUMMYZ_SECRETS_KEY` e `SUMMYZ_SETUP_TOKEN`. Use o
   host `postgres` no Compose ou `localhost` ao executar os processos diretamente pelo npm.
3. No Linux ou macOS, execute `./summyz-community up`. No Windows, execute
   `.\summyz-community.ps1 up`. O launcher roda
   no host, detecta CPU, NVIDIA ou AMD, escolhe os overlays seguros e chama o Docker Compose.
4. Abra `http://127.0.0.1:8787` para criar a conta
   administradora e configurar Discord, SMTP e, se necessário, OpenRouter.
5. Para desenvolvimento, preencha `DISCORD_GUILD_ID` com o ID do servidor de teste. Sem essa
   variável, os comandos são registrados globalmente e podem demorar para aparecer.

Use `./summyz-community status`, `./summyz-community logs`, `./summyz-community restart` e
`./summyz-community down` para administrar a instalação; no Windows, substitua `./summyz-community` por
`.\summyz-community.ps1`. O Compose direto continua
disponível para operadores avançados. `docker compose up -d --build` usa CPU; para NVIDIA ou AMD,
inclua manualmente `docker-compose.nvidia.yaml` ou `docker-compose.amd.yaml`.

Para desenvolver nativamente, execute `npm install` e informe um `FFMPEG_PATH` absoluto ou deixe
`ffmpeg`/`ffmpeg.exe` disponível no `PATH`. O bot valida o executável e o encoder `libopus` antes de
conectar ao Discord. PostgreSQL, Ollama e faster-whisper podem continuar no Compose. Para a
interface, use `npm run dev:api` e `npm run dev:web` em terminais separados.

Se a porta local `5432` já estiver ocupada, altere `POSTGRES_PORT` e ajuste a porta de
`DATABASE_URL`. O PostgreSQL é publicado somente em `127.0.0.1`; entre containers, a conexão
continua usando `postgres:5432`.

Nunca versione o arquivo `.env` nem publique o token do bot.

As migrações e a conexão PostgreSQL são validadas antes do login no Discord; se o banco estiver
indisponível ou a URL for inválida, o processo encerra com uma mensagem segura. Os volumes
`postgres_data`, `summyz_community_data`, `ollama_models` e `faster_whisper_models` preservam o banco, os
arquivos e os modelos gerenciados após reinício.

## Persistência e privacidade

- o PostgreSQL guarda configurações, perfis, reuniões, fila e tentativas; `DATABASE_URL` é
  obrigatória;
- a retenção de conteúdo é ativada por padrão em cada novo servidor. Quando ativa, o PostgreSQL
  conserva transcrição bruta e refinada, resumo, publicação e manifesto em `meeting_contents`;
- ao desativar a retenção de conteúdo no dashboard, esses artefatos são removidos depois do estado
  terminal, mantendo apenas o mínimo operacional necessário à fila;
- a retenção de áudio é desativada por padrão: os áudios são excluídos depois de uma transcrição
  integralmente validada ou depois de esgotar as tentativas duráveis;
- quando ativada no dashboard, os áudios permanecem indefinidamente em `DATA_DIR`, enquanto a
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
2. Em **Bot**, crie ou redefina o token e informe-o no setup do dashboard. Ele será criptografado
   no PostgreSQL com a chave mestra mantida no `.env`.
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

Conecte sua conta Discord ao dashboard. Ele mostra apenas servidores dos quais essa conta é dona e
fornece a ação de instalação para cada servidor. Se o bot já
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

Os perfis são pessoais e globais: pertencem à conta do dashboard e podem ser reutilizados nos
servidores dos quais essa conta é proprietária. A página **Perfis** separa configurações de **API
externa** e **Local**. Cada conta recebe um `Perfil 1` localizado de cada tipo, sem modelos
preenchidos. O último perfil de cada tipo e qualquer perfil ativo não podem ser excluídos.

Cada servidor mantém no máximo um desses perfis como ativo, independentemente do tipo. Servidores
novos começam sem perfil ativo; enquanto transcrição, refinamento e resumo do perfil escolhido não
tiverem modelos explícitos, `/record` mostra um aviso efêmero e não inicia a gravação. Ao escolher
um idioma explícito, o modelo de tradução também passa a ser obrigatório e o perfil fica incompleto
imediatamente até ele ser preenchido. Trocar um modelo preserva os demais parâmetros do perfil. Se a
propriedade do servidor mudar no Discord, o
perfil do proprietário anterior é desassociado: o servidor deixa sua lista e o novo proprietário
precisa conectar a própria conta e fazer sua configuração.

Não existe modelo `auto` nem `openrouter/auto`. A escolha é livre e o Summyz nunca substitui o
modelo selecionado. A avaliação local usa os estados `recommended`, `compatible`,
`above_recommended`, `unknown` e `incompatible`: somente `incompatible` bloqueia a gravação;
`above_recommended` e `unknown` geram avisos privados. O idioma é uma configuração principal do
perfil, usa um catálogo pesquisável de tags BCP 47 e tem `auto` como padrão. Cada fase guarda o
provedor, modelo e parâmetros próprios. Isso inclui batching e opções de STT, tamanho de chunks e as
opções de geração `temperature`, `seed` e `think` quando aplicáveis. Valores não definidos não são
forçados pelo Summyz, preservando os padrões do provedor.

O dashboard mostra integralmente os prompts editáveis de transcrição, refinamento, extração,
consolidação e tradução. **Sem prompt** remove apenas a personalização: um prompt-base imutável do
Summyz sempre é enviado para fixar idioma, estrutura, evidências, preservação literal e regras de
segurança. Transcrições e prompts editáveis são tratados como conteúdo não confiável. O padrão de
transcrição não possui bloco editável. Os demais
padrões nascem em inglês ou pt-BR conforme o idioma da conta no dashboard, enquanto o texto do
prompt solicita o idioma configurado para o resumo. Ao alterar esse idioma, prompts ainda iguais ao
padrão são adaptados; textos personalizados são preservados. O botão **Restaurar padrão** usa o
idioma atual do dashboard. Os prompts e modelos efetivos são fixados no manifesto quando a reunião
começa, sem mudança silenciosa em retomadas.

Em `auto`, a transcrição preserva as alternâncias de idioma, todos os lotes contribuem uma única vez
para escolher a tag primária predominante e o resumo é publicado nesse idioma. Com uma tag explícita,
o resumo-base é primeiro validado e persistido no idioma predominante e só depois traduzido. Se a tag
explícita for idêntica à predominante, a tradução é ignorada. A transcrição e o refinamento nunca são
traduzidos. Se a tradução falhar após as tentativas, o resumo-base é publicado e somente o autor de
`/record` recebe a DM privada; não há aviso público nem fallback de DM.

Perfis externos validam no OpenRouter a modalidade de transcrição e os contratos estruturados dos
modelos antes de gravar. Perfis locais carregam o checkpoint faster-whisper e exigem a capacidade
`multilingual=true` reportada pelo checkpoint real. `tiny.en`, `base.en`, `small.en`, `medium.en`,
convertidos equivalentes e checkpoints cuja capacidade não possa ser determinada são bloqueados
antes de qualquer áudio ou chamada de processamento. Não há detector auxiliar nem catálogo de
compatibilidade entre modelos generativos e idiomas.

As migrations normalizam perfis criados antes de as chaves de prompt se tornarem obrigatórias. O
texto existente é preservado, prompts de transcrição ausentes viram `null` e prompts de refinamento
ou resumo ausentes recebem os padrões localizados. O runtime aceita somente o contrato atual de
perfil.

## Configurações de gravação

- o idioma dos textos do bot é configurado por servidor no dashboard; essa configuração não altera
  o idioma dos modelos;
- `DATA_DIR`: diretório dos arquivos; padrão `./data`;
- `SEGMENT_SILENCE_MS`: silêncio que encerra um segmento; padrão `1000` ms;
- `SEGMENT_MAX_SECONDS`: duração máxima de cada segmento contínuo; padrão `60` s;
- `VOICE_RECONNECT_MAX_MS`: tempo máximo de reconexão; padrão `300000` ms;
- `LOG_LEVEL`: nível dos logs estruturados; padrão `info`.

Os arquivos são salvos em
`data/recordings/<meetingId>/participants/<userId>/<segmentId>.ogg`. O `manifest.json` da reunião
registra participantes, segmentos, interrupções e métricas de recepção.

## Configurações de transcrição

- a chave OpenRouter é um segredo global editável no dashboard e só é exigida quando alguma fase
  usa esse provedor;
- `TRANSCRIPTION_CONCURRENCY`: lotes processados simultaneamente; padrão `2`;
- `TRANSCRIPTION_WINDOW_MAX_SECONDS`: duração máxima de um lote consolidado; padrão `30` s;
- `TRANSCRIPTION_MAX_ATTEMPTS`: total de tentativas por lote; padrão `4`;
- `TRANSCRIPTION_TIMEOUT_MS`: timeout de cada tentativa; padrão `90000` ms;
- `TRANSCRIPTION_RETRY_BASE_MS`: espera inicial entre retries; padrão `1000` ms;
- `TRANSCRIPTION_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms;
- `TRANSLATION_MAX_ATTEMPTS`: tentativas da tradução; padrão `3`;
- `TRANSLATION_TIMEOUT_MS`: timeout por tentativa de tradução; padrão `120000` ms;
- `TRANSLATION_RETRY_BASE_MS`: espera inicial da tradução; padrão `1000` ms;
- `TRANSLATION_RETRY_MAX_MS`: espera máxima da tradução; padrão `30000` ms;

Na fase de transcrição, cada perfil define:

- `provider` e `model`, ambos obrigatórios para o perfil ficar completo;
- a transcrição sempre usa detecção automática; o idioma configurado pertence ao perfil e controla
  somente o idioma efetivo do resumo;
- `temperature`: temperatura da transcrição;
- timestamps por palavra são obrigatórios; uma API externa incompatível encerra a transcrição sem
  aproximação por segmento ou pela duração inteira do lote;
- `interSpeechSilenceMs`: silêncio WAV inserido somente entre intervalos reais de voz do lote;
- `mergeMaxGapMs`: sobrescrita opcional do intervalo máximo global para consolidar falas da mesma
  pessoa;
- `prompt`: instrução editável para orientar o estilo da transcrição, ou `null` para usar somente o
  prompt-base;
- `providerOptions`: opções opcionais agrupadas pelo slug do provedor conforme o contrato do
  OpenRouter.

Somente perfis locais expõem `batchSize`: `auto`, `0` para desativar ou um inteiro de `1` a `64`.
No faster-whisper, o lote é uma otimização de inferência e continua produzindo timestamps por
palavra. Para APIs externas, o Summyz otimiza requisições independentes por meio de
`TRANSCRIPTION_CONCURRENCY`.

## Dashboard e histórico

O Dashboard e o Histórico são restritos ao proprietário do servidor Discord selecionado. O seletor
é compartilhado entre as páginas e preservado no navegador. Os totais de calls e duração consideram
reuniões antigas e novas cujo pipeline terminou; o ranking de falantes começa nas reuniões gravadas
com o manifesto v3. A participação soma os intervalos de cada palavra, une sobreposições da mesma
pessoa e distribui o arredondamento inteiro para totalizar exatamente 100%. Participantes silenciosos
permanecem visíveis com `0%`.

Datas e limites dos filtros usam `SUMMARY_TIME_ZONE`. Conteúdo de resumo e transcrição só aparece
quando a retenção estava habilitada para a reunião. O custo do Dashboard soma valores confirmados de
todas as tentativas e avisa quando ainda existem valores pendentes ou não atribuídos.

Se a lista de perfis ou a configuração de um servidor não puder ser carregada, o dashboard mostra
um erro genérico e permite tentar novamente na própria página. Detalhes sobre dependências e dados
persistidos permanecem somente nos logs estruturados do servidor.

O VAD é configurado na aba própria do perfil e pode ser desativado. Perfis de API externa usam o
detector Silero do Summyz antes de enviar áudio ao OpenRouter. Perfis locais não executam esse
detector: somente o VAD nativo do faster-whisper faz o pré-processamento. Assim, nunca há dois VADs
em sequência. Cada tipo preserva os padrões e limites próprios do seu detector; limiar de fala,
limiar negativo, fala mínima, silêncio de encerramento e margem de fala são persistidos no perfil.
O perfil local também permite controlar a duração máxima de uma região de fala. Valores `auto`
mantêm o comportamento nativo conhecido do faster-whisper para o modo normal ou em lote.

Com um perfil de API externa e VAD ativo, segmentos sem voz são concluídos como silêncio, com zero
tentativas externas. Somente os intervalos detectados como voz são consolidados em WAV sem perdas
dentro dos limites configurados. Pequenos silêncios sintéticos podem preservar fronteiras de
enunciados. Um mapa temporal exclui essas pausas e recoloca cada trecho no relógio original depois
da transcrição, sem misturar participantes. No perfil local, o áudio consolidado chega ao
faster-whisper, que aplica seu próprio VAD conforme o perfil.

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
mesmo princípio se aplica. Use `./summyz-community down` ou `.\summyz-community.ps1 down` para encerrar
a pilha.

Se o modelo escolhido estiver acima da recomendação de hardware, o Summyz mantém a escolha e avisa
somente o usuário que executou `/record`; não troca para um modelo menor. Modelos incompatíveis
bloqueiam a gravação.

## Configurações de refinamento

- `provider`, `model`, `maxChunkCharacters`, `prompt` e opções de geração pertencem ao perfil;
- `REFINEMENT_MAX_ATTEMPTS`: total de tentativas por bloco; padrão `3`;
- `REFINEMENT_TIMEOUT_MS`: timeout de cada tentativa; padrão `120000` ms;
- `REFINEMENT_RETRY_BASE_MS`: espera inicial entre retries; padrão `1000` ms;
- `REFINEMENT_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms.

O refinamento recebe os blocos estruturados produzidos pelo STT e devolve somente pares de
`id` e `text`. O código rejeita qualquer resposta que remova, acrescente ou reordene IDs e sempre
reutiliza falante e timestamps do Whisper. O prompt pede uma revisão conservadora de erros
ortográficos, fonéticos e contextuais evidentes, preservando o idioma original de cada fala; ele não
contém lista de nomes, palavras-chave ou vocabulário controlado e nunca traduz a reunião.
Quando uma tentativa excede o timeout durante o envio ou a leitura da resposta, ou quando o modelo
devolve uma estrutura incompatível para um lote com várias falas, o Summyz divide o lote
recursivamente e tenta novamente as partes menores. Uma tentativa interrompida sem ID de geração é
encerrada como falha de custo não atribuível, em vez de permanecer indefinidamente pendente.
Indisponibilidade sem timeout e falha em uma única fala continuam seguindo a política de retry
durável.

Antes da primeira chamada, o Summyz preserva atomicamente a saída original em
`transcript.raw.txt`. Se o modelo ou a resposta estruturada falhar nas três tentativas, restaura o
original em `transcript.txt`, registra o fallback em `refinement.json` e continua normalmente para
o resumo e a publicação. O Discord não recebe um aviso específico desse fallback, pois a
transcrição original continua disponível.

## Configurações de resumo

- `provider`, `model`, `language`, `maxChunkCharacters`, `extractionPrompt`,
  `consolidationPrompt` e opções de geração pertencem ao perfil;
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
um post no fórum escolhido. Com o idioma do servidor configurado como `en`, o post de sucesso usa
o nome `Summary — MM/DD/YYYY HH:mm — Voice channel name`; com `pt-BR`, usa
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

Quando a retenção de áudio está desativada, os áudios são excluídos assim que a transcrição completa
é validada e persistida, ou após a falha definitiva. Depois da publicação, os demais arquivos
temporários são excluídos se a retenção de conteúdo estiver desativada. O conteúdo preservado
permanece no PostgreSQL e o áudio preservado permanece em `DATA_DIR` até que o operador os exclua.

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
`docker compose --profile benchmark run --rm benchmark`. Ele só mede reuniões
que ainda possuem todos os áudios.

## Contribuição

Contribuições são bem-vindas.

1. Faça um fork do repositório e crie uma branch para a funcionalidade.
2. Mantenha os módulos pequenos e com uma única responsabilidade, siga a estrutura existente.
3. Adicione testes para novas lógicas — `npm test` deve passar.
4. Abra um pull request descrevendo a mudança e sua motivação.

Para relatar bugs ou solicitar funcionalidades, abra uma issue.
