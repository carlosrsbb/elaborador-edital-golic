"""Extrai do Termo de Referência as informações que o edital precisa.

Desenho: os TRs da CBTU NÃO têm estrutura padronizada — a garantia é a seção 17
num TR e a 15 em outro. Por isso a extração é por ÂNCORA DE CONTEÚDO, nunca por
número de seção. O que salva é que a fraseologia se repete entre documentos.

Regra do projeto: nada é preenchido por suposição. Cada campo sai com o ITEM e a
PÁGINA de onde veio, mais o trecho que o originou — para o pregoeiro conferir e
corrigir se a captação estiver errada. O que não for encontrado sai PENDENTE.
"""
import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from leitor_tr import TR  # noqa: E402


@dataclass
class Achado:
    campo: str
    valor: object = None
    item: str = ""
    pagina: int = 0
    trecho: str = ""
    confianca: str = "pendente"     # alta | media | pendente
    observacao: str = ""

    def origem(self):
        partes = []
        if self.item:
            partes.append(f"item {self.item}")
        if self.pagina:
            partes.append(f"p. {self.pagina}")
        return " · ".join(partes) or "—"


def achar(tr, campo, regras, observacao="", perto_de=None, abertura=0):
    for padrao, resultado, conf in regras:
        m, trecho, item, pag = tr.procurar(padrao, perto_de=perto_de, abertura=abertura)
        if m:
            valor = resultado(m) if callable(resultado) else resultado
            return Achado(campo, valor, item, pag, trecho, conf, observacao)
    return Achado(campo, None, "", 0, "", "pendente", observacao)


def g(m, i=1):
    return m.group(i).strip()


ANCORA_GARANTIA = r"garantia\s+de\s+execu[çc][ãa]o"
TITULO_HABILITACAO = r"(QUALIFICA[ÇC][ÃA]O|CAPACIDADE)\s+T[ÉE]CNICA"


def habilitacao(tr: TR):
    """Traz a seção de qualificação técnica inteira, item a item.

    O edital replica esses requisitos. Em serviços de engenharia eles se dividem em
    técnico-OPERACIONAL (a empresa: registro no conselho, acervo, atestado com as
    parcelas de maior relevância) e técnico-PROFISSIONAL (o responsável técnico:
    registro, vínculo, ART). O modelo de obra da CBTU trata os dois em 9.19.
    """
    achados = []
    sec = tr.achar_secao(TITULO_HABILITACAO)
    itens = tr.itens_da_secao(sec)
    corpo = " ".join(b.texto for b in itens)

    # dispensa expressa
    dispensa = re.search(r"(?:est[áa]\s+)?dispensad[ao]s?\s+a\s+apresenta[çc][ãa]o\s+de\s+atestados?",
                         corpo, re.I)
    if dispensa:
        alvo = next((b for b in itens if re.search(r"dispensad", b.texto, re.I)), None)
        achados.append(Achado("exige_atestado_capacidade", "não — dispensado no TR",
                              alvo.item if alvo else sec or "", alvo.pagina if alvo else 0,
                              (alvo.texto if alvo else "")[:300], "alta",
                              "o TR dispensa expressamente o atestado — R4"))
    elif re.search(r"atestado", corpo, re.I):
        alvo = next((b for b in itens if re.search(r"atestado", b.texto, re.I)), None)
        achados.append(Achado("exige_atestado_capacidade", "sim",
                              alvo.item if alvo else sec or "", alvo.pagina if alvo else 0,
                              (alvo.texto if alvo else "")[:300], "alta", "R4"))
    else:
        achados.append(Achado("exige_atestado_capacidade", None, "", 0, "", "pendente", "R4"))

    # operacional × profissional
    for rotulo, padrao in (("qualificacao_tecnico_operacional", r"t[ée]cnico[\s-]*operacional"),
                           ("qualificacao_tecnico_profissional", r"t[ée]cnico[\s-]*profissional")):
        alvo = next((b for b in itens if re.search(padrao, b.texto, re.I)), None)
        if alvo:
            achados.append(Achado(rotulo, "exigida", alvo.item, alvo.pagina,
                                  alvo.texto[:300], "alta",
                                  "o edital replica este requisito"))
        else:
            achados.append(Achado(rotulo, None, "", 0, "", "pendente",
                                  "não mencionada no TR — típico fora de engenharia"))

    # os requisitos, um a um, para conferência na tela
    requisitos = [{"item": b.item, "pagina": b.pagina, "texto": b.texto}
                  for b in itens if b.item and "." in b.item and len(b.texto) > 40]
    achados.append(Achado("requisitos_habilitacao", requisitos or None,
                          sec or "", itens[0].pagina if itens else 0,
                          f"{len(requisitos)} requisito(s) na seção {sec}" if sec else "",
                          "alta" if requisitos else "pendente",
                          "transcritos para o edital — conferir um a um"))
    return achados


def extrair(tr: TR):
    r = []

    # A natureza é lida na ABERTURA do TR — onde o objeto é definido. Buscá-la no
    # documento inteiro faz uma menção solta a "prestação de serviço", perdida numa
    # cláusula de obrigações, classificar um TR de lubrificantes como serviço.
    r.append(achar(tr, "natureza_objeto", [
        (r"dedica[çc][ãa]o\s+exclusiva\s+de\s+m[ãa]o\s+de\s+obra", "serviço com dedicação exclusiva", "alta"),
        (r"obra\s+de\s+engenharia", "obra de engenharia", "alta"),
        (r"servi[çc]os?\s+(?:comum\s+)?de\s+engenharia", "serviço comum de engenharia", "alta"),
        (r"CLASSIFICA[ÇC][ÃA]O\s+DO\s+MATERIAL|aquisi[çc][ãa]o\s+de\s+materia", "material", "alta"),
        (r"servi[çc]os?\s+(?:s[ãa]o|ser[ãa]o)\s+de\s+natureza\s+comum", "serviço comum", "alta"),
        (r"\baquisi[çc][ãa]o\s+d[eo]s?\b|\bfornecimento\s+d[eo]s?\b|\bcompra\s+d[eo]s?\b", "material", "alta"),
        (r"contrata[çc][ãa]o\s+de\s+(?:empresa\s+)?(?:especializada\s+)?para\s+presta[çc][ãa]o",
         "serviço comum", "alta"),
        (r"presta[çc][ãa]o\s+de\s+servi[çc]o", "serviço comum", "media"),
    ], "escolhe qual dos cinco modelos será usado — regra R1 · lido na abertura do TR",
        abertura=4000))

    r.append(achar(tr, "objeto_continuado", [
        (r"natureza\s+comum\s+e\s+cont[íi]nua|servi[çc]os?\s+cont[íi]nuos?", "sim", "alta"),
        (r"prorrogado\s+por\s+iguais\s+e\s+sucessivos", "sim", "alta"),
    ], "serviço contínuo admite prorrogação — art. 71 da Lei 13.303"))

    r.append(achar(tr, "modalidade", [
        (r"\bdispensa\s+de\s+licita[çc][ãa]o\b|\bDISPENSA\b", "dispensa de licitação", "alta"),
        (r"\bLEC\b|licita[çc][ãa]o\s+eletr[ôo]nica\s+CBTU", "LEC — Licitação Eletrônica CBTU", "alta"),
        (r"preg[ãa]o\s+eletr[ôo]nico", "Pregão Eletrônico", "alta"),
    ], "dispensa segue rito próprio — não gera edital de pregão"))

    a = achar(tr, "usa_srp", [
        (r"sistema\s+de\s+registro\s+de\s+pre[çc]os|ata\s+de\s+registro\s+de\s+pre[çc]os", "sim", "alta"),
    ], "liga as três seções de SRP e a minuta da Ata — regra R2")
    if a.valor is None:
        a.valor, a.confianca = "não", "media"
        a.observacao += " · nenhuma menção a registro de preços"
    r.append(a)

    r.append(achar(tr, "criterio_julgamento", [
        (r"maior\s+desconto", "maior desconto", "alta"),
        (r"crit[ée]rio\s+menor\s+pre[çc]o|menor\s+pre[çc]o\s+(?:por|global|do\s+item)", "menor preço", "alta"),
        (r"escolhida\s+a\s+proposta\s+com\s+menor\s+valor", "menor preço", "alta"),
        (r"menor\s+pre[çc]o", "menor preço", "media"),
    ], "R11: define se o orçamento pode ser sigiloso"))

    r.append(achar(tr, "julgamento_por", [
        (r"adjudica[çc][ãa]o\s+(?:ser[áa]\s+)?(?:realizada\s+)?por\s+(item|grupo|lote|pre[çc]o\s+global)", g, "alta"),
        (r"julgamento\s+ser[áa]\s+por\s+(item|grupo|lote|pre[çc]o\s+global)", g, "alta"),
        (r"por\s+(item|grupo|lote)\s+[uú]nico", g, "media"),
        (r"menor\s+pre[çc]o\s+por\s+(item|grupo|lote)", g, "media"),
    ]))

    r.append(achar(tr, "regime_execucao", [
        (r"empreitada\s+por\s+pre[çc]o\s+(unit[áa]rio|global)", lambda m: f"empreitada por preço {g(m)}", "alta"),
        (r"contrata[çc][ãa]o\s+(integrada|semi-?integrada)", lambda m: f"contratação {g(m)}", "alta"),
        (r"contrata[çc][ãa]o\s+por\s+tarefa", "contratação por tarefa", "alta"),
        (r"fornecimento\s+(?:parcelad|integral)", "fornecimento", "media"),
        (r"entrega\s+realizada\s+em\s+parcela\s+[úu]nica", "fornecimento", "media"),
    ], "em material o modelo usa 'Forma de fornecimento', não 'Regime de execução'"))

    r.append(achar(tr, "forma_fornecimento", [
        (r"entrega\s+realizada\s+em\s+parcela\s+[úu]nica", "parcelada (por pedido da ata)", "alta"),
        (r"fornecimento\s+parcelad", "parcelada", "alta"),
        (r"entrega\s+[úu]nica|fornecimento\s+integral|parcela\s+[úu]nica", "integral", "media"),
    ]))

    r.append(achar(tr, "admite_consorcio", [
        (r"n[ãa]o\s+[ée]\s+aberta\s+a\s+cooperativas\s+e\s+cons[óo]rcios", "não", "alta"),
        (r"vedada?\s+a\s+participa[çc][ãa]o\s+de\s+.{0,40}cons[óo]rcio", "não", "alta"),
        (r"ser[áa]\s+permitida\s+a\s+participa[çc][ãa]o\s+.{0,40}cons[óo]rcio", "sim", "alta"),
    ]))

    r.append(achar(tr, "admite_subcontratacao", [
        (r"[ée]\s+vedada\s+a\s+subcontrata[çc][ãa]o\s+do\s+objeto,\s+admitindo", "vedada, com ressalva", "alta"),
        (r"[ée]\s+vedada\s+a\s+subcontrata[çc][ãa]o", "vedada", "alta"),
        (r"n[ãa]o\s+poder[áa]\s+subcontratar", "vedada", "alta"),
        (r"admite-se\s+a\s+subcontrata[çc][ãa]o|poder[áa]\s+subcontratar", "permitida", "media"),
    ], "R8"))

    r.append(achar(tr, "participacao_meepp", [
        (r"exclusiva\s+(?:para|a)\s+microempresas", "exclusiva", "alta"),
        (r"cota\s+reservada", "cota reservada", "alta"),
        (r"prerrogativas\s+de\s+prefer[êe]ncia\s+das\s+Microempresas", "ampla concorrência com preferência", "alta"),
        (r"microempresas?\s*\(ME\)|empresas?\s+de\s+pequeno\s+porte", "ampla concorrência com preferência", "media"),
    ], "R5"))

    r.append(achar(tr, "exige_garantia_execucao", [
        (r"n[ãa]o\s+(?:ser[áa]|haver[áa])\s+(?:exigida\s+)?garantia", "não", "alta"),
        (r"garantia\s+de\s+execu[çc][ãa]o\s+d[oe]\s+contrato", "sim", "alta"),
    ], "R6"))

    r.append(achar(tr, "percentual_garantia_execucao", [
        (r"(\d{1,2}(?:,\d+)?)\s*%\s*(?:\([^)]{2,40}\))?\s*(?:por\s+cento)?\s*d[oe]\s+valor",
         lambda m: f"{g(m)}%", "alta"),
    ], "lido dentro da cláusula de garantia, não do TR inteiro", perto_de=ANCORA_GARANTIA))

    r.append(achar(tr, "prazo_apresentacao_garantia", [
        (r"no\s+prazo\s+de\s+(\d+)\s*\(?[^)]*\)?\s*dias\s+[úu]teis", lambda m: f"{g(m)} dias úteis", "alta"),
    ], perto_de=ANCORA_GARANTIA))

    r.append(achar(tr, "prazo_vigencia", [
        (r"prazo\s+de\s+vig[êe]ncia\s+d[oa]\s+(?:contrato|ata)\s+ser[áa]\s+de\s+(\d+)\s*\(([^)]*)\)\s*(meses|dias|anos)",
         lambda m: f"{m.group(1)} {m.group(3)}", "alta"),
        (r"contrato\s+dever[áa]\s+ser\s+executado\s+no\s+per[íi]odo\s+de\s+(\d+)\s*\(?[^)]*\)?\s*(meses|dias|anos)",
         lambda m: f"{m.group(1)} {m.group(2)}", "alta"),
        (r"vig[êe]ncia\s+(?:ser[áa]\s+)?d[eo]\s+(\d+)\s*\(?[^)]*\)?\s*(meses|dias|anos)",
         lambda m: f"{m.group(1)} {m.group(2)}", "media"),
    ]))

    r.append(achar(tr, "prazo_entrega_execucao", [
        (r"prazo\s+de\s+entrega\s+d[oa]s?\s+\w+\s+ser[áa]\s+de\s+(\d+)\s*\(([^)]*)\)\s*(meses|dias)",
         lambda m: f"{m.group(1)} {m.group(3)}", "alta"),
        (r"entrega\s+.{0,40}?prazo\s+(?:m[áa]ximo\s+)?de\s+(\d+)\s*\(?[^)]*\)?\s*(dias|meses)",
         lambda m: f"{m.group(1)} {m.group(2)}", "media"),
        (r"prazo\s+(?:de\s+)?(?:execu[çc][ãa]o|entrega)\s+.{0,30}?(\d+)\s*\(?[^)]*\)?\s*(meses|dias)",
         lambda m: f"{m.group(1)} {m.group(2)}", "media"),
    ]))

    # ---------------------------------------------------------- habilitação
    # O edital REPLICA os requisitos de habilitação do TR. Por isso aqui não basta
    # um sim/não: é preciso trazer o texto dos requisitos, para o pregoeiro conferir
    # item a item antes de gerar.
    r.extend(habilitacao(tr))

    r.append(achar(tr, "exige_visita_tecnica", [
        (r"vistoria\s+(?:pr[ée]via\s+)?(?:ser[áa]\s+)?obrigat[óo]ria|visita\s+t[ée]cnica\s+obrigat[óo]ria",
         "obrigatória", "alta"),
        (r"vistoria|visita\s+t[ée]cnica", "facultativa", "media"),
    ], "R4: se obrigatória, exige justificativa no TR"))

    r.append(achar(tr, "exige_registro_conselho", [
        (r"registro\s+(?:ou\s+inscri[çc][ãa]o\s+)?n[oa]\s+(CREA|CAU|CRA|CRM|CRO|CRC|CRQ)\b", g, "alta"),
    ]))

    r.append(achar(tr, "valor_total_estimado", [
        (r"valor\s+(?:total\s+)?estimad[oa].{0,50}?(R\$\s*[\d.]+,\d{2})", g, "alta"),
        (r"valor\s+global.{0,50}?(R\$\s*[\d.]+,\d{2})", g, "media"),
    ], "só entra no edital quando o orçamento for divulgado — R11"))

    r.append(achar(tr, "prazo_pagamento", [
        (r"pagamento\s+.{0,80}?prazo\s+de\s+at[ée]\s+(\d+)\s*\(?[^)]*\)?\s*dias", lambda m: f"{g(m)} dias", "alta"),
        (r"prazo\s+de\s+at[ée]\s+(\d+)\s*\(?[^)]*\)?\s*dias\s+.{0,50}?pagamento", lambda m: f"{g(m)} dias", "media"),
    ]))

    r.append(achar(tr, "exige_sustentabilidade", [
        (r"crit[ée]rios?\s+(?:e\s+pr[áa]ticas\s+)?de\s+sustentabilidade", "sim", "alta"),
        (r"sustentabilidade", "sim", "media"),
    ]))

    r.append(achar(tr, "garantia_produto", [
        (r"garantia\s+(?:do|dos)\s+(?:produto|material|equipamento)s?.{0,40}?(\d+)\s*\(?[^)]*\)?\s*(meses|anos)",
         lambda m: f"{m.group(1)} {m.group(2)}", "alta"),
        (r"prazo\s+de\s+garantia.{0,40}?(\d+)\s*\(?[^)]*\)?\s*(meses|anos)",
         lambda m: f"{m.group(1)} {m.group(2)}", "media"),
    ], "garantia técnica do bem, distinta da garantia de execução"))

    r.append(achar(tr, "unidade_requisitante", [
        (r"TR\s*N?[ºo°]?\s*[\d\-/]+\s*[/_]\s*([A-Z]{4,6})\b", g, "alta"),
        (r"\b(CO[A-Z]{3}|G[IO][A-Z]{3})\b\s*[–\-/]", g, "media"),
    ], "define o setor requisitante no preâmbulo e o recebedor do objeto"))

    return r


# ---------------------------------------------------------------- execução
MARCA = {"alta": "✅", "media": "🟡", "pendente": "⬜"}


def relatorio(caminho: Path, mostrar_trecho=False):
    tr = TR(caminho)
    achados = extrair(tr)
    nome = caminho.stem[:66]
    print("=" * 100)
    print(f"{nome}")
    print(f"  {len(tr.blocos)} blocos · {len(tr.texto):,} caracteres · {caminho.suffix}")
    print("=" * 100)
    ok = sum(1 for a in achados if a.valor is not None)
    alta = sum(1 for a in achados if a.confianca == "alta")
    print(f"  {ok} de {len(achados)} campos localizados  ({alta} com confiança alta)\n")
    for a in achados:
        if a.valor is None:
            print(f"  ⬜ {a.campo:<30} PENDENTE — o pregoeiro informa")
            continue
        print(f"  {MARCA[a.confianca]} {a.campo:<30} {str(a.valor)[:38]:<40} {a.origem()}")
        if mostrar_trecho and a.confianca != "alta":
            print(f"       ↳ {a.trecho[:140]}")
    print()
    destino = caminho.with_suffix(".extraido.json")
    destino.write_text(json.dumps([asdict(a) for a in achados], ensure_ascii=False, indent=1),
                       encoding="utf-8")
    return ok, len(achados)


if __name__ == "__main__":
    alvo = Path(sys.argv[1])
    detalhe = "-v" in sys.argv
    arquivos = ([p for p in sorted(alvo.iterdir())
                 if p.suffix.lower() in (".docx", ".pdf", ".txt") and not p.name.startswith("~")]
                if alvo.is_dir() else [alvo])
    total_ok = total = 0
    for arq in arquivos:
        try:
            ok, n = relatorio(arq, detalhe)
            total_ok, total = total_ok + ok, total + n
        except Exception as exc:
            print(f"  ⚠ {arq.name}: {exc}\n")
    if total:
        print("=" * 100)
        print(f"  GERAL: {total_ok} de {total} campos ({100*total_ok/total:.0f}%)")
