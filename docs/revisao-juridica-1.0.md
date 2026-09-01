# Revisão técnica de licenças para a versão 1.0

**Data da revisão:** 1º de setembro de 2026
**Escopo:** código-fonte, imagens Docker, dependências Node.js e Python, FFmpeg/PyAV,
CUDA/cuDNN, ROCm, modelos baixados e artefatos de conformidade.
**Estado:** **não aprovado para publicação como versão 1.0** enquanto os bloqueios abaixo
não forem resolvidos.

Este documento é uma revisão técnica de conformidade e não substitui parecer de advogado
habilitado nas jurisdições em que o Summyz será distribuído ou comercializado.

## Conclusão executiva

A estratégia de disponibilizar o Summyz Community com código visível, uso não comercial e
direito comercial reservado ao titular é possível como modelo **source-available** com
licenciamento duplo. Ela não pode ser apresentada como “open source”: a definição da Open
Source Initiative exige livre redistribuição e proíbe restrições a campos de atividade,
inclusive uso empresarial. A Sustainable Use License 1.0, por sua vez, restringe uso e
redistribuição comercial de forma expressa.

O repositório ainda não contém `LICENSE`, CLA nem identificação do licenciante. Esses arquivos
não foram criados nesta revisão porque exigem decisões jurídicas do titular. Também existe um
bloqueio material no serviço de transcrição: as wheels binárias de PyAV incluem FFmpeg e a
configuração oficial usada para produzi-las inclui componentes GPL. Isso ocorre dentro do
processo Python, não apenas por execução de um programa separado, e precisa ser eliminado ou
validado por parecer jurídico antes de combinar a distribuição com uma licença comercialmente
restritiva.

## Bloqueios para a versão 1.0

| Severidade | Constatação | Condição para liberação |
| --- | --- | --- |
| Crítica | Não há licença pública nem titular legal identificado no repositório. | Definir o licenciante e adotar texto final revisado por advogado. |
| Crítica | PyAV é instalado por wheel no `faster-whisper`; essas wheels incluem bibliotecas FFmpeg, e a receita oficial inclui x264/x265. O FFmpeg torna-se GPL quando compilado com partes GPL. | Construir e auditar PyAV contra FFmpeg compatível apenas com LGPL, ou obter parecer que aprove a arquitetura e cumprir integralmente a licença aplicável. |
| Alta | O pacote Debian `ffmpeg` da imagem do bot foi inspecionado localmente e informa `--enable-gpl`, além de codecs GPL. | Manter o binário isolado como subprocesso somente após parecer, publicar avisos e código-fonte correspondente, ou trocar por build LGPL mínimo e reproduzível. |
| Alta | As imagens usam tags mutáveis e não digests por plataforma. | Escolher arquiteturas suportadas, fixar digests e gerar SBOM de cada imagem final. |
| Alta | As dependências Python diretas têm versão fixada, mas as transitivas não possuem lock com hashes. | Adotar lock reproduzível por plataforma, com hashes e licenças resolvidas. |
| Alta | O container CUDA carrega termos próprios da NVIDIA e é antigo; a distribuição de imagem derivada tem obrigações adicionais. | Atualizar para versão suportada, fixar digest, incluir avisos NVIDIA e validar a distribuição derivada com advogado. |
| Alta | A imagem ROCm exata não foi baixada e auditada; ROCm usa licenças por componente, inclusive termos não uniformes. | Gerar SBOM e avisos do digest exato de `ollama` ROCm em cada arquitetura suportada. |
| Alta | Ollama e faster-whisper podem baixar modelos escolhidos pelo usuário, cada um com licença própria. | Implementar verificação/registro de licença, revisão e aceite antes do download; definir uma allowlist para o serviço hospedado. |
| Alta | Não há `THIRD_PARTY_NOTICES`, SBOM publicado nem procedimento de oferta de código-fonte correspondente. | Gerar esses artefatos a partir dos binários finais e anexá-los a cada release. |

## Licença do Summyz Community e contribuições

A [Sustainable Use License 1.0](https://github.com/n8n-io/n8n/blob/master/LICENSE.md)
autoriza uso interno, pessoal ou não comercial e restringe redistribuição e disponibilização
comercial. Isso se aproxima da intenção declarada para o Community, mas a redação deve ser
avaliada em relação a casos como consultoria, uso interno em empresas, revenda de appliance,
serviço gerenciado e fork hospedado.

Como a [Open Source Definition](https://opensource.org/osd) não permite restringir venda ou
uso empresarial, a comunicação pública deve empregar “código-fonte disponível”,
“source-available” ou “fair-code”, e não “open source”.

O histórico Git consultado contém uma única identidade autoral, mas isso não prova, sozinho,
titularidade patrimonial: trabalho feito para empregador, cliente ou com código copiado pode
alterar o titular. Antes da publicação é necessário confirmar a cadeia de titularidade.

Para preservar o direito de oferecer o Hosted sob licença comercial, contribuições externas
devem ser aceitas apenas depois da implantação de um CLA. O
[Harmony Contributor Agreement](https://www.harmonyagreements.org/docs/ha-combined-v1)
oferece uma alternativa que permite relicenciamento, mas ainda exige escolher:

- licença de contribuição ou cessão de copyright;
- CLA individual, corporativo ou ambos;
- lei aplicável, foro, identidade e endereço do projeto;
- mecanismo verificável de assinatura e vínculo do aceite ao commit;
- tratamento de contribuições anteriores ao CLA.

Uma licença de contribuição ampla preserva autoria do colaborador; uma cessão transfere direitos
e costuma impor mais fricção. A escolha não deve ser feita apenas por conveniência técnica.

## Imagens Docker

### Node.js e Python

O projeto usa `node:22-bookworm-slim` e `python:3.12-slim-bookworm`. Os Dockerfiles oficiais de
[Node.js](https://github.com/nodejs/docker-node) e
[Python](https://github.com/docker-library/python) possuem licenças permissivas para seus arquivos
de empacotamento, mas isso não licencia todo o conteúdo Debian incluído nas imagens. A obrigação
de avisos e código-fonte deve ser calculada sobre cada imagem final, não apenas sobre o
Dockerfile de origem.

As tags também são flutuantes. Para uma release reproduzível, devem ser substituídas por digests
específicos de cada plataforma depois que as arquiteturas suportadas forem definidas.

### PostgreSQL

`postgres:18.4-alpine` contém PostgreSQL sob a
[PostgreSQL License](https://www.postgresql.org/about/licence/), mas a imagem inclui componentes
adicionais. A própria documentação da
[imagem oficial](https://github.com/docker-library/docs/blob/master/postgres/README.md) alerta que
o usuário é responsável por verificar as licenças de todo o software presente. A tag deve ser
atualizada ou formalmente mantida, fixada por digest e incluída no SBOM.

### Ollama

O código do [Ollama](https://github.com/ollama/ollama/blob/main/LICENSE) é MIT, porém isso não
abrange os modelos. As tags `ollama/ollama:0.11.4` e `0.11.4-rocm` também não estão fixadas por
digest e precisam de revisão de suporte e segurança antes da 1.0.

### NVIDIA CUDA e cuDNN

O target CUDA usa `nvidia/cuda:12.3.2-cudnn9-runtime-ubuntu22.04`. A
[página oficial da imagem CUDA](https://hub.docker.com/r/nvidia/cuda/) remete aos contratos da
NVIDIA, à política de ciclo de vida das tags e aos arquivos de código-fonte de componentes GPL.
Os termos de CUDA/cuDNN permitem determinados runtimes redistribuíveis e imagens derivadas com
funcionalidade adicional, mas exigem avisos, condições downstream e uso compatível. O runtime
CUDA/cuDNN deve ser usado apenas com hardware NVIDIA conforme os termos aplicáveis.

Há uma questão específica para advogado: os termos NVIDIA da imagem derivada e a presença de
componentes GPL no mesmo serviço de transcrição precisam ser analisados em conjunto. A revisão
técnica não conclui que essa combinação é permitida.

### AMD ROCm

A [documentação de licenciamento ROCm](https://rocm.docs.amd.com/en/docs-6.0.0/about/licensing.html)
lista licenças por componente em vez de uma licença única para toda a pilha. A imagem
`ollama/ollama:0.11.4-rocm` precisa ser auditada pelo seu digest real; não é correto atribuir MIT
a todo o seu conteúdo apenas porque o Ollama é MIT.

## Dependências Node.js

Após mover Tailwind e o plugin Vite para `devDependencies`, o lockfile registra 172 pacotes de
produção: 140 MIT, 11 Apache-2.0, 7 ISC, 5 BlueOak-1.0.0, 5 BSD-3-Clause e quatro em outras
licenças permissivas. A entrada sem licença é o próprio workspace privado `summyz-web`, não um
pacote externo.

O conjunto completo de desenvolvimento também contém MPL-2.0 e CC-BY, sobretudo em ferramentas
de build e dados de compatibilidade. Eles não são copiados para os targets de runtime após a
correção, mas ainda devem aparecer no SBOM de build e nos avisos quando a respectiva licença o
exigir. O `package-lock.json` é suficiente para reproduzir versões Node, mas não substitui a
coleta de textos de licença e copyrights.

`ffmpeg-static` foi removido das dependências Node. Em desenvolvimento, o executável `ffmpeg`
deve existir no `PATH` ou ser indicado por `FFMPEG_PATH`; no Docker, ele é instalado pelo sistema
operacional apenas nos targets que o utilizam.

## Dependências Python e o limite FFmpeg/PyAV

As dependências diretas atualmente fixadas são:

| Pacote | Versão | Licença declarada do projeto |
| --- | ---: | --- |
| CTranslate2 | 4.6.0 | MIT |
| FastAPI | 0.116.1 | MIT |
| faster-whisper | 1.2.0 | MIT |
| NumPy | 2.2.6 | BSD-3-Clause |
| python-multipart | 0.0.20 | Apache-2.0 |
| Requests | 2.32.5 | Apache-2.0 |
| Uvicorn | 0.35.0 | BSD-3-Clause |

Essa tabela não basta para aprovar a imagem: `pip` resolve dependências transitivas no momento
do build. O build realizado nesta revisão resolveu PyAV 18.1.0 por wheel. Um SBOM diagnóstico da
imagem CPU encontrou 207 componentes e diversos identificadores GPL/LGPL; esse inventário
temporário não é um artefato de release e não foi adicionado ao repositório. O projeto
[PyAV](https://github.com/PyAV-Org/PyAV) declara que suas wheels incluem FFmpeg, enquanto o
[FFmpeg](https://ffmpeg.org/legal.html) explica que ativar componentes GPL aplica GPL ao conjunto
do FFmpeg e recomenda compilar sem `--enable-gpl` e `--enable-nonfree` para conformidade LGPL.

O build CUDA, feito na mesma data e com o mesmo `requirements.txt`, resolveu PyAV 17.1.0 e
ONNX Runtime 1.23.2, enquanto o CPU resolveu PyAV 18.1.0 e ONNX Runtime 1.29.0. Essa divergência
confirma que as versões diretas fixadas não tornam as imagens reproduzíveis.

O caminho tecnicamente mais controlável é produzir FFmpeg mínimo, sem componentes GPL/nonfree,
compilar PyAV a partir do fonte contra essas bibliotecas compartilhadas e publicar receitas,
fontes correspondentes, hashes e avisos. Isso é uma recomendação técnica, não uma decisão já
tomada.

## Licenças dos modelos

Os pesos do [Whisper oficial](https://github.com/openai/whisper/blob/main/LICENSE) são publicados
sob MIT, mas o Summyz aceita identificadores que podem apontar para conversões ou fine-tunes no
Hugging Face. Os [model cards](https://huggingface.co/docs/hub/en/model-cards) podem declarar a
licença no metadata, mas a presença e a correção desse campo não são garantidas.

O mesmo vale para modelos do Ollama: alguns usam licenças permissivas e outros termos próprios.
Portanto, “baixado pelo usuário” não elimina obrigação do distribuidor ou operador do Hosted.
Antes da 1.0, o sistema precisa registrar no mínimo:

- provedor, identificador, revisão e digest do modelo;
- texto ou identificador SPDX da licença e URL da fonte;
- data e identidade de quem aceitou os termos;
- decisão de permitir, bloquear ou exigir revisão manual;
- relação entre o modelo e as reuniões processadas para auditoria.

Para o Hosted, recomenda-se uma allowlist pequena, revisada por versão e território. Para o
Community, um aviso genérico não é suficiente: o download deve apresentar a licença ou bloquear
modelos sem metadata até decisão explícita do administrador.

## Avisos de terceiros e SBOM

O repositório ainda não deve receber um `THIRD_PARTY_NOTICES` definitivo porque os binários,
digests e modelos finais não foram escolhidos. Um aviso produzido agora ficaria incompleto ou
obsoleto.

Cada release deve gerar um SBOM CycloneDX ou SPDX para:

- bot e dashboard;
- faster-whisper CPU e CUDA;
- imagens Ollama CPU e ROCm pelo digest efetivamente distribuído;
- PostgreSQL pelo digest efetivamente distribuído;
- cada arquitetura suportada;
- modelos efetivamente baixados, em um inventário separado de pesos.

O [Docker Scout](https://docs.docker.com/reference/cli/docker/scout/sbom/) exporta SBOM de imagens,
inclusive em CycloneDX. Os artefatos devem ser gerados no pipeline a partir das imagens finais,
assinados ou vinculados ao digest e publicados com a release. O `THIRD_PARTY_NOTICES` deve ser
derivado desses SBOMs, preservar copyrights e acompanhar ofertas de código-fonte quando exigidas.

## Decisões pendentes do titular

Nenhuma das escolhas abaixo foi presumida nesta revisão:

1. Qual é o nome legal completo do licenciante: pessoa física ou empresa?
2. Será usada a Sustainable Use License 1.0 sem alterações ou uma licença própria revisada?
3. Quais usos empresariais internos, consultoria e serviços gratuitos devem ser permitidos?
4. O CLA será licença ampla ou cessão de direitos? Haverá versões individual e corporativa?
5. Qual lei, foro, endereço e processo de assinatura regerão licença comercial e CLA?
6. Quais sistemas operacionais e arquiteturas de CPU serão oficialmente suportados na 1.0?
7. O projeto adotará build LGPL próprio de FFmpeg/PyAV ou buscará parecer para a pilha atual?
8. Quais versões e digests de Node, Python, PostgreSQL, Ollama, CUDA/cuDNN e ROCm serão congelados?
9. Quais modelos entram na allowlist inicial do Community e do Hosted, por finalidade e idioma?
10. Por quanto tempo a oferta de código-fonte de componentes copyleft ficará disponível e onde?

## Gate de publicação

A versão 1.0 só deve ser marcada depois de:

- respostas documentadas para todas as decisões acima;
- parecer jurídico sobre licença pública, CLA, GPL/LGPL, NVIDIA e modelos;
- `LICENSE`, CLA e política de contribuição publicados;
- build reproduzível de Python com hashes;
- imagens fixadas por digest e verificadas por arquitetura;
- resolução comprovada do PyAV/FFmpeg e teste automatizado da configuração de build;
- SBOMs e `THIRD_PARTY_NOTICES` gerados a partir das imagens finais;
- varredura de vulnerabilidades e segredos sem achados impeditivos;
- revisão dos textos públicos para substituir “open source” por “source-available”;
- confirmação da cadeia de titularidade de todo o código existente.
