# Contribuindo com o Summyz Community

Obrigado por contribuir. Leia este documento, [`AGENTS.md`](../../AGENTS.md), a tradução
informativa da Summyz Community License 1.0 e a tradução do Contrato de Licença de
Contribuidor Individual antes de abrir um pull request.

Texto principal em inglês: [CONTRIBUTING.md](../../CONTRIBUTING.md)

## Fluxo de desenvolvimento

1. Faça um fork do repositório e crie uma branch focada.
2. Siga os requisitos de arquitetura, segurança, privacidade, nomenclatura e TDD
   estrito de [`AGENTS.md`](../../AGENTS.md).
3. Adicione ou atualize testes antes de implementar mudanças de comportamento.
4. Execute `npm run check`.
5. Descreva motivação, comportamento, riscos e validação no pull request.

Não inclua segredos, credenciais, conteúdo pessoal de reuniões, áudio bruto,
transcrições privadas, informações confidenciais ou material que Você não esteja
autorizado a divulgar. Identifique todo código ou ativo de terceiros e sua licença.

## CLA individual obrigatório

Somente Contribuições individuais são aceitas neste momento. Todo contribuidor humano
deve aceitar o [Contrato de Licença de Contribuidor Individual do Summyz
1.0](./legal/CLA-INDIVIDUAL.md). Contribuições corporativas não serão aceitas até que o
Titular do Projeto publique um procedimento privado de recebimento. O contrato em
[`CLA-CORPORATE.md`](./legal/CLA-CORPORATE.md) é atualmente apenas um modelo.

Não envie uma Contribuição se um empregador, cliente, instituição de ensino ou outra
organização puder ser titular dela ou impedir a concessão do CLA Individual.

Antes do primeiro pull request, crie o registro público de aceitação com:

```bash
npm run cla:sign -- --name "Seu Nome Civil Completo" --login "seu-usuario-github"
```

Revise e inclua o arquivo gerado no pull request. Em cada pull request, informe o mesmo
nome civil e marque a declaração de aceitação inserida por
[`pull_request_template.md`](../../.github/pull_request_template.md). O nome civil e os metadados mínimos de aceitação
serão públicos. Nenhum endereço, documento de identificação governamental ou e-mail é
solicitado.

A declaração exata de aceitação é:

> I have read and agree to the Summyz Individual Contributor License Agreement 1.0. I
> am contributing as an individual and have the right to license my Contribution.

O workflow de CLA do repositório opera somente com leitura e valida o autor do pull
request, os autores dos commits, o registro de aceitação e as declarações exatas. Ele
rejeita commits em coautoria ou sem vínculo a uma conta e impede que um pull request
altere o registro de outro contribuidor. O registro contém somente os campos
relacionados no CLA Individual. O titular do repositório e bots de dependências
expressamente reconhecidos não precisam assinar um contrato consigo mesmos.

O CLA abrange todas as Contribuições que Você enviar intencionalmente depois de
aceitá-lo. A verificação é executada novamente quando o corpo ou os commits mudam, e o
histórico do pull request e do merge no GitHub vincula o registro público aos commits
analisados.

## Revisão e licenciamento

O envio de uma Contribuição não garante sua aceitação. Contribuições aceitas podem ser
modificadas, rejeitadas ou removidas. Você mantém a titularidade de sua Contribuição
original e concede os direitos previstos no CLA Individual, incluindo o direito do
Titular do Projeto de usá-la em versões públicas, comerciais, proprietárias e
hospedadas do Summyz.

Summyz Community é source-available, não open source aprovado pela OSI. Não descreva a
licença ou o projeto como open source.

Para bugs e solicitações de funcionalidades que não incluam uma Contribuição, abra uma
issue.
