# Summyz

Summyz é um bot para Discord que grava calls sob comando, transcreve o áudio de cada participante e
publica resumos com decisões e tarefas.

O Summyz grava cada participante separadamente e, depois do encerramento normal da call, transcreve
os segmentos por meio do OpenRouter e monta um arquivo único preservando falantes, timestamps e
falas sobrepostas. Uma segunda etapa revisa apenas o texto da transcrição, sem
permitir que o modelo altere IDs, falantes, timestamps ou ordem. Em seguida, gera um resumo
estruturado e publica em uma thread do Discord o resumo executivo, os tópicos discutidos, as
decisões, as tarefas e a transcrição completa.

## Requisitos

- Node.js 22.12 ou superior;
- npm;
- uma aplicação de bot criada no Discord Developer Portal;
- uma conta no OpenRouter com créditos e uma chave de API;
- FFmpeg não precisa ser instalado separadamente: o projeto usa um binário empacotado.

## Configuração local

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env`.
3. Preencha `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `OPENROUTER_API_KEY`,
   `OPENROUTER_TRANSCRIPTION_MODEL`, `OPENROUTER_REFINEMENT_MODEL` e
   `OPENROUTER_SUMMARY_MODEL`.
4. Para desenvolvimento, preencha `DISCORD_GUILD_ID` com o ID do servidor de teste. Sem essa
   variável, os comandos são registrados globalmente e podem demorar para aparecer.
5. Execute `npm run dev`.

Nunca versione o arquivo `.env` nem publique o token do bot.

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
- Criar threads públicas;
- Enviar mensagens em threads;
- Ler histórico de mensagens;
- Anexar arquivos;
- Usar comandos de aplicativo.

Use o link fornecido pela página **Installation** para adicionar o bot ao servidor. Se o bot já
estiver instalado, alterar as permissões padrão no Developer Portal não atualiza automaticamente o
cargo existente: ajuste as permissões do cargo do bot e as sobrescritas do canal onde as reuniões
serão publicadas, ou reinstale o bot com o novo link.

As permissões Criar threads públicas, Enviar mensagens em threads, Ler histórico de mensagens e
Anexar arquivos devem estar liberadas também nas configurações específicas do canal, quando houver
sobrescritas. `Enviar mensagens` sozinho não permite escrever dentro de uma thread.

Depois de adicionar o bot, use `/recording-role add` para autorizar os cargos desejados. Consulte
[BOT_COMMANDS.md](./BOT_COMMANDS.md) para ver todos os comandos e regras de acesso.

## Configurações de gravação

- `DATA_DIR`: diretório dos arquivos; padrão `./data`;
- `SEGMENT_SILENCE_MS`: silêncio que encerra um segmento; padrão `1000` ms;
- `SEGMENT_MAX_SECONDS`: duração máxima de cada segmento contínuo; padrão `60` s;
- `VOICE_RECONNECT_MAX_MS`: tempo máximo de reconexão; padrão `300000` ms;
- `LOG_LEVEL`: nível dos logs estruturados; padrão `info`.

Os arquivos são salvos em
`data/recordings/<meetingId>/participants/<userId>/<segmentId>.ogg`. O `manifest.json` da reunião
registra participantes, segmentos, interrupções e métricas de recepção.

## Configurações de transcrição

- `OPENROUTER_API_KEY`: chave usada nos endpoints de transcrição, refinamento e resumo;
- `OPENROUTER_TRANSCRIPTION_MODEL`: modelo STT escolhido no OpenRouter, sem padrão implícito;
- `TRANSCRIPTION_MODEL_PROFILES_FILE`: arquivo JSON com a configuração individual de cada modelo;
  padrão `./config/transcription-model-profiles.json`;
- `TRANSCRIPTION_CONCURRENCY`: lotes processados simultaneamente; padrão `2`;
- `TRANSCRIPTION_VAD_THRESHOLD`: probabilidade mínima de voz no detector Silero local; padrão `0.5`;
- `TRANSCRIPTION_VAD_MIN_SPEECH_MS`: duração mínima aproximada de voz; padrão `96` ms;
- `TRANSCRIPTION_MERGE_MAX_GAP_MS`: intervalo máximo para consolidar falas próximas da mesma
  pessoa; padrão `2000` ms;
- `TRANSCRIPTION_WINDOW_MAX_SECONDS`: duração máxima de um lote consolidado; padrão `30` s;
- `TRANSCRIPTION_MAX_ATTEMPTS`: total de tentativas por lote; padrão `4`;
- `TRANSCRIPTION_TIMEOUT_MS`: timeout de cada tentativa; padrão `90000` ms;
- `TRANSCRIPTION_RETRY_BASE_MS`: espera inicial entre retries; padrão `1000` ms;
- `TRANSCRIPTION_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms;
- `FAILED_RECORDING_RETENTION_HOURS`: retenção de reuniões cuja transcrição foi perdida; padrão
  `24` horas.

O modelo configurado precisa possuir uma entrada com o mesmo slug em
[`config/transcription-model-profiles.json`](./config/transcription-model-profiles.json). O Summyz
valida todos os perfis e falha antes de se conectar ao Discord se o arquivo for inválido ou o modelo
ativo não tiver perfil. O modelo continua sendo escolhido pelo `.env`; nenhuma configuração de um
perfil é herdada por outro.

Cada perfil define:

- `language`: idioma enviado ao provedor; pode ser omitido quando o modelo exige detecção automática;
- `temperature`: temperatura da transcrição;
- `timestampMode`: `word` para timestamps detalhados ou `batch` para texto sem timestamps;
- `interSpeechSilenceMs`: silêncio WAV inserido somente entre intervalos reais de voz do lote;
- `mergeMaxGapMs`: sobrescrita opcional do intervalo máximo global para consolidar falas da mesma
  pessoa;
- `prompt`: instrução textual opcional para orientar o estilo da transcrição;
- `providerOptions`: opções específicas opcionais, agrupadas pelo slug do provedor conforme o
  contrato do OpenRouter.

Os perfis do Whisper mantêm `pt-BR`, `temperature: 0`, timestamps por palavra e nenhuma pausa
sintética, preservando o comportamento anterior. O perfil `deepgram/nova-3` também usa `pt-BR` e
timestamps por palavra, mas insere 350 ms entre intervalos de voz. Esse valor foi escolhido em um
teste controlado: 200 e 500 ms perderam a palavra “não”, enquanto 350 ms preservou “Não, concordo.
Realmente.”. As opções `smart_format` e `utterances` não foram ativadas porque pioraram esse áudio.

O modelo `mistralai/voxtral-mini-transcribe` possui um perfil específico porque sua integração no
OpenRouter aceita somente `response_format: "json"`, rejeita `pt-BR` e não devolve timestamps. Para
ele, o Summyz usa detecção automática de idioma e representa cada resposta com o início e o fim do
lote real de voz enviado. Assim, falantes e sobreposições continuam preservados, mas os timestamps
são precisos por lote, não por palavra ou frase.

Os perfis `openai/gpt-transcribe` e `openai/gpt-4o-transcribe` usam `language: "pt"`,
`temperature: 0`, resposta JSON por lote e não unem segmentos distintos. O perfil
`openai/gpt-transcribe` usa um prompt genérico para orientar transcrição literal e preservação de
hesitações, sem pausa sintética. O perfil `openai/gpt-4o-transcribe` não usa prompt e insere 350 ms
entre intervalos internos de voz. Nenhum deles configura `keywords`, nomes, termos específicos ou
outro vocabulário controlado.

Embora a API direta da OpenAI documente formatos detalhados para `gpt-transcribe`, o endpoint atual
do OpenRouter rejeita a solicitação de timestamps por palavra. Assim, cada linha representa um único
segmento e preserva a ordem temporal das falas e sobreposições.

O slug `openai/gpt-transcribe` já é aceito pelo endpoint de transcrição do OpenRouter, ainda que não
apareça no catálogo público retornado por `/api/v1/models` no momento desta documentação.

Antes da API, o Summyz decodifica o áudio localmente e usa Silero VAD para confirmar a presença de
voz. Segmentos sem voz são concluídos como silêncio, com zero tentativas externas, e não aproximam
falas que estavam distantes na call. Somente os intervalos detectados como voz são consolidados em
WAV sem perdas quando o intervalo real entre as vozes não passa de 2 segundos, em janelas de até 30
segundos da mesma pessoa. Conforme o perfil ativo, pequenos silêncios sintéticos podem separar esses
intervalos para preservar fronteiras de enunciados. Um mapa temporal exclui essas pausas e recoloca
cada trecho no relógio original depois da transcrição, sem misturar participantes.

O OpenRouter pode rotear uma requisição entre provedores compatíveis com o modelo selecionado. O
Summyz aceita esse roteamento automático. Para requisitos de privacidade mais restritos, use as
configurações de privacidade da conta do OpenRouter ou um provedor local em uma evolução futura.

## Configurações de refinamento

- `OPENROUTER_REFINEMENT_MODEL`: modelo de texto que revisa a saída do STT; o exemplo recomenda
  `google/gemini-3.7-flash`;
- `REFINEMENT_CHUNK_MAX_CHARACTERS`: tamanho máximo aproximado de cada bloco, sempre dividido entre
  falas; padrão `500000` caracteres;
- `REFINEMENT_MAX_ATTEMPTS`: total de tentativas por bloco; padrão `3`;
- `REFINEMENT_TIMEOUT_MS`: timeout de cada tentativa; padrão `120000` ms;
- `REFINEMENT_RETRY_BASE_MS`: espera inicial entre retries; padrão `1000` ms;
- `REFINEMENT_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms.

O refinamento recebe os blocos estruturados produzidos pelo Whisper e devolve somente pares de
`id` e `text`. O código rejeita qualquer resposta que remova, acrescente ou reordene IDs e sempre
reutiliza falante e timestamps do Whisper. O prompt pede uma revisão conservadora de erros
ortográficos, fonéticos e contextuais evidentes; ele não contém lista de nomes, palavras-chave ou
vocabulário controlado.

Antes da primeira chamada, o Summyz preserva atomicamente a saída original em
`transcript.raw.txt`. Se o modelo ou a resposta estruturada falhar nas três tentativas, restaura o
original em `transcript.txt`, registra o fallback em `refinement.json` e continua normalmente para
o resumo e a publicação. O Discord não recebe um aviso específico desse fallback, pois a
transcrição original continua disponível.

## Configurações de resumo

- `OPENROUTER_SUMMARY_MODEL`: modelo de texto usado no resumo, configurado separadamente do modelo
  de transcrição; o exemplo recomenda `google/gemini-3.7-flash`;
- `SUMMARY_CHUNK_MAX_CHARACTERS`: tamanho máximo aproximado de cada bloco de transcrição; padrão
  `500000` caracteres;
- `SUMMARY_MAX_ATTEMPTS`: total de tentativas por chamada ao modelo; padrão `4`;
- `SUMMARY_TIMEOUT_MS`: timeout de cada tentativa; padrão `120000` ms;
- `SUMMARY_RETRY_BASE_MS`: espera inicial entre retries; padrão `1000` ms;
- `SUMMARY_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms;
- `SUMMARY_TIME_ZONE`: fuso IANA usado no título da thread; padrão `America/Sao_Paulo`.

O resumo usa saída estruturada validada. Transcrições maiores que o limite configurado são divididas
somente entre falas, resumidas por blocos e consolidadas. O Summyz mantém internamente as referências
às falas que sustentam decisões e tarefas, mas não publica essas evidências. Uma decisão ou tarefa
sem referência válida é removida. Responsável e prazo só são preservados quando aparecem exatamente
na fala referenciada; tarefas explícitas podem permanecer sem esses campos.

Pedidos vagos, como “alguém precisa decidir a ferramenta”, não são promovidos a decisão ou tarefa:
eles aparecem em **Pendências e observações**. Prazos são mantidos no texto original, sem conversão
automática de expressões como “amanhã” ou “até sexta-feira”.

## Resultado da transcrição

A transcrição começa automaticamente somente quando `/stop` conclui a gravação ou quando todas as
pessoas saem do canal. Gravações interrompidas por desligamento ou falha de conexão não são
processadas nesta etapa.

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
- a reunião completa é preservada por 24 horas e depois excluída automaticamente.

## Publicação no Discord

Depois da transcrição e do resumo, o Summyz publica no canal onde `/record` foi executado uma
mensagem curta e cria uma thread pública com arquivamento automático após sete dias de inatividade.
A thread de sucesso usa o nome `Resumo da call — DD/MM/AAAA HH:mm` e contém:

- resumo executivo;
- tópicos discutidos;
- decisões;
- tarefas, com responsável e prazo somente quando explícitos;
- pendências e observações;
- `transcript.txt` como arquivo anexo.

Se o resumo continuar falhando depois dos retries, a mensagem informa
`Transcrição da call disponível (Resumo indisponível)` e cria uma thread
`Transcrição — DD/MM/AAAA` contendo apenas o aviso genérico e `transcript.txt`.

Os estados ficam em `refinement.json`, `summary.json` e `publication.json`. IDs de mensagem e thread
são persistidos a cada passo e as mensagens usam nonces determinísticos, permitindo retomar a
publicação após reinício e reduzir duplicações. Como a API do Discord é externamente consistente, a
garantia é de publicação idempotente nas condições normais, não de atomicidade absoluta entre o
filesystem e o Discord.

Os áudios correspondentes a transcrições concluídas ainda não são excluídos automaticamente.

## Qualidade

Use `npm run check` antes de enviar mudanças. Esse comando valida formatação, lint, tipos, testes e
cobertura. Use `npm run security:audit` para verificar as dependências.

O decodificador Opus do MVP é `opusscript`, evitando a cadeia vulnerável encontrada na dependência
nativa avaliada. O procedimento para validar desempenho com até cinco participantes está em
[SMOKE_TEST.md](./SMOKE_TEST.md).
