# Dossiê do projeto — o que quem chegar agora precisa saber

Este arquivo existe para que o trabalho continue em outra sessão, em outra máquina, sem
refazer raciocínio nem repetir caminhos já descartados.

Atualizado em 08/08/2026.

---

## Quem é o usuário

**Carlos** — pregoeiro e gerente da GOLIC (Gerência Operacional de Licitações e Compras) da
CBTU/STU-REC. Especialista em licitações; **não programa**. Explicações em português claro,
sem jargão de software. Ele é a autoridade sobre o conteúdo jurídico; a construção é minha.

## O que o sistema faz

```
PDF/DOCX do TR  →  extrator lê o que já está definido, com item de origem
                          ↓
              formulário mostra o lido e pergunta só o que falta
                          ↓
        gera o edital a partir do modelo oficial do tipo certo
```

Publicado em **https://carlosrsbb.github.io/elaborador-edital-golic/**

## Base normativa — não confundir

A CBTU é **sociedade de economia mista**: rege-se pela **Lei 13.303/2016 e pelo RILC/CBTU**,
não pela Lei 14.133/2021, que expressamente não alcança as estatais.

A IN SEGES/ME nº 73/2022 é adotada "no que couber" — **onde o RILC dispõe, o RILC prevalece**.

Citações à Lei 14.133 que aparecem nos editais **não são erro**: são a remissão do critério de
desempate, que a 13.303 fazia à Lei 8.666, revogada.

---

## Decisões tomadas — não reabrir sem motivo

| Decisão | Quando |
|---|---|
| Tudo roda **no navegador**, sem servidor e sem biblioteca externa — a rede da CBTU pode bloquear CDNs | 08/08 |
| Os **cinco modelos oficiais V2025** são a fonte redacional. Não reescrever o texto da GOLIC | 25/07 |
| O modelo vem da **máquina do pregoeiro**: são documentos internos, o repositório é público | 08/08 |
| CEP da STU-REC: **50900-005** | 25/07 |
| Orçamento **sigiloso é o padrão**; divulgado só com maior desconto | 25/07 |
| Prazo de conclusão do pregoeiro **fica fora do edital**, por decisão estratégica | 25/07 |
| Interface no **Design System do Gov.br**, o mesmo da AGU | 08/08 |

### Um rumo que foi descartado

Construí um "tronco comum" fundindo os cinco modelos num documento único com blocos
condicionais. **Carlos reprovou, com razão:** o resultado não correspondia a nenhum edital
real, os marcadores sujavam o texto, e os cinco modelos que a GOLIC já mantém eram melhores.

O erro de raciocínio: medi 78–91% de reuso entre os editais e concluí que o caminho era
fundir. Reuso alto é argumento de **manutenção**, não de **produção**. O que ele pediu, desde
a primeira mensagem, foi produção.

**Não refazer esse caminho.**

---

## As regras (R1 a R18)

As que mais importam para o código:

| | Regra |
|---|---|
| **R1** | A natureza do objeto escolhe qual dos cinco modelos usar |
| **R11** | Sigilo do orçamento é **derivado**, não perguntado: sigiloso salvo maior desconto |
| **R12** | Modo de disputa: `aberto` e `aberto e fechado` têm redação; `fechado` e `fechado e aberto` não — o gerador recusa |
| **R14** | Prazo mínimo de divulgação: **8 dias úteis** material, **15** serviço e obra (RILC art. 18) |
| **R17** | A cláusula 14.1 depende das cláusulas 20.2 e 20.2.1 — não suprimir uma sem rever a outra |
| **R18** | Todo TR ou PB de engenharia deve destacar as **parcelas de maior relevância técnica**. Faltando, o sistema avisa e o pregoeiro escolhe: devolver, sanear ou prosseguir |

O texto completo está em `config/regras-condicionais.md`, **na máquina do Carlos** — não neste
repositório.

---

## O que os documentos reais ensinaram

Cada um destes custou uma depuração. Estão no código como comentário, mas vale o resumo:

**Os TRs não têm estrutura padronizada.** A garantia é seção 17 num, 15 em outro. A extração é
por **âncora de conteúdo**, nunca por número de seção. O que salva é a fraseologia se repetir.

**Buscar no documento inteiro acha a coisa errada.** O percentual da garantia é procurado
*dentro* da cláusula de garantia — senão um "10% do valor" de uma multa vence. A natureza do
objeto é lida nos primeiros 6.000 caracteres — senão um "prestação de serviço" solto numa
cláusula de obrigações classifica um TR de lubrificantes como serviço.

**Os documentos de engenharia não usam a numeração automática do Word.** O número vem digitado
no texto. Sem tratar isso, o leitor acha zero itens.

**O sumário engana.** Os documentos de engenharia repetem todos os títulos no índice, antes do
corpo. Buscar a **última** ocorrência, não a primeira.

**As parcelas de maior relevância vêm em dois formatos:** tabela (TR de serviço de engenharia)
ou marcadores (Projeto Básico). Nos marcadores, os primeiros itens costumam ser *documentos*
— registro no CREA, atestado — e não parcelas. Filtrar.

**Os modelos de edital não são gabaritos.** São editais completos que trazem todas as
alternativas e uma nota "(USAR ESSE ITEM E EXCLUIR O ITEM 3.2…)". Gerar é **apagar** o que não
se aplica. A numeração do Word se refaz sozinha — o bloco 3.3 vira 3.2 quando o 3.2 sai.

**O edital tem duas listas numeradas** — preâmbulo e corpo — ambas começando em 1. Misturá-las
corrompe tudo silenciosamente: os totais continuam batendo.

---

## O que falta

1. **Ligar o modelo ao tipo de objeto** — hoje o pregoeiro escolhe o arquivo manualmente.
   Guardar no navegador após a primeira escolha resolveria a maior parte do incômodo.
2. **PDF no navegador** — só `.docx` é lido. Precisa do pdf.js guardado no repositório, para
   não depender de CDN.
3. **Minuta da Ata de Registro de Preços** — quando `usa_srp = sim`, gerar também. As decisões
   de IRP e adesão já estão no formulário.
4. **Estado residual** — ao recarregar, o navegador preserva o preenchido. No sistema real
   isso precisa ser tratado, ou um processo novo abre com dados do anterior.
5. **Anexos do edital** — o gerador ainda não monta os anexos condicionais.

## Conferências jurídicas pendentes com Carlos

- Modelos de material usam "Tipo de licitação" (Lei 8.666, revogada) onde os de serviço usam
  "Critério de Julgamento" (Lei 13.303). O erro está na origem, no modelo.
- Modelos de material não trazem o prazo para pedidos de esclarecimentos no preâmbulo.
- Índice do modelo MATERIAL V2025v3 tem dois itens numerados como 16.

## O que NÃO está neste repositório

Por decisão de escopo, o repositório é público e contém só o protótipo e o código. Ficam na
máquina do Carlos, em `Desktop/Elaborador de Edital/`:

- `entradas/` — os TRs e Projetos Básicos reais
- `modelos/_oficiais-v2025/` — os cinco modelos oficiais da GOLIC
- `config/` — as regras completas, decisões de redação, esquema de extração, análise dos
  modelos, e o relatório de defeitos encontrados em editais publicados

Para continuar o trabalho a fundo, esses arquivos precisam ser enviados à conversa.
