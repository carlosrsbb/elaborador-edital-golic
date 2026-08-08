"""Leitor unificado de Termo de Referência: .docx e .pdf na mesma interface.

Devolve o TR como uma sequência de blocos, cada um sabendo de que ITEM veio
(1.1, 15.2.1...) e de que PÁGINA, quando o formato informa.

- `.docx`: a numeração é automática — o arquivo guarda "nível 2 da lista 4" e o
  Word calcula "15.2.1" ao exibir. Aqui a contagem é refeita do zero, então o
  item sai exato.
- `.pdf`: não há numeração estruturada; o item é lido do início da linha, e a
  página vem das marcas de paginação.
"""
import bisect
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ROMANO = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
          "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx"]


def _fmt(valor, fmt):
    if fmt == "lowerLetter":
        return chr(ord("a") + (valor - 1) % 26)
    if fmt == "upperLetter":
        return chr(ord("A") + (valor - 1) % 26)
    if fmt == "lowerRoman":
        return ROMANO[valor] if valor < len(ROMANO) else str(valor)
    if fmt == "upperRoman":
        return (ROMANO[valor] if valor < len(ROMANO) else str(valor)).upper()
    if fmt == "bullet":
        return "•"
    return str(valor)


@dataclass
class Bloco:
    item: str        # "15.2.1" — vazio quando o parágrafo não é numerado
    pagina: int      # 0 quando o formato não informa (caso do .docx)
    texto: str


# ------------------------------------------------------------------ .docx
def _ler_docx(caminho: Path):
    z = zipfile.ZipFile(caminho)
    doc = ET.fromstring(z.read("word/document.xml"))
    niveis, para_abstract = {}, {}
    try:
        num = ET.fromstring(z.read("word/numbering.xml"))
        for a in num.iter(f"{W}abstractNum"):
            aid = a.get(f"{W}abstractNumId")
            for lvl in a.findall(f"{W}lvl"):
                f = lvl.find(f"{W}numFmt")
                t = lvl.find(f"{W}lvlText")
                s = lvl.find(f"{W}start")
                niveis[(aid, lvl.get(f"{W}ilvl"))] = (
                    f.get(f"{W}val") if f is not None else "decimal",
                    t.get(f"{W}val") if t is not None else "%1",
                    int(s.get(f"{W}val")) if s is not None else 1)
        for n in num.iter(f"{W}num"):
            a = n.find(f"{W}abstractNumId")
            if a is not None:
                para_abstract[n.get(f"{W}numId")] = a.get(f"{W}val")
    except KeyError:
        pass

    contadores = {}

    def numero(numid, ilvl):
        aid = para_abstract.get(numid)
        if aid is None:
            return ""
        il = int(ilvl)
        inicio = niveis.get((aid, str(il)), ("decimal", "%1", 1))[2]
        contadores[(numid, il)] = contadores.get((numid, il), inicio - 1) + 1
        for fundo in [k for k in contadores if k[0] == numid and k[1] > il]:
            del contadores[fundo]
        padrao = niveis.get((aid, str(il)), ("decimal", "%1", 1))[1]
        saida = padrao
        for n in range(il + 1):
            fmt, _, ini = niveis.get((aid, str(n)), ("decimal", "%1", 1))
            saida = saida.replace(f"%{n+1}", _fmt(contadores.get((numid, n), ini), fmt))
        return saida.strip().rstrip(".")

    for p in doc.iter(f"{W}p"):
        texto = re.sub(r"\s+", " ", "".join(t.text or "" for t in p.iter(f"{W}t"))).strip()
        npr = p.find(f"{W}pPr/{W}numPr")
        item = ""
        if npr is not None:
            nid = npr.find(f"{W}numId")
            ilv = npr.find(f"{W}ilvl")
            if nid is not None and nid.get(f"{W}val") != "0":
                item = numero(nid.get(f"{W}val"), ilv.get(f"{W}val") if ilv is not None else "0")
        if texto:
            yield Bloco(item, 0, texto)

    # tabelas: o texto das células escapa do iter(w:p)? não — w:p existe dentro de w:tc,
    # então já foi coberto acima. Mantido este comentário para quem for revisar.


# -------------------------------------------------------------------- .pdf
ITEM_LINHA = re.compile(r"^\s*(\d{1,2}(?:\.\d{1,3}){0,3})\.?\s+(.*)$")


def _ler_pdf(caminho: Path):
    from pypdf import PdfReader
    for n, pagina in enumerate(PdfReader(str(caminho)).pages, 1):
        atual, buf = "", []
        for linha in (pagina.extract_text() or "").splitlines():
            m = ITEM_LINHA.match(linha)
            if m and len(m.group(1)) <= 12:
                if buf:
                    yield Bloco(atual, n, re.sub(r"\s+", " ", " ".join(buf)).strip())
                atual, buf = m.group(1), [m.group(2)]
            else:
                buf.append(linha)
        if buf:
            yield Bloco(atual, n, re.sub(r"\s+", " ", " ".join(buf)).strip())


# ------------------------------------------------------------------- TR
class TR:
    """O TR como texto contínuo, com índice de posição → (item, página)."""

    def __init__(self, caminho):
        self.caminho = Path(caminho)
        ext = self.caminho.suffix.lower()
        if ext == ".docx":
            blocos = list(_ler_docx(self.caminho))
        elif ext == ".pdf":
            blocos = list(_ler_pdf(self.caminho))
        elif ext == ".txt":
            blocos = list(self._ler_txt(self.caminho))
        else:
            raise ValueError(f"formato não suportado: {ext}")

        self.blocos = [b for b in blocos if b.texto]
        partes, self._inicios, self._ref = [], [], []
        pos = 0
        for b in self.blocos:
            self._inicios.append(pos)
            self._ref.append((b.item, b.pagina))
            partes.append(b.texto)
            pos += len(b.texto) + 1
        self.texto = "\n".join(partes)

    @staticmethod
    def _ler_txt(caminho):
        pag = 0
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            m = re.match(r"=====\s*\[p\.(\d+)\]\s*=====", linha)
            if m:
                pag = int(m.group(1))
                continue
            mi = ITEM_LINHA.match(linha)
            if linha.strip():
                yield Bloco(mi.group(1) if mi else "", pag,
                            re.sub(r"\s+", " ", linha).strip())

    def achar_secao(self, titulo_regex):
        """Nº da seção cujo título casa com o padrão. Ex.: 'QUALIFICAÇÃO TÉCNICA' -> '15'."""
        for b in self.blocos:
            if not b.item or "." in b.item:
                continue
            # o título pode vir sozinho no bloco ou colado ao texto (caso dos PDFs)
            if re.match(titulo_regex, b.texto.strip(), re.I):
                return b.item
        return None

    def itens_da_secao(self, numero):
        """Todos os blocos da seção, incluindo os subitens, na ordem do documento.

        ⚠ Vale para TR, que tem uma única lista numerada. NÃO usar em edital: lá
        convivem duas listas (preâmbulo e corpo), ambas começando em 1, e este
        método misturaria as duas. Para edital, contar por conteúdo.
        """
        if not numero:
            return []
        return [b for b in self.blocos
                if b.item == numero or b.item.startswith(numero + ".")]

    def onde(self, posicao):
        """(item, página) do trecho que contém essa posição.

        Nem todo parágrafo é numerado — uma alínea, uma linha de tabela, um texto
        corrido. Quando o trecho cai num desses, o item volta ao último parágrafo
        numerado anterior, que é a cláusula à qual ele pertence.
        """
        if not self._ref:
            return "", 0
        i = max(0, bisect.bisect_right(self._inicios, posicao) - 1)
        item, pagina = self._ref[i]
        if not item:
            for j in range(i - 1, -1, -1):
                if self._ref[j][0]:
                    item = self._ref[j][0]
                    if not pagina:
                        pagina = self._ref[j][1]
                    break
        return item, pagina

    def procurar(self, padrao, perto_de=None, janela=900, abertura=0):
        """Primeira ocorrência. Devolve (match, trecho, item, pagina) ou (None,...).

        Duas formas de restringir o alcance, porque buscar no documento inteiro
        produz falso positivo:

        - `perto_de`: só na janela que segue uma âncora. Sem isso, "X% do valor"
          casaria tanto com a garantia quanto com a multa.
        - `abertura`: só nos primeiros N caracteres. É onde o objeto é definido;
          mais adiante, uma menção solta a "prestação de serviço" numa cláusula de
          obrigações classificaria um TR de lubrificantes como serviço.
        """
        base, deslocamento = self.texto, 0
        if abertura:
            base = self.texto[:abertura]
        elif perto_de:
            a = re.search(perto_de, self.texto, re.I)
            if not a:
                return None, "", "", 0
            deslocamento = a.start()
            base = self.texto[a.start():a.start() + janela]
        m = re.search(padrao, base, re.I)
        if not m:
            return None, "", "", 0
        absoluto = deslocamento + m.start()
        item, pagina = self.onde(absoluto)
        ini, fim = max(0, m.start() - 90), min(len(base), m.end() + 150)
        return m, re.sub(r"\s+", " ", base[ini:fim]).strip(), item, pagina


def sem_acento(t):
    t = unicodedata.normalize("NFKD", t)
    return "".join(c for c in t if not unicodedata.combining(c))
