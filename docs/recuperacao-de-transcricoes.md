# Recuperação automática de transcrições

O Summyz mantém por 24 horas os artefatos de uma transcrição que esgotou as seis tentativas quando
o provedor respondeu, mas a resposta não pôde ser interpretada pelo contrato vigente. O prazo começa
na primeira falha terminal e não é renovado por novas tentativas.

Falhas de rede, indisponibilidade do provedor, áudio inválido e erros internos não iniciam essa
retenção. Se uma falha sem resposta ocorrer durante uma recuperação já elegível, o prazo original
continua valendo, sem ser renovado.

## Versão de recuperação

`CURRENT_TRANSCRIPTION_RECOVERY_VERSION`, em
`src/transcription/transcription-recovery-policy.ts`, identifica a versão do código capaz de
recuperar respostas antes incompatíveis. Todo job de transcrição registra a versão em que foi
criado ou reprocessado.

Quando uma correção torna recuperável uma incompatibilidade já registrada, a alteração deve:

1. incluir um teste que reproduza a resposta incompatível;
2. corrigir o adaptador ou o processamento;
3. incrementar `CURRENT_TRANSCRIPTION_RECOVERY_VERSION`;
4. manter a migração de banco expand-only, caso o contrato persistido também mude.

Na inicialização e durante a manutenção periódica, o bot reabre apenas transcrições com versão
anterior, motivo de incompatibilidade registrado, manifesto e artefatos ainda disponíveis e prazo
de retenção ainda válido. Cada versão concede um único ciclo normal de até seis tentativas. Uma
nova falha conserva o prazo original de exclusão.

O incremento da versão não recupera gravações cujo prazo expirou nem aquelas cujos artefatos já
foram apagados.
