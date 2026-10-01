# Operação

[English](../operations.md) · [Início da documentação](./README.md)

Consulte [instalação](./installation.md) para implantação e [configuração](./configuration.md)
para acesso aos servidores, perfis, modelos e parâmetros.

## Administrar a instalação

Execute na raiz do repositório:

```sh
./summyz-community status
./summyz-community logs
./summyz-community restart
./summyz-community down
```

Use `.\summyz-community.ps1` no Windows ou o launcher `summyz-community-public` / `.ps1` em
instalações públicas. `down` preserva os volumes nomeados. Não adicione `--volumes` sem desejar
uma exclusão permanente.

A visão de saúde informa banco, bot, worker, provedores, fila e heartbeats desatualizados. Logs
estruturados incluem falhas e contexto de retries. O Discord recebe erros genéricos sem stack
traces, caminhos internos, credenciais ou áudio bruto. Mantenha gravações, transcrições, dumps do
banco e URLs de setup/recuperação privados.

## Ciclo de gravação e processamento

Apenas uma gravação pode ficar ativa por servidor. `/record` exige proprietário conectado e
verificado, pessoa autorizada, fórum de publicação, perfil ativo completo, modelos disponíveis
e canal de voz convencional. Bots não são gravados; pessoas que entram depois são incluídas.

`/stop` exige que a pessoa esteja no canal gravado. Envia confirmação efêmera no chat da interação;
o aviso público menciona essa pessoa no chat onde `/record` começou. Quando todos saem, a gravação
termina automaticamente, o bot sai e o chat original informa que o áudio será processado. Avisos
de início, interrupção, retomada, encerramento, falha de transcrição e publicação ficam nesse chat.

O pipeline executa transcrição, refinamento, resumo e publicação por fila durável no PostgreSQL.
A entrega é at least once: um job reservado pode executar novamente após queda ou vencimento do
lease. Resultados das etapas são persistidos e a publicação pode ser retomada. Além dos retries
curtos dos provedores, falhas transitórias agendam execuções duráveis após 1 minuto, 5 minutos,
15 minutos, 1 hora e 6 horas: seis execuções incluindo a inicial. A ausência de um modelo local
mantém o processamento aguardando o modelo escolhido; o Summyz não o substitui nem troca para
um provedor externo.

## Transcrição e publicação

Áudios e `manifest.json` temporário ficam em `DATA_DIR/recordings/<meetingId>`. O manifesto
registra participantes, segmentos, interrupções, métricas e configuração fixada no início.
O processamento o sincroniza com PostgreSQL antes de reservar trabalho.

A transcrição completa é escrita atomicamente em `transcript.txt` somente quando cada segmento
tem sucesso ou é confirmado localmente como silêncio. O refinamento primeiro preserva
`transcript.raw.txt` e depois atualiza `transcript.txt`. Os trechos preservam falante e tempo,
incluindo sobreposições:

```text
[00:00:10.000 – 00:00:15.000] Ana: Vamos publicar amanhã.
[00:00:12.000 – 00:00:14.000] Bruno: Concordo.
```

Nomes iguais recebem sufixos estáveis como `Ana #1` e `Ana #2`; IDs de usuário permanecem nos
artefatos internos. Falhas na conversão PCM são tentadas novamente em Ogg ou empacotadas como WAV
sem perdas quando possível. Transcrição parcial não é oferecida como resultado bem-sucedido.

Antes de criar um post, o Summyz consulta a configuração mais recente do fórum. Uma alteração vale
se a publicação não começou; um ID de thread salvo mantém as mensagens seguintes no post original.
O post contém ID da reunião, resumo executivo, tópicos, decisões, tarefas, pendências/observações
e a transcrição completa anexada. Listas vazias são omitidas. Rótulos usam o idioma do resumo
quando disponíveis; datas usam o idioma do bot gravado no manifesto e `SUMMARY_TIME_ZONE`.

O título segue `<rótulo de resumo> — <data> <HH:mm> — <nome do canal de voz>`, com `MM/DD/YYYY`
para idioma do bot `en` ou `DD/MM/YYYY` para `pt-BR`, limitado a 100 caracteres. Sem resumo,
o post usa o rótulo de transcrição, explica a indisponibilidade do resumo e anexa a transcrição
completa. Os posts solicitam arquivamento após sete dias sem atividade; arquivar não exclui conteúdo.

`transcription.json`, `refinement.json`, `summary.json` e `publication.json` persistem trabalho
em andamento. IDs de mensagens e thread são salvos a cada passo e respostas usam nonces
determinísticos. A criação inicial do post não possui nonce, por isso uma interrupção entre criação
no Discord e persistência pode duplicar um post. Menções automáticas são desativadas na publicação.

## Falhas e recuperação

| Situação | Comportamento atual |
| --- | --- |
| Queda da conexão de voz | Avisa o chat original e tenta reconectar por `VOICE_RECONNECT_MAX_MS` (cinco minutos por padrão) |
| Reinício do processo | Preserva o áudio; verifica presença do bot, propriedade e disponibilidade do canal antes de retomar |
| Canal vazio | Finaliza o áudio parcial e agenda processamento |
| Verificação de propriedade inconclusiva na recuperação após reinício | Mantém a recuperação pendente, sem presumir permissão |
| Interrupção de recuperação chega a trinta minutos | Finaliza o áudio capturado sem retomar a gravação |
| Exclusão do canal de voz confirmada | Finaliza o áudio capturado sem retomar a gravação |
| Refinamento não conclui | Repete; na falha final do provedor usa a transcrição original e continua |
| Resumo não conclui | Repete; na falha final do provedor publica a transcrição completa sem resumo |
| Publicação falha | Preserva progresso para retries duráveis e informa falha genérica |

A janela de trinta minutos após reinício é separada do limite de cinco minutos de reconexão de voz.
A consulta ao registro de auditoria ajuda a confirmar exclusão quando a busca normal não resolve
o canal.

Se a transcrição não concluir, nenhum `transcript.txt` é disponibilizado e a falha fica persistida.
Falhas de provedor preservam áudio entre tentativas duráveis. Certas falhas de contrato da resposta
(`invalid_json`, `invalid_response_shape`, `invalid_timestamps`, `missing_language`, `missing_timestamps`)
preservam artefatos temporários de recuperação por 24 horas. Quando uma atualização aumenta a
versão de recuperação da transcrição, reuniões elegíveis são reagendadas automaticamente dentro
dessa janela. Outras falhas terminais acionam limpeza temporária conforme a retenção de áudio.

A limpeza é repetida pela manutenção periódica. Inicialização e migrations não excluem artefatos
de reuniões pendentes. Não existem comandos públicos Discord de status, retry ou exclusão.

## Troca de proprietário e saída do bot

Quando detecta um novo dono, o Summyz encerra a gravação ativa e suspende novas gravações até que
o novo proprietário conectado revise fórum, perfil ativo e autorizações e confirme a configuração
com `/recording-activate` ou pela ativação do servidor. O áudio capturado é finalizado para
processamento; reuniões concluídas e custos permanecem no histórico da instalação.

Se o bot sair ou for removido, a gravação ativa termina e reuniões não terminais e jobs pendentes
são marcados como falha com `bot_left_guild`. A limpeza temporária respeita a retenção de áudio.
Reuniões históricas permanecem disponíveis; reinstalar o bot não reinicia automaticamente esses
jobs cancelados. Configurar o servidor volta a exigir dono conectado e bot instalado.

## Substituição do token e da aplicação do bot

O Summyz valida o novo token e obtém seu Application ID antes de salvar. O mesmo par token/aplicação
já armazenado não provoca mudança. Quando o token muda:

- a mesma aplicação não pode trocar seu token enquanto houver reunião gravando; etapas posteriores
  do pipeline podem permanecer pendentes;
- uma aplicação diferente não pode substituir o bot enquanto houver qualquer reunião não terminal.

Após uma alteração bem-sucedida, o processo supervisionado detecta a configuração e reinicia o bot
para carregar as novas credenciais. Trocar a aplicação limpa a conta Discord conectada, estados
OAuth pendentes e Client Secret antigo e revoga sessões do dashboard. Configure o Client Secret
e redirecionamento da nova aplicação, reconecte o dono e instale o novo bot onde necessário.
Histórico de reuniões e registros financeiros são preservados.

## Histórico, custos e tarefas

A lista mantém servidores históricos com reuniões mesmo sem bot ou após trocar a conta conectada.
Consultas de dashboard histórico, detalhe, participantes, exportação e tarefas permanecem disponíveis
a quem tem acesso ao dashboard da instalação. Editar configurações ou concluir/reabrir tarefas
exige propriedade conectada atual e bot instalado. Esse acesso à instalação não é uma conta ou
permissão separada para cada usuário Discord.

O histórico permite filtrar por data, canal, ID, participante, estado e retenção de conteúdo.
Resumo e transcrição aparecem somente quando foram preservados para a reunião. A exportação TXT
usa as preferências de data, hora e fuso enviadas pelo navegador; timestamps permanecem em UTC no banco.

Totais de reuniões contam pipelines concluídos. Rankings de fala começam em gravações de manifesto
v3: intervalos por palavra são somados, sobreposições da mesma pessoa são unidas e o arredondamento
inteiro distribui a participação para totalizar 100%. Pessoas silenciosas permanecem com 0%.
O dashboard também mostra reunião atual, custos confirmados, tentativas não resolvidas e tarefas abertas.

Tarefas são persistidas junto do conteúdo retido e preservam responsável e prazo explicitamente
ditos. Metadados normalizados válidos permitem ordenar por vencimento e calcular atraso sem mudar
o texto literal do fórum. Tarefas podem ser
concluídas ou reabertas; a transcrição preservada e o resumo publicado não são reescritos.


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

Somente o dono do servidor pode consultar custos com `/recording-cost meeting` ou agregá-los pela
data de início das reuniões com `/recording-cost period`. Esses comandos incluem reuniões cuja
gravação encerrou (`completed_at` preenchido); gravações ainda ativas ficam fora do relatório.
O pipeline pode continuar em execução, e tentativas em segundo plano podem aumentar o total.

As respostas são efêmeras e sempre limitadas ao servidor atual do Discord. Os limites de data usam
`SUMMARY_TIME_ZONE`; relatórios de custo preservam os valores financeiros exatos. Os totais da visão
geral do dashboard usam arredondamento de apresentação; os valores armazenados não mudam.


## Retenção e backups

A retenção de conteúdo é ativa e a de áudio desativada por padrão. As políticas ficam fixadas
no início e são independentes:

- com retenção de conteúdo, PostgreSQL guarda transcrições bruta/refinada, resumo, publicação e
  manifesto em `meeting_contents`;
- sem ela, dados operacionais permanecem até o estado terminal e são limpos pelo ciclo de retenção;
  mudar a política do servidor não remove reuniões já preservadas;
- sem retenção de áudio, áudios são excluídos após transcrição completa validada ou falha terminal,
  respeitando a janela de 24 horas de recuperação da transcrição;
- com retenção de áudio, os bytes permanecem no volume durável de `DATA_DIR` e `meeting_audio_segments`
  guarda metadados e caminhos relativos; nenhum BLOB de áudio fica no PostgreSQL;
- após o processamento terminal, transcrições e estados locais são temporários e são limpos mesmo
  quando o conteúdo foi preservado no PostgreSQL;
- custos permanecem indefinidamente em `provider_cost_attempts`, independentemente da retenção
  de conteúdo e áudio.

Conteúdo e áudio preservados não expiram automaticamente. Não há fluxo de exclusão de usuário;
a remoção manual é do operador e deve preservar artefatos não terminais e relacionamentos do banco.
Excluir um post Discord é independente da retenção local.

Faça backup conjunto do PostgreSQL, volume de dados Summyz e `.env`; inclua os volumes de modelos
se precisar preservar os downloads. Os volumes são `postgres_data`, `summyz_community_data`,
`ollama_models` e `faster_whisper_models`. Preserve as chaves junto dos dados que elas protegem.
Nunca publique backups ou credenciais.

## Acesso à instalação e recuperação de senha

O modo local não exige senha e se destina ao acesso por loopback. O público usa uma senha da
instalação com 15–128 caracteres, normalizada em Unicode NFC e armazenada como hash Argon2id.
Cookies são `HttpOnly`, `Secure` e `SameSite=Strict`, com sete dias de inatividade e validade absoluta
de trinta dias. Tentativas de login têm limitação.

Para recuperar acesso no host:

```sh
./summyz-community-public recover-access
```

No Windows, use `.\summyz-community-public.ps1 recover-access`. O launcher local também permite
recuperação quando a instalação em execução está no modo público. A URL de uso único expira em
dez minutos. A senha anterior continua válida até a substituição concluir; depois, as sessões
anteriores são revogadas. Não existe recuperação por e-mail nem sem acesso ao host.
Não compartilhe a URL gerada.
