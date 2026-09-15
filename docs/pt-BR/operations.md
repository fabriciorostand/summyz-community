# Operação

[English](../operations.md) · [Início da documentação](./README.md)

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
