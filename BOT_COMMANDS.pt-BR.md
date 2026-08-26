# Comandos do Summyz

## `/record`

Inicia a gravação do canal de voz em que você está.

Pode usar:

- administrador do servidor;
- membro com um dos cargos autorizados para gravação.

O Summyz publica no canal de texto onde o comando foi usado que a gravação começou. Apenas uma
gravação pode ficar ativa por servidor. O comando pode ser executado em qualquer chat do servidor,
mas o usuário precisa estar em um canal de voz convencional. Também é necessário configurar antes
um fórum com `/recording-summary-forum set`.

## `/stop`

Encerra a gravação ativa do servidor.

Para usar o comando, você precisa:

- ser administrador ou possuir um cargo autorizado;
- estar no mesmo canal de voz que está sendo gravado.

Quem executa `/stop` recebe uma confirmação efêmera no chat do comando. O encerramento público,
com a menção de quem o solicitou, é publicado no chat onde `/record` iniciou a sessão.

Se todas as pessoas saírem do canal, o Summyz encerra a gravação e sai do canal automaticamente. O
chat original recebe uma mensagem com o nome do canal de voz, informa que os segmentos foram
preservados e que serão processados. Gravações antigas sem o nome salvo usam a descrição genérica
“canal de voz”.

Depois de um encerramento por `/stop` ou canal vazio, a transcrição e o resumo começam em segundo
plano por uma fila durável. O arquivo completo é publicado como anexo em um post no fórum
configurado.
Antes de enviar áudio ao provedor configurado, o servidor do bot descarta localmente trechos sem voz
e consolida falas próximas da mesma pessoa sem misturar participantes.
Quando o hardware fica abaixo da recomendação para a configuração 100% local selecionada, somente
quem executou `/record` recebe um aviso efêmero sugerindo OpenRouter. O terminal também registra o
aviso; o canal público não recebe detalhes de hardware. A gravação continua e o Summyz tenta o
processamento com os menores modelos locais compatíveis, mesmo que ele possa ser lento e produzir
qualidade abaixo do desejado.
Se a reunião não puder ser transcrita integralmente, o canal onde `/record` foi executado recebe
somente um aviso genérico.

Quando o resumo é concluído, o post contém resumo executivo, tópicos discutidos, decisões,
tarefas e pendências ou observações. Responsável e prazo só aparecem quando foram ditos
explicitamente. Se o resumo falhar depois das tentativas configuradas, o Summyz ainda cria uma
post com a transcrição completa e informa que o resumo está indisponível.

## `/recording-role add role:<cargo>`

Autoriza um cargo a iniciar e encerrar gravações.

Somente administradores e membros com a permissão **Gerenciar servidor** podem usar este comando.

## `/recording-role remove role:<cargo>`

Remove a autorização de gravação de um cargo.

Somente administradores e membros com a permissão **Gerenciar servidor** podem usar este comando.

## `/recording-role list`

Mostra os cargos autorizados a controlar gravações no servidor.

Somente administradores e membros com a permissão **Gerenciar servidor** podem usar este comando.

## `/recording-summary-forum set forum:<fórum> tag:<tag opcional>`

Define o fórum que receberá os resumos e as transcrições. A tag precisa existir no fórum; quando o
fórum exige tags, a opção é obrigatória. O comando valida as permissões do bot antes de salvar.

Pode usar:

- administrador do servidor;
- membro com a permissão **Gerenciar servidor**;
- membro com um cargo autorizado para gravação.

## `/recording-summary-forum show`

Mostra o fórum e a tag configurados no servidor. Possui as mesmas regras de acesso do `set`.

## `/recording-summary-forum clear`

Remove o destino. Novas gravações ficam bloqueadas e reuniões ainda não publicadas permanecem
pendentes até que outro fórum seja configurado. Possui as mesmas regras de acesso do `set`.

## `/recording-cost meeting id:<ID da reunião>`

Mostra os custos de uma reunião concluída. Somente administradores do servidor podem usar o
comando, e a resposta é efêmera. Um ID só pode ser consultado no servidor em que a reunião foi
gravada.

Para cada fase, o relatório informa se a execução usou uma API externa ou um serviço local, o
modelo efetivo informado pelo provedor e a quantidade de requisições externas. Fases locais mostram
o modelo, mas não apresentam custo: o custo computacional local não é medido. Valores externos são
os montantes exatos em USD informados pelo OpenRouter e aparecem sem arredondamento.

O relatório inclui tentativas cobradas que falharam, reconciliações pendentes e tentativas cuja
cobrança não pôde ser confirmada automaticamente. Uma reunião em andamento é recusada com uma
mensagem efêmera; aguarde a gravação terminar antes de consultá-la.

## `/recording-cost period from:<AAAA-MM-DD> to:<AAAA-MM-DD>`

Mostra os custos agregados das reuniões concluídas e iniciadas no intervalo inclusivo. Reuniões em
andamento não entram no relatório. As datas são interpretadas com `SUMMARY_TIME_ZONE`. O relatório
inclui quantidade e duração das reuniões, requisições aos provedores, execuções locais, totais por
fase, médias confirmadas, falhas cobradas e reconciliações não concluídas. Somente administradores
do servidor podem usar o comando, e a resposta é efêmera.

## Avisos importantes

- Administradores sempre podem controlar gravações.
- A falta de autorização tem prioridade sobre os demais erros de `/record`; para usuários
  autorizados, a falta de fórum configurado tem prioridade sobre a ausência no canal de voz.
- Bots não são gravados.
- Pessoas que entrarem no canal depois do início também serão gravadas.
- Se a conexão de voz cair, o Summyz avisa no canal de texto e tenta retomar por até cinco minutos.
- Avisos públicos de início, conexão, encerramento, transcrição e publicação permanecem no chat em
  que `/record` foi executado, formando um único histórico da sessão.
- Se o processo reiniciar, o áudio já capturado é preservado e a gravação é retomada quando ainda
  houver pessoas no canal.
- Se o canal estiver vazio após o reinício, o Summyz finaliza e processa a gravação parcial.
- Falhas transitórias são repetidas internamente; não existem comandos públicos de status, retry ou
  exclusão nesta etapa.
- Com `PERSIST_MEETING_AUDIO=false`, os áudios são excluídos após transcrição válida ou falha
  definitiva; com `true`, permanecem no disco até exclusão manual do administrador.
- O modo de armazenamento e as políticas de conteúdo e áudio são fixados quando `/record` inicia;
  alterações posteriores no `.env` valem somente para novas reuniões.
- Provedor, modelo resolvido e idioma de cada fase também são fixados nesse momento. Uma fase local
  nunca usa OpenRouter como fallback.
- Registros financeiros são mantidos indefinidamente, independentemente da retenção de áudio e
  transcrições.
