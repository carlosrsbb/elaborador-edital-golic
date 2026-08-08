# Elaborador de Edital — GOLIC/STU-REC

Protótipo de um gerador de editais para a **GOLIC — Gerência Operacional de Licitações e
Compras** da CBTU/STU-REC.

A ideia: o pregoeiro envia o PDF do Termo de Referência, o sistema lê dele o que já está
definido, pergunta só o que falta, e monta o edital.

👉 **[Abrir o formulário](https://carlosrsbb.github.io/elaborador-edital-golic/)**

---

## O que já funciona

**Leitura automática do TR.** O extrator localiza 24 informações no Termo de Referência —
natureza do objeto, registro de preços, critério de julgamento, regime de execução, consórcio,
subcontratação, ME/EPP, garantia, prazos, habilitação técnica — e devolve cada uma com **o item
e a página** de onde saiu.

Testado em seis TRs reais: **72% dos campos** localizados nos quatro que são de pregão.

**Formulário com as regras embutidas.** Não é uma tela passiva: as regras do RILC/CBTU são
comportamento.

- O **orçamento** não é perguntado — decorre do critério de julgamento. Sigiloso é o padrão;
  divulgado só quando for maior desconto, porque o desconto incide sobre um preço de
  referência que precisa ser público.
- As **datas** contam dias úteis e recusam prazo abaixo do mínimo do RILC art. 18 — 8 dias
  úteis para material, 15 para serviço e obra.
- Cada opção **explica o que entra ou sai** do edital. Aceitar consórcio, por exemplo, traz
  10 cláusulas com o regime do consorciado; recusar deixa só a vedação.
- A seção de **registro de preços** só aparece quando o TR indica SRP.
- O que o pregoeiro corrigir fica **marcado como correção**, distinto do que veio do TR.

## O que ainda não funciona

- O botão **Gerar edital** não gera. O formulário e o extrator existem; falta ligá-los.
- Os dados da tela são de um TR de exemplo, fixos no HTML.
- Modos de disputa **fechado** e **fechado e aberto** aparecem desabilitados: não há redação
  aprovada para eles.
- TR digitalizado (imagem, sem texto) precisa de OCR.

---

## Como rodar o extrator

Precisa de Python 3.12 e `pypdf`:

```bash
pip install pypdf
python codigo/extrair_do_tr.py caminho/do/TR.pdf
```

Aceita `.pdf`, `.docx` e `.txt`, ou uma pasta inteira. Para cada campo, informa o valor, o
item, a página e o quanto a leitura é confiável. O que não encontra sai como **PENDENTE** —
nunca preenchido por suposição.

### Por que a extração é por conteúdo, e não por seção

Os TRs da CBTU não têm estrutura padronizada. A garantia é a seção 17 num TR e a 15 em outro;
o critério de julgamento é seção própria num e está dentro da seção de participação no outro.

O que salva é a **fraseologia**, que se repete: *"não é aberta a cooperativas e consórcios"*,
*"é vedada a subcontratação do objeto"*, *"garantia de execução do contrato no prazo de X dias
úteis"*. A extração se ancora nisso.

Duas decisões que evitam falso positivo:

- **Busca ancorada ao contexto.** O percentual da garantia é procurado *dentro* da cláusula de
  garantia. Sem isso, um "10% do valor" de uma cláusula de multa seria capturado no lugar.
- **Busca restrita à abertura.** A natureza do objeto é lida nos primeiros 4.000 caracteres.
  Uma menção solta a "prestação de serviço" numa cláusula de obrigações chegou a classificar um
  TR de lubrificantes como serviço.

---

## Base normativa

A CBTU é sociedade de economia mista: rege-se pela **Lei 13.303/2016 e pelo RILC/CBTU**, não
pela Lei 14.133/2021, que expressamente não alcança as estatais.

A IN SEGES/ME nº 73/2022 é adotada "no que couber" — onde o RILC dispõe, o RILC prevalece.

## Interface

Usa o [Design System do Gov.br](https://www.gov.br/ds/), o mesmo da ferramenta de editais da
AGU. Pacote público, versionado e acessível por padrão.

Se a rede bloquear os CDNs externos, a página continua funcionando: o essencial do estilo está
no próprio arquivo, e só as fontes e os componentes decorativos deixam de carregar.

---

## Estado

Protótipo em desenvolvimento, sem uso em processo real. Não substitui a conferência do
pregoeiro.

Os Termos de Referência, os modelos de edital e os documentos internos da GOLIC **não estão
neste repositório**.
