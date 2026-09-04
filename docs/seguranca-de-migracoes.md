# Segurança de migrações

As migrações de banco do Summyz devem preservar todas as calls que ainda não chegaram a um
estado terminal. Uma atualização pode alterar o esquema e normalizar configurações compatíveis,
mas não pode transformar uma implantação em um mecanismo implícito de retenção.

## Contrato

A partir da migração 10, o inicializador rejeita SQL contendo operações destrutivas. São
bloqueados `DELETE`, `TRUNCATE`, `DROP TABLE`, `DROP COLUMN`, `CASCADE`, `MERGE`, upserts que
sobrescrevem dados e atualizações diretas nas tabelas de reuniões, jobs, custos, conteúdo e áudio.

Limpezas devem ser executadas pelo fluxo explícito de retenção, depois que a reunião atingir
`completed` ou `failed`. Se uma transformação não puder preservar uma call pendente, a implantação
deve falhar de forma segura e exigir intervenção; ela nunca deve apagar a call automaticamente.

## Integridade

O PostgreSQL armazena um checksum SHA-256 junto de cada versão aplicada. As migrações 1 a 9
recebem automaticamente o SQL atual como baseline na primeira inicialização desta proteção.
Migrações posteriores recebem o checksum durante sua aplicação. Qualquer alteração futura em
uma migração já registrada interrompe a inicialização antes que novas migrações sejam executadas.

## Verificação obrigatória

Toda mudança que afete o processamento ou o manifesto deve manter um teste de upgrade que:

- prepare calls em todos os estados não terminais;
- mantenha jobs agendados e jobs ativos com lease expirado recuperáveis;
- preserve manifestos, catálogo de áudio e tentativas de custo;
- confirme que a migração de manifesto não remove arquivos de áudio.
