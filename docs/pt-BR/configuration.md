# Configuração

[English](../configuration.md) · [Início da documentação](./README.md)

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
3. Ainda em **Bot**, ative o intent privilegiado **Server Members Intent**. O Summyz usa os
   intents `Guilds`, `Guild Members` e `Guild Voice States`; o intent de membros permite contar
   somente os membros humanos visíveis ao bot em cada cargo. Se ele estiver desativado, gravação e
   publicação continuam funcionando, mas a API informa
   `discord_members_intent_unavailable` e não exibe contagens possivelmente incorretas.
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

O dashboard mostra apenas os servidores nos quais o bot configurado está instalado e fornece uma
ação genérica para instalar o bot em outro servidor. Se o bot já
estiver instalado, alterar as permissões padrão no Developer Portal não atualiza automaticamente o
cargo existente: ajuste as permissões do cargo do bot e as sobrescritas do canal onde as reuniões
serão publicadas, ou reinstale o bot com o novo link.

As permissões Enviar mensagens, Enviar mensagens em threads, Ler histórico de mensagens e Anexar
arquivos devem estar liberadas também nas configurações específicas do fórum, quando houver
sobrescritas. `Enviar mensagens` sozinho não permite responder dentro de um post.

Depois de adicionar o bot, use `/recording-role add` para autorizar os cargos desejados e
`/recording-summary-forum set` para definir o fórum das publicações. Novas gravações ficam
bloqueadas enquanto não houver um fórum configurado. Consulte a [referência de comandos](./reference/bot-commands.md)
para ver todos os comandos e regras de acesso.

Somente o dono literal do servidor Discord pode gerenciar fórum, cargos autorizados e custos.
Permissões de Administrador ou Gerenciar servidor não concedem essa gestão. O dono e os cargos que
ele autorizar podem usar `/record` e `/stop`; os cargos não recebem outros poderes.

## Perfis de processamento

Os perfis são globais da instalação e podem ser reutilizados em todos os servidores nos quais o bot
está instalado. Cada etapa escolhe seu provedor independentemente; o backend calcula os tipos
**API externa**, **Local** ou **Híbrido**. Uma instalação nova recebe apenas `Perfil 1`/`Profile 1`,
com provedores e modelos vazios. Um perfil ativo não pode ser excluído.

Cada servidor mantém no máximo um desses perfis como ativo, independentemente do tipo. Servidores
novos começam sem perfil ativo; enquanto transcrição, refinamento e resumo do perfil escolhido não
tiverem modelos explícitos, `/record` mostra um aviso efêmero e não inicia a gravação. Trocar um
modelo preserva os demais parâmetros do perfil. Se
o bot sair de um servidor, ele deixa de aparecer no dashboard, mas seus dados persistidos são
preservados. Reinstalar o mesmo bot nesse servidor torna esses dados visíveis novamente.

O Summyz não escolhe modelos automaticamente. A escolha deve pertencer ao catálogo do provedor e
o Summyz nunca substitui o modelo selecionado. Salvar exige as três etapas completas; arquivos locais
podem ser instalados depois, mas sua ausência bloqueia a gravação. A avaliação local usa os estados
`recommended`, `compatible`,
`above_recommended`, `unknown` e `incompatible`: somente `incompatible` bloqueia a gravação;
`above_recommended` e `unknown` geram avisos privados. O `language` do resumo e o
`transcription.language` do perfil usam um catálogo de tags BCP 47 e têm `auto` como
padrão. Cada fase guarda o provedor, modelo e parâmetros próprios. Isso inclui batching e opções de
STT, tamanho de chunks e as opções de geração `temperature`, `seed` e `think` quando aplicáveis.
Valores não definidos não são
forçados pelo Summyz, preservando os padrões do provedor.

O dashboard mostra integralmente os prompts editáveis de transcrição, refinamento, extração e
consolidação. **Sem prompt** remove apenas a personalização: um prompt-base imutável do Summyz
sempre é enviado para fixar idioma, estrutura, evidências, preservação literal e regras de segurança.
Transcrições e prompts editáveis são tratados como conteúdo não confiável. O padrão de transcrição
não possui bloco editável. Os demais padrões nascem em inglês ou pt-BR conforme o idioma global do
dashboard. A tela busca os prompts padrão do resumo para o idioma efetivo: o `language` explícito do
resumo ou `transcription.language` quando o resumo está em `auto`. Alterar qualquer uma dessas
configurações, quando isso muda o idioma efetivo, adapta os prompts de resumo ainda iguais ao padrão
anterior; textos personalizados são preservados. O botão **Restaurar padrão** usa o idioma atual do
dashboard. Os prompts e modelos efetivos são fixados no manifesto quando a reunião começa, sem
mudança silenciosa em retomadas.

Com `transcription.language: auto`, a transcrição detecta o idioma falado e preserva as alternâncias;
cada lote contribui uma vez para determinar o idioma primário predominante. Um
`transcription.language` explícito é enviado ao provedor de transcrição. Um `language` explícito para
o resumo tem prioridade. Se o `language` do resumo for `auto`, o Summyz usa o idioma explícito da
transcrição, quando houver, ou o idioma predominante detectado. O modelo gera o resumo diretamente
nesse idioma; não há fase separada de tradução.

O Summyz confere o idioma primário do resumo gerado. Se não conseguir confirmar o idioma solicitado,
gera o resumo inteiro novamente, até três gerações no total. Após a terceira sem confirmação,
publica o último resumo no fórum sem alteração e mostra um aviso somente no detalhe da reunião no
dashboard. Nenhum aviso de idioma ou DM privada é enviado pelo Discord. A detecção pode ser
inconclusiva para textos curtos; variantes regionais do mesmo idioma primário são aceitas.

Perfis externos exigem que o catálogo da OpenRouter esteja acessível antes de gravar. O modelo de
transcrição deve anunciar entrada de áudio e saída de transcrição. O catálogo STT não informa de
forma confiável o parâmetro `response_format`, por isso a resposta com timestamps é validada durante
o processamento. Refinamento e resumo exigem entrada e saída de texto e suporte anunciado
a `response_format`. Perfis locais carregam o checkpoint faster-whisper e exigem a capacidade
`multilingual=true` reportada pelo checkpoint real. `tiny.en`, `base.en`, `small.en`, `medium.en`,
convertidos equivalentes e checkpoints cuja capacidade não possa ser determinada são bloqueados
antes de qualquer áudio ou chamada de processamento. Não há detector auxiliar de transcrição nem
catálogo de compatibilidade entre modelos generativos e idiomas. O idioma do resumo é conferido
separadamente.

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
- `TRANSCRIPTION_RETRY_MAX_MS`: espera máxima entre retries; padrão `30000` ms.

Na fase de transcrição, cada perfil define:

- `provider` e `model`, ambos obrigatórios para o perfil ficar completo;
- `language`: `auto` para detectar o idioma falado ou uma tag BCP 47 explícita para orientar a
  transcrição;
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

Somente a transcrição com faster-whisper expõe `batchSize`: `auto`, `0` para desativar ou um inteiro de `1` a `64`.
No faster-whisper, o lote é uma otimização de inferência e continua produzindo timestamps por
palavra. Para APIs externas, o Summyz otimiza requisições independentes por meio de
`TRANSCRIPTION_CONCURRENCY`.

## Dashboard e histórico

O Dashboard e o Histórico mostram apenas servidores onde o bot configurado está instalado. O seletor
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

O VAD é configurado na aba própria do perfil e pode ser desativado. Etapas de transcrição com OpenRouter usam o
detector Silero do Summyz antes de enviar áudio. Transcrição com faster-whisper não executa esse
detector: somente o VAD nativo do faster-whisper faz o pré-processamento. Assim, nunca há dois VADs
em sequência. Cada tipo preserva os padrões e limites próprios do seu detector; limiar de fala,
limiar negativo, fala mínima, silêncio de encerramento e margem de fala são persistidos no perfil.
A transcrição com faster-whisper também permite controlar a duração máxima de uma região de fala. Valores `auto`
mantêm o comportamento nativo conhecido do faster-whisper para o modo normal ou em lote.

Com transcrição OpenRouter e VAD ativo, segmentos sem voz são concluídos como silêncio, com zero
tentativas externas. Somente os intervalos detectados como voz são consolidados em WAV sem perdas
dentro dos limites configurados. Pequenos silêncios sintéticos podem preservar fronteiras de
enunciados. Um mapa temporal exclui essas pausas e recoloca cada trecho no relógio original depois
da transcrição, sem misturar participantes. Com transcrição local, o áudio consolidado chega ao
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
