# Configuração

[English](../configuration.md) · [Início da documentação](./README.md)

Siga [instalação](./installation.md) para o setup inicial. Este guia explica as credenciais da
instalação, acesso aos servidores, escolhas de IA e parâmetros de execução. Comportamento no uso,
custos e recuperação estão em [operação](./operations.md).

## Credenciais da instalação e conexão Discord

Token do bot, Client Secret Discord e chave OpenRouter são segredos da instalação criptografados
no PostgreSQL com `SUMMYZ_SECRETS_KEY`, mantida no `.env`. Configure as credenciais pelo fluxo da
instalação; os valores armazenados não são devolvidos ao dashboard.

O token é validado no Discord e determina o Application ID. O Client Secret deve pertencer à mesma
aplicação. Registre `<PUBLIC_BASE_URL>/api/discord/callback` como redirecionamento OAuth e conecte
a conta Discord do dono dos servidores. O Summyz solicita `identify guilds`, armazena tokens de
acesso e renovação criptografados e os renova quando necessário. O estado da autorização é de uso
único e expira em dez minutos. Conectar ou substituir a conta revoga as sessões existentes do
dashboard; no modo público, é necessário entrar novamente com a senha.

Acesso ao dashboard e propriedade do servidor são verificações separadas. O modo local não exige
senha; o público usa uma senha da instalação. Nenhum modo cria contas Summyz ou cadastro público.
A conexão Discord estabelece quais servidores podem ser configurados.

Configure uma chave OpenRouter somente se alguma etapa o utilizar. Uma etapa local nunca envia
seu conteúdo ao OpenRouter como fallback. Rotação do token e troca da aplicação possuem restrições
diferentes; consulte [operação](./operations.md#substituição-do-token-e-da-aplicação-do-bot).

## Propriedade e acesso aos servidores

Configurar um servidor exige bot instalado e conta Discord conectada do dono literal do servidor.
Permissões Administrador ou Gerenciar servidor não concedem gestão do Summyz. Todos os comandos
conhecidos do bot também exigem que essa conexão corresponda ao proprietário atual.

O dono pode gerenciar fórum, autorizações, perfil ativo, ativação e consultas de custo. Cargos e
membros individuais autorizados podem iniciar e encerrar gravações, sem adquirir poderes de gestão.
Autorizações individuais ficam vinculadas à participação atual do membro; sair e entrar novamente
não restaura automaticamente a autorização individual anterior.

O primeiro proprietário observado é confirmado automaticamente. Se houver troca de dono, o acesso
à gravação é suspenso. Conecte o novo proprietário, revise fórum, perfil e autorizações e confirme
a configuração com `/recording-activate` ou pelo fluxo de ativação do servidor. A confirmação exige
fórum e perfil ativo completo. Ativar não instala modelos nem ignora as verificações anteriores à gravação.

A lista também inclui servidores históricos com reuniões gravadas e servidores da conta conectada
onde o bot pode ser instalado. O acesso às reuniões históricas está descrito em
[operação](./operations.md#histórico-custos-e-tarefas).

## Fórum e autorizações de gravação

Use Guild Install com os escopos `bot` e `applications.commands`. O link de instalação solicita:

- Ver registro de auditoria;
- Ver canais;
- Conectar;
- Enviar mensagens;
- Enviar mensagens em threads;
- Ler histórico de mensagens;
- Anexar arquivos.

Ver registro de auditoria permite verificar se um canal de voz ausente foi excluído durante a
recuperação. O bot verifica permissões efetivas no servidor, canal de voz, chat de avisos e fórum.
Permissões ausentes ou falhas na inspeção geram avisos estruturados; operações reais no Discord
ainda podem falhar. Reinstalar ou mudar as permissões padrão da aplicação não elimina a necessidade
de conferir o cargo existente do bot e as sobrescritas dos canais.

Configure um fórum e, se ele exigir tags, selecione uma tag existente. Ver canais, Enviar mensagens,
Enviar mensagens em threads, Ler histórico de mensagens e Anexar arquivos precisam estar liberadas
nesse fórum. Enviar mensagens sozinho não permite respostas em posts. O comando
`/recording-summary-forum set` valida as permissões do fórum antes de salvar.

Autorize cargos com `/recording-role add` ou configure cargos e membros individuais no servidor.
Ative **Server Members Intent** no Developer Portal para listagens de membros e contagens humanas
por cargo. Sem esse intent, os recursos de diretório informam `discord_members_intent_unavailable`;
gravação e publicação não dependem da exibição dessas contagens. Consulte a
[referência de comandos](./reference/bot-commands.md).

## Perfis e provedores por etapa

Perfis são globais da instalação. Cada servidor mantém no máximo um perfil ativo e começa sem
nenhum. Uma instalação nova cria apenas `Perfil 1`/`Profile 1`, nomeado no idioma do setup, sem
provedores nem modelos selecionados.

| Etapa | Provedor externo | Provedor local |
| --- | --- | --- |
| Transcrição | OpenRouter | faster-whisper |
| Refinamento | OpenRouter | Ollama |
| Resumo | OpenRouter | Ollama |

Escolha a execução e o modelo de cada etapa independentemente. O Summyz calcula o tipo: externo
quando todas usam OpenRouter, local quando todas são locais e híbrido quando há uma combinação.
Salvar exige as três etapas completas e modelos pertencentes ao catálogo de cada provedor. Os
arquivos locais podem ser instalados depois; sua ausência bloqueia a gravação.

Um perfil ativo não pode ser excluído. Alterar uma etapa preserva os parâmetros das demais.
Perfil ativo, provedores e modelos efetivos, idiomas,
prompts, VAD, parâmetros de geração e retenção ficam fixados no manifesto quando `/record` começa.
Edições posteriores valem para novas reuniões e não alteram silenciosamente a recuperação.

## Catálogos e modelos locais

Catálogos OpenRouter são filtrados pela capacidade da etapa: transcrição exige entrada de áudio e
saída de transcrição; refinamento e resumo exigem entrada/saída de texto e suporte anunciado a
`response_format`. O catálogo STT não informa esse parâmetro de forma confiável, por isso timestamps
por palavra são validados na resposta real da transcrição. Catálogo indisponível ou seleção inválida
bloqueia a validação; o Summyz nunca escolhe nem substitui modelos automaticamente.
Snapshots ficam atualizados por quinze minutos; se a atualização falhar, o cache pode ser usado
por até 24 horas com estado desatualizado. Sem snapshot utilizável, o catálogo fica indisponível.

Ollama usa famílias e variantes do catálogo. faster-whisper usa o catálogo do serviço. O inventário
local informa modelos instalados separadamente do catálogo. Baixe os modelos escolhidos e acompanhe
os estados em fila, baixando, concluído, cancelando, cancelado ou falhou. Transferências podem ser
canceladas. A fila gerenciada aceita até vinte jobs ativos de download; eles são persistidos para
que trabalho incompleto possa ser recuperado após reinício.

A exclusão local é bloqueada enquanto o modelo for necessário para reunião não terminal, janela
de recuperação preservada ou download ativo. Excluir arquivos não altera a seleção do perfil;
ele fica indisponível para gravar até que esses arquivos sejam instalados novamente.

As recomendações estimam o equilíbrio entre qualidade e velocidade para a etapa e o dispositivo
escolhidos. Consideram núcleos e RAM na CPU, compatibilidade e VRAM na GPU, além de características
do modelo, como tamanho dos arquivos quantizados e quantidade de parâmetros quando disponíveis.
CPU e RAM são limitadas aos recursos expostos ao ambiente da instalação, inclusive à VM do Docker.
Não são benchmarks: informações insuficientes resultam em avaliação desconhecida, sem inventar
uma recomendação nem substituir o modelo escolhido.

A avaliação de hardware usa `recommended`, `compatible`, `above_recommended`, `unknown` e
`incompatible`. O último bloqueia a gravação; `above_recommended` e `unknown` geram avisos privados
sem trocar o modelo. Arquivos instalados e disponibilidade dos provedores são verificações adicionais.
faster-whisper carrega o checkpoint real e exige `multilingual=true`; checkpoints monolíngues como
`tiny.en`, `base.en`, `small.en`, `medium.en`, conversões equivalentes e capacidades desconhecidas
são bloqueados antes da captura. Modelos Ollama são verificados quanto ao contrato de saída
estruturada na inicialização. Modelos reprovados são descarregados e removidos quando nenhuma etapa
válida os utiliza.

## Idiomas e prompts

Dashboard, mensagens do bot, transcrição e resumo possuem escolhas de idioma separadas. O dashboard
suporta `en` e `pt-BR`, detecta o primeiro idioma suportado do navegador e usa inglês como fallback.
Idioma da interface, tema e formatos de data/hora são preferências do navegador. Datas e filtros
usam seu fuso IANA aceito, com UTC como fallback. Essas escolhas não alteram mensagens do bot ou
processamento das reuniões.

O idioma do bot por servidor controla avisos de gravação e formatação de datas nas publicações.
`transcription.language` e `language` do resumo usam o catálogo BCP 47 suportado e têm `auto` como
padrão. Um idioma explícito de transcrição orienta o provedor; `auto` detecta o idioma falado e
preserva alternâncias. Cada lote contribui uma vez para o idioma primário predominante.

Um idioma explícito de resumo tem prioridade. Com resumo em `auto`, o Summyz usa o idioma explícito
da transcrição ou, se ambos forem `auto`, o idioma predominante detectado. O resumo é gerado
diretamente nesse idioma, sem etapa de tradução. Se o idioma primário não puder ser confirmado,
o Summyz gera o resumo inteiro novamente, até três gerações no total. Depois publica o último
resultado sem alterações e mostra um aviso somente no detalhe da reunião. Textos curtos podem ser
inconclusivos; variantes regionais do mesmo idioma primário são aceitas.

Transcrição, refinamento, extração e consolidação do resumo possuem prompts editáveis. Remover uma
personalização nunca remove o prompt-base imutável que impõe idioma, estrutura, evidências,
preservação literal e segurança. Transcrições e prompts editáveis são entradas não confiáveis.
A transcrição não tem instrução editável por padrão; os demais padrões são armazenados em inglês
e apresentados no idioma do dashboard.

Cada prompt usa explicitamente o modo `default` ou `custom`. Mudar o idioma efetivo do resumo adapta
os padrões e preserva literalmente os textos customizados. Restaurar o padrão envia o modo, em vez
de reconhecer padrões por comparação de texto. Os prompts efetivos permanecem fixados na reunião.

## Escolhas de retenção

Servidores novos retêm conteúdo por padrão e não retêm áudio. Configure cada política separadamente
por servidor. As escolhas ficam fixadas no início da gravação; editá-las não remove retroativamente
reuniões já preservadas. Conteúdo fica no PostgreSQL; bytes de áudio ficam em `DATA_DIR`, com
metadados e caminhos relativos no PostgreSQL. Dados preservados não expiram automaticamente.
Consulte [retenção e backups](./operations.md#retenção-e-backups) para os momentos de exclusão e
o escopo do backup.

## Execução local e VAD

O dispositivo é escolhido no dashboard, separadamente em cada etapa local do perfil: `auto`,
`cpu` ou `gpu`. Novas etapas locais começam em `auto`. Etapas via API não possuem essa escolha.
`auto` usa uma GPU compatível quando o serviço correspondente está disponível; caso contrário,
usa CPU. `gpu` exige esse serviço e fica desabilitado quando ele está indisponível. Uma escolha
explícita de GPU não tem fallback para CPU, mesmo se perder disponibilidade depois de salvar.
A escolha efetiva é fixada para a reunião no início da gravação. Não existem flags de dispositivo
no launcher nem variáveis de dispositivo no `.env`. O dispositivo ativo aparece nos logs estruturados.

CPU e GPU usam instâncias separadas do Ollama e do faster-whisper, na rede privada do Compose.
As instâncias CPU gerenciam os downloads; as instâncias GPU compartilham os mesmos arquivos
com acesso somente para leitura. Cada etapa é encaminhada à instância do dispositivo escolhido.
faster-whisper faz warm-up e verifica CUDA antes do processamento. AMD ROCm acelera somente
Ollama no Linux; faster-whisper exige NVIDIA para transcrever por GPU. Em um host apenas AMD,
a transcrição local em `auto` usa CPU; GPU permanece indisponível nessa etapa. Docker Desktop
no Windows expõe GPUs NVIDIA, não AMD. Intel, Apple e fabricantes desconhecidos não possuem
perfil de contêiner de aceleração compatível nesta etapa.

Mudanças de hardware detectadas no host atualizam o dashboard por eventos, sem verificações
periódicas do inventário. A disponibilidade dos serviços também é verificada ao consultar o
catálogo ou preparar uma gravação. Uma GPU nova pode exigir executar o launcher novamente para
preparar seu serviço; a detecção não recria containers nem amplia seu acesso a dispositivos.

O VAD pertence à etapa de transcrição. OpenRouter usa o detector Silero do Summyz; faster-whisper
usa somente seu VAD nativo, sem aplicar dois detectores em sequência. O VAD pode ser desativado.
Seus parâmetros incluem limiar, limiar negativo, fala mínima, silêncio de encerramento e margem
de fala; faster-whisper também aceita duração máxima de região de fala e valores nativos `auto`.

Com VAD externo ativo, segmentos sem voz terminam como silêncio, sem tentativas externas. Falas
da mesma pessoa são consolidadas em WAV sem perdas, com silêncio sintético opcional entre falas.
Um mapa temporal restaura os timestamps originais sem misturar participantes. A transcrição local
recebe áudio consolidado e aplica o VAD do faster-whisper.

O Summyz não força globalmente `think=false`, `temperature=0` ou `seed=0`. Opções omitidas preservam
padrões do provedor/modelo. OpenRouter pode rotear entre provedores compatíveis do modelo escolhido;
nenhuma etapa tem fallback automático para outro provedor configurado.

## Ambiente e parâmetros de execução

Use `.env.example` como modelo de infraestrutura. Os launchers geram segredos; provedor, modelo,
idioma, retenção e prompts pertencem às configurações persistidas da instalação/servidor/perfil.

| Variável | Finalidade / padrão |
| --- | --- |
| `DATABASE_URL` | URL PostgreSQL obrigatória; `postgres:5432` dentro do Compose |
| `SUMMYZ_SECRETS_KEY` | Chave de criptografia obrigatória gerada pelo launcher |
| `SUMMYZ_SETUP_TOKEN` | Obrigatória na inicialização da API; gerada pelo launcher e verificada no setup público |
| `WEB_HOST`, `WEB_PORT` | Endereço e porta da API nativa ou da publicação do dashboard no Docker; padrões `127.0.0.1`, `8787` |
| `PUBLIC_BASE_URL` | Origem do dashboard e base do callback OAuth; padrão `http://127.0.0.1:8787` |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Credenciais do banco Compose; senha gerada pelo launcher |
| `POSTGRES_PORT` | Porta no host; `.env.example` define `5433`, mas Compose usa `5432` quando omitida |
| `FFMPEG_PATH` | Caminho absoluto opcional do FFmpeg nativo; sem ele, usa `PATH` |

O launcher cria `DATABASE_URL` para a rede Compose com `postgres:5432`. Na execução nativa, ajuste-a
para o endereço do host e `POSTGRES_PORT` publicado. Os demais parâmetros estão abaixo.

No Docker, `WEB_HOST` configura o IP de publicação no host; a API escuta internamente em
`0.0.0.0:8787` para receber o tráfego encaminhado. O padrão é `127.0.0.1`, mas você pode escolher
`0.0.0.0` ou um IP de interface da máquina. Essa configuração não altera as portas 80/443 do Caddy
nem a publicação de PostgreSQL. O modo local continua sem senha e rejeita cabeçalhos `Host` e
origens que não sejam de loopback; publicar a porta em outro IP não habilita acesso local pela rede.
O cabeçalho `Host` não autentica o cliente: publicar o modo local em interfaces externas expõe
uma API sem senha. Para acesso pela rede, execute no modo público com HTTPS.

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
- `TRANSCRIPTION_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms.

Na fase de transcrição, cada perfil define:

- `provider` e `model`, ambos obrigatórios para o perfil ficar completo;
- `language`: `auto` para detectar o idioma falado ou uma tag BCP 47 explícita para orientar a
  transcrição;
- `temperature`: temperatura da transcrição;
- timestamps por palavra são obrigatórios; uma API externa incompatível encerra a transcrição sem
  aproximação por segmento ou pela duração inteira do lote;
- `interSpeechSilenceMs`: silêncio WAV inserido somente entre intervalos reais de voz do lote;
  padrão `0` ms;
- `mergeMaxGapMs`: intervalo máximo para consolidar falas da mesma pessoa neste perfil;
  padrão `2000` ms;
- `prompt`: instrução editável para orientar o estilo da transcrição, ou `null` para usar somente o
  prompt-base;
- `providerOptions`: opções opcionais agrupadas pelo slug do provedor conforme o contrato do
  OpenRouter.

Somente a transcrição com faster-whisper expõe `batchSize`: `auto`, `0` para desativar ou um inteiro de `1` a `64`.
No faster-whisper, o lote é uma otimização de inferência e continua produzindo timestamps por
palavra. Para APIs externas, o Summyz otimiza requisições independentes por meio de
`TRANSCRIPTION_CONCURRENCY`.

## Configurações de refinamento

- `provider`, `model`, `maxChunkCharacters`, `prompt` e opções de geração pertencem ao perfil;
  `maxChunkCharacters` tem padrão `500000`;
- `REFINEMENT_MAX_ATTEMPTS`: total de tentativas por bloco; padrão `3`;
- `REFINEMENT_TIMEOUT_MS`: timeout de cada tentativa; padrão `120000` ms;
- `REFINEMENT_RETRY_BASE_MS`: espera inicial entre retries; padrão `1000` ms;
- `REFINEMENT_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms.

O refinamento recebe os blocos estruturados produzidos pelo STT e devolve somente pares de
`id` e `text`. O código rejeita qualquer resposta que remova, acrescente ou reordene IDs e sempre
reutiliza falante e timestamps da transcrição. O prompt pede uma revisão conservadora de erros
ortográficos, fonéticos e contextuais evidentes, preservando o idioma original de cada fala; ele não
contém lista de nomes, palavras-chave ou vocabulário controlado e nunca traduz a reunião.
Quando uma tentativa excede o timeout durante o envio ou a leitura da resposta, ou quando o modelo
devolve uma estrutura incompatível para um lote com várias falas, o Summyz divide o lote
recursivamente e tenta novamente as partes menores. Uma tentativa interrompida sem ID de geração é
encerrada como falha de custo não atribuível, em vez de permanecer indefinidamente pendente.
Indisponibilidade sem timeout e falha em uma única fala continuam seguindo a política de retry
durável.

Antes da primeira chamada, o Summyz preserva atomicamente a saída original em
`transcript.raw.txt`. Falhas do provedor seguem primeiro as tentativas por chamada configuradas e
a política de retry durável do processamento. Se o provedor ainda falhar na última tentativa
durável, o Summyz restaura o original em `transcript.txt`, registra o fallback em `refinement.json`
e segue para o resumo e a publicação. O Discord não recebe um aviso específico desse fallback,
pois a transcrição original continua disponível.

## Configurações de resumo

- `provider`, `model`, `language`, `maxChunkCharacters`, `extractionPrompt`,
  `consolidationPrompt` e opções de geração pertencem ao perfil;
  `maxChunkCharacters` tem padrão `500000`;
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
eles aparecem em **Pendências e observações**. O Discord preserva o texto original do prazo.
O resultado estruturado também pode manter uma data ou prazo com precisão de minuto validado e seu
fuso da reunião para organizar tarefas no dashboard; esses metadados nunca substituem o texto
literal no post.
