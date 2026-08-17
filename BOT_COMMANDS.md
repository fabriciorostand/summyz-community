# Comandos do Summyz

## `/record`

Inicia a gravação do canal de voz em que você está.

Pode usar:

- administrador do servidor;
- membro com um dos cargos autorizados para gravação.

O Summyz publica no canal de texto onde o comando foi usado que a gravação começou. Apenas uma
gravação pode ficar ativa por servidor.

## `/stop`

Encerra a gravação ativa do servidor.

Para usar o comando, você precisa:

- ser administrador ou possuir um cargo autorizado;
- estar no mesmo canal de voz que está sendo gravado.

Se todas as pessoas saírem do canal, o Summyz encerra a gravação e sai do canal automaticamente.

Depois de um encerramento por `/stop` ou canal vazio, a transcrição e o resumo começam em segundo
plano. O arquivo completo é salvo localmente como `transcript.txt` e publicado como anexo em uma
thread pública no canal onde `/record` foi executado.
Antes de enviar áudio ao provedor configurado, o servidor do bot descarta localmente trechos sem voz
e consolida falas próximas da mesma pessoa sem misturar participantes.
Se a reunião não puder ser transcrita integralmente, o canal onde `/record` foi executado recebe
somente um aviso genérico.

Quando o resumo é concluído, a thread contém resumo executivo, tópicos discutidos, decisões,
tarefas e pendências ou observações. Responsável e prazo só aparecem quando foram ditos
explicitamente. Se o resumo falhar depois das tentativas configuradas, o Summyz ainda cria uma
thread com a transcrição completa e informa que o resumo está indisponível.

## `/recording-role add role:<cargo>`

Autoriza um cargo a iniciar e encerrar gravações.

Somente administradores e membros com a permissão **Gerenciar servidor** podem usar este comando.

## `/recording-role remove role:<cargo>`

Remove a autorização de gravação de um cargo.

Somente administradores e membros com a permissão **Gerenciar servidor** podem usar este comando.

## `/recording-role list`

Mostra os cargos autorizados a controlar gravações no servidor.

Somente administradores e membros com a permissão **Gerenciar servidor** podem usar este comando.

## Avisos importantes

- Administradores sempre podem controlar gravações.
- Bots não são gravados.
- Pessoas que entrarem no canal depois do início também serão gravadas.
- Se a conexão de voz cair, o Summyz avisa no canal de texto e tenta retomar por até cinco minutos.
- Se o processo reiniciar, o áudio já capturado é preservado e a gravação é retomada quando ainda
  houver pessoas no canal.
- Gravações encerradas por desligamento, reinício ou esgotamento da reconexão não são transcritas
  automaticamente nesta etapa.
