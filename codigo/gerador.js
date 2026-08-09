/* Gera o edital a partir do modelo oficial, dentro do navegador.
 *
 * Os modelos V2025 não são gabaritos com marcações: são editais completos que
 * trazem TODAS as alternativas, e uma nota dizendo qual usar. O item 3.2 é o caso
 * fechado (consórcio, subcontratação e cooperativa vedados); 3.3, 3.4 e 3.5 são as
 * aberturas, cada uma com "(USAR ESSE ITEM E EXCLUIR OU MODIFICAR O ITEM 3.2...)".
 *
 * Gerar, portanto, é APAGAR o que não se aplica e substituir os valores. A
 * numeração é automática no Word: ela se refaz sozinha depois das exclusões, e as
 * remissões internas continuam válidas.
 *
 * Sem bibliotecas: o .docx é um ZIP, e o navegador comprime e descomprime sozinho.
 */

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// ═══════════════════════════════════════════════════════ ZIP: ler e escrever

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Lê todas as entradas do ZIP, mantendo os bytes comprimidos de quem não muda. */
async function abrirZip(arrayBuffer) {
  const dados = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  let eocd = -1;
  for (let i = dados.length - 22; i >= Math.max(0, dados.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('o modelo não parece um .docx válido');

  const qtd = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true);
  const entradas = [];
  for (let n = 0; n < qtd; n++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) break;
    const metodo   = dv.getUint16(pos + 10, true);
    const crc      = dv.getUint32(pos + 16, true);
    const tamComp  = dv.getUint32(pos + 20, true);
    const tamCru   = dv.getUint32(pos + 24, true);
    const nomeLen  = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const comLen   = dv.getUint16(pos + 32, true);
    const offset   = dv.getUint32(pos + 42, true);
    const nome = new TextDecoder().decode(dados.subarray(pos + 46, pos + 46 + nomeLen));

    const nLocal = dv.getUint16(offset + 26, true);
    const eLocal = dv.getUint16(offset + 28, true);
    const ini = offset + 30 + nLocal + eLocal;
    entradas.push({ nome, metodo, crc, tamCru, comprimido: dados.slice(ini, ini + tamComp) });
    pos += 46 + nomeLen + extraLen + comLen;
  }
  return entradas;
}

async function descomprimir(entrada) {
  if (entrada.metodo === 0) return new TextDecoder().decode(entrada.comprimido);
  const fluxo = new Blob([entrada.comprimido]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(fluxo).arrayBuffer());
}

async function comprimir(texto) {
  const cru = new TextEncoder().encode(texto);
  const fluxo = new Blob([cru]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const comp = new Uint8Array(await new Response(fluxo).arrayBuffer());
  return { comprimido: comp, tamCru: cru.length, crc: crc32(cru), metodo: 8 };
}

/** Monta o ZIP final. As entradas intocadas seguem com os bytes originais. */
function escreverZip(entradas) {
  const pedacos = [];
  const central = [];
  let deslocamento = 0;
  const enc = new TextEncoder();

  for (const e of entradas) {
    const nome = enc.encode(e.nome);
    const local = new Uint8Array(30 + nome.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);          // versão
    dv.setUint16(6, 0x0800, true);      // nomes em UTF-8
    dv.setUint16(8, e.metodo, true);
    dv.setUint32(14, e.crc, true);
    dv.setUint32(18, e.comprimido.length, true);
    dv.setUint32(22, e.tamCru, true);
    dv.setUint16(26, nome.length, true);
    local.set(nome, 30);
    pedacos.push(local, e.comprimido);

    const cd = new Uint8Array(46 + nome.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, e.metodo, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.comprimido.length, true);
    cv.setUint32(24, e.tamCru, true);
    cv.setUint16(28, nome.length, true);
    cv.setUint32(42, deslocamento, true);
    cd.set(nome, 46);
    central.push(cd);

    deslocamento += local.length + e.comprimido.length;
  }

  const inicioCentral = deslocamento;
  let tamCentral = 0;
  for (const c of central) { pedacos.push(c); tamCentral += c.length; }

  const fim = new Uint8Array(22);
  const fv = new DataView(fim.buffer);
  fv.setUint32(0, 0x06054b50, true);
  fv.setUint16(8, central.length, true);
  fv.setUint16(10, central.length, true);
  fv.setUint32(12, tamCentral, true);
  fv.setUint32(16, inicioCentral, true);
  pedacos.push(fim);

  return new Blob(pedacos, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ═══════════════════════════════════════════════ numeração dos parágrafos

const ROMANOS = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];
const fmtNivel = (v, f) => f === 'lowerLetter' ? String.fromCharCode(96 + (v - 1) % 26 + 1)
  : f === 'upperLetter' ? String.fromCharCode(64 + (v - 1) % 26 + 1)
  : f === 'lowerRoman' ? (ROMANOS[v] || String(v))
  : f === 'upperRoman' ? (ROMANOS[v] || String(v)).toUpperCase()
  : String(v);

const el  = (p, t) => p ? p.getElementsByTagNameNS(W, t)[0] || null : null;
const att = (e, n) => e ? e.getAttributeNS(W, n) : null;

/** Marca cada w:p com o número que o Word exibiria. */
function mapearItens(doc) {
  const niveis = new Map(), paraAbstract = new Map();
  const numbering = doc.__numbering;
  if (numbering) {
    for (const a of numbering.getElementsByTagNameNS(W, 'abstractNum')) {
      const aid = att(a, 'abstractNumId');
      for (const lvl of a.getElementsByTagNameNS(W, 'lvl')) {
        niveis.set(`${aid}|${att(lvl, 'ilvl')}`, {
          formato: att(el(lvl, 'numFmt'), 'val') || 'decimal',
          padrao: att(el(lvl, 'lvlText'), 'val') || '%1',
          inicio: parseInt(att(el(lvl, 'start'), 'val') || '1', 10) });
      }
    }
    for (const n of numbering.getElementsByTagNameNS(W, 'num')) {
      const a = el(n, 'abstractNumId');
      if (a) paraAbstract.set(att(n, 'numId'), att(a, 'val'));
    }
  }

  const contadores = new Map();
  const mapa = new Map();
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    const numPr = el(el(p, 'pPr'), 'numPr');
    if (!numPr) { mapa.set(p, ''); continue; }
    const numId = att(el(numPr, 'numId'), 'val');
    const ilvl = parseInt(att(el(numPr, 'ilvl'), 'val') || '0', 10);
    const aid = paraAbstract.get(numId);
    if (!numId || numId === '0' || aid === undefined) { mapa.set(p, ''); continue; }

    const cfg = k => niveis.get(`${aid}|${k}`) || { formato: 'decimal', padrao: '%1', inicio: 1 };
    const chave = `${numId}|${ilvl}`;
    contadores.set(chave, (contadores.get(chave) ?? cfg(ilvl).inicio - 1) + 1);
    for (const k of [...contadores.keys()]) {
      const [n, lv] = k.split('|');
      if (n === numId && parseInt(lv, 10) > ilvl) contadores.delete(k);
    }
    let saida = cfg(ilvl).padrao;
    for (let n = 0; n <= ilvl; n++) {
      const c = cfg(n);
      saida = saida.replace(`%${n + 1}`, fmtNivel(contadores.get(`${numId}|${n}`) ?? c.inicio, c.formato));
    }
    mapa.set(p, saida.trim().replace(/\.$/, ''));
  }
  return mapa;
}

const textoDe = p => [...p.getElementsByTagNameNS(W, 't')].map(t => t.textContent).join('');

/** Troca o texto do parágrafo preservando a formatação do primeiro run. */
function reescrever(p, novo) {
  const ts = [...p.getElementsByTagNameNS(W, 't')];
  if (!ts.length) return false;
  ts[0].textContent = novo;
  ts[0].setAttribute('xml:space', 'preserve');
  for (let i = 1; i < ts.length; i++) ts[i].textContent = '';
  return true;
}

// ═══════════════════════════════════════════════════════════ as decisões

/** Blocos a excluir, conforme o que o pregoeiro definiu. */
function blocosParaExcluir(dados, mapa) {
  const itens = [...new Set([...mapa.values()].filter(Boolean))];
  const achaPorTexto = (rx, doc) => {
    for (const [p, item] of mapa) if (item && rx.test(textoDe(p))) return item;
    return null;
  };

  const excluir = new Set();
  const marcar = item => { if (item) excluir.add(item); };

  // 3.2 é o item "tudo vedado"; 3.3/3.4/3.5 são as aberturas, cada uma com a
  // nota "(USAR ESSE ITEM E EXCLUIR OU MODIFICAR O ITEM 3.2...)".
  const fechado = [...mapa].find(([p]) =>
    /n[ãa]o\s+ser[áa]\s+permitida\s+a\s+participa[çc][ãa]o\s+de\s+cooperativas\s+e\s+pessoas/i.test(textoDe(p)));
  const abreConsorcio = [...mapa].find(([p]) =>
    /ser[áa]\s+permitida\s+a\s+participa[çc][ãa]o\s+de\s+pessoas\s+jur[íi]dicas\s+organizadas\s+em\s+cons[óo]rcio/i.test(textoDe(p)));
  const abreSubc = [...mapa].find(([p]) =>
    /ser[áa]\s+permitida\s+a\s+subcontrata[çc][ãa]o\s+parcial/i.test(textoDe(p)));
  const abreCoop = [...mapa].find(([p]) =>
    /ser[áa]\s+permitir?a\s+a\s+participa[çc][ãa]o\s+de\s+cooperativas/i.test(textoDe(p)));

  const consorcio = dados.admite_consorcio === 'sim';
  const subc = /permitida/i.test(dados.admite_subcontratacao || '');
  const coop = dados.admite_cooperativa === 'sim';

  if (!consorcio && abreConsorcio) marcar(abreConsorcio[1]);
  if (!subc && abreSubc) marcar(abreSubc[1]);
  if (!coop && abreCoop) marcar(abreCoop[1]);
  // se alguma abertura foi usada, o item "tudo vedado" sai
  if ((consorcio || subc || coop) && fechado) marcar(fechado[1]);

  return excluir;
}

/** Remove os parágrafos do item e de seus subitens. */
function excluirBlocos(doc, mapa, itens) {
  let removidos = 0;
  for (const [p, item] of mapa) {
    if (!item) continue;
    for (const alvo of itens) {
      if (item === alvo || item.startsWith(alvo + '.')) {
        p.parentNode.removeChild(p);
        removidos++;
        break;
      }
    }
  }
  return removidos;
}

/** Preenche o preâmbulo, que é uma lista de "rótulo: valor". */
function preencherPreambulo(doc, mapa, dados) {
  const CAMPOS = [
    [/^(N[úu]mero de ordem em s[ée]rie anual:\s*).*/i, dados.numero_licitacao &&
      (m => m + `PE ${dados.numero_licitacao} – CBTU/STU-REC;`)],
    [/^(Processo:\s*).*/i, dados.numero_processo && (m => m + `${dados.numero_processo};`)],
    [/^(Setor respons[áa]vel pela solicita[çc][ãa]o:\s*).*/i, dados.unidade_requisitante &&
      (m => m + `${dados.unidade_requisitante};`)],
    [/^(Modalidade:\s*).*/i, dados.modalidade && (m => m + `${dados.modalidade};`)],
    [/^(Crit[ée]rio de Julgamento:\s*).*/i, dados.criterio_julgamento &&
      (m => m + `${dados.criterio_julgamento};`)],
    [/^(Tipo de licita[çc][ãa]o:\s*).*/i, dados.criterio_julgamento &&
      (m => m + `${dados.criterio_julgamento};`)],
    [/^(Adjudica[çc][ãa]o:\s*).*/i, dados.julgamento_por && (m => m + `${dados.julgamento_por};`)],
    [/^(Regime de execu[çc][ãa]o:\s*).*/i, dados.regime_execucao &&
      (m => m + `${dados.regime_execucao}.`)],
    [/^(Forma de fornecimento:\s*).*/i, dados.forma_fornecimento &&
      (m => m + `${dados.forma_fornecimento};`)],
    [/^(Modo de disputa:\s*).*/i, dados.modo_disputa && (m => m + `${dados.modo_disputa};`)],
    [/^(In[íi]cio de acolhimento de proposta:\s*).*/i, dados.data_inicio_acolhimento &&
      (m => m + `${dados.data_inicio_acolhimento};`)],
    [/^(T[ée]rmino de acolhimento de proposta e in[íi]cio da sess[ãa]o:\s*).*/i,
      dados.data_sessao && (m => m + `${dados.data_sessao}, às ${dados.hora_sessao || '09h00'};`)],
  ];

  let trocados = 0;
  for (const [p] of mapa) {
    const t = textoDe(p).trim();
    for (const [rx, monta] of CAMPOS) {
      if (!monta) continue;
      const m = rx.exec(t);
      if (m) { reescrever(p, monta(m[1])); trocados++; break; }
    }
  }
  return trocados;
}

/** Substituições no corpo: objeto, remissões ao TR e a nota de instrução. */
function substituirNoCorpo(doc, mapa, dados) {
  const NOTA = /\s*\((?:USAR|OBSERVAR)[^)]*\)\s*/gi;
  let trocados = 0;
  for (const [p] of mapa) {
    const antes = textoDe(p);
    if (!antes) continue;
    let depois = antes.replace(NOTA, ' ');
    if (dados.item_tr_consorcio) depois = depois.replace(/item\s+(?:item\s+)?x{2,}/gi,
      `item ${dados.item_tr_consorcio}`);
    if (dados.objeto_resumido) {
      depois = depois.replace(/\bXXXX?X?\b/g, dados.objeto_resumido);
    }
    if (depois !== antes) { reescrever(p, depois.replace(/\s{2,}/g, ' ').trim()); trocados++; }
  }
  return trocados;
}

// ═══════════════════════════════════════════════════════════ interface

/* Cabeçalhos e rodapés são arquivos próprios dentro do .docx. O bloco
   identificador do certame vive num deles e também precisa ser preenchido. */
async function preencherCabecalhoRodape(entradas, dados) {
  let trocados = 0;
  for (const e of entradas) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(e.nome)) continue;
    const doc = new DOMParser().parseFromString(await descomprimir(e), 'application/xml');
    let mudou = false;
    for (const p of doc.getElementsByTagNameNS(W, 'p')) {
      // funde só os trechos contíguos que não pertencem a campos automáticos,
      // para não destruir o "Página X de Y"
      const runs = [...p.getElementsByTagNameNS(W, 'r')];
      let grupo = [];
      const aplica = () => {
        if (!grupo.length) return;
        const inteiro = grupo.map(r => [...r.getElementsByTagNameNS(W, 't')]
          .map(t => t.textContent).join('')).join('');
        let novo = inteiro;
        if (dados.numero_licitacao) {
          novo = novo.replace(/N[ºo°]\s*X{2,}\s*\/\s*\d{4}/gi, `Nº ${dados.numero_licitacao}`)
                     .replace(/N[ºo°]\s*\d{3,6}\s*\/\s*\d{4}/gi, `Nº ${dados.numero_licitacao}`);
        }
        novo = novo.replace(/50\.?900\s*-?\s*0{2}[05]/g, '50900-005');
        if (novo !== inteiro) {
          const ts = grupo.flatMap(r => [...r.getElementsByTagNameNS(W, 't')]);
          if (ts.length) {
            ts[0].textContent = novo;
            ts[0].setAttribute('xml:space', 'preserve');
            for (let i = 1; i < ts.length; i++) ts[i].textContent = '';
            mudou = true; trocados++;
          }
        }
        grupo = [];
      };
      for (const r of runs) {
        const campo = r.getElementsByTagNameNS(W, 'fldChar').length ||
                      r.getElementsByTagNameNS(W, 'instrText').length;
        if (campo) aplica(); else grupo.push(r);
      }
      aplica();
    }
    if (mudou) Object.assign(e, await comprimir(new XMLSerializer().serializeToString(doc)));
  }
  return trocados;
}


export async function gerarEdital(modeloArrayBuffer, dados) {
  const entradas = await abrirZip(modeloArrayBuffer);
  const alvo = entradas.find(e => e.nome === 'word/document.xml');
  if (!alvo) throw new Error('o modelo não tem word/document.xml');

  const doc = new DOMParser().parseFromString(await descomprimir(alvo), 'application/xml');
  const numEntrada = entradas.find(e => e.nome === 'word/numbering.xml');
  doc.__numbering = numEntrada
    ? new DOMParser().parseFromString(await descomprimir(numEntrada), 'application/xml')
    : null;

  const mapa = mapearItens(doc);
  const excluir = blocosParaExcluir(dados, mapa);
  const removidos = excluirBlocos(doc, mapa, [...excluir]);
  const noPreambulo = preencherPreambulo(doc, mapa, dados);
  const noCorpo = substituirNoCorpo(doc, mapa, dados);

  const xml = new XMLSerializer().serializeToString(doc);
  Object.assign(alvo, await comprimir(xml));
  const noRodape = await preencherCabecalhoRodape(entradas, dados);

  return {
    arquivo: escreverZip(entradas),
    relatorio: {
      blocos_excluidos: [...excluir],
      paragrafos_removidos: removidos,
      preambulo_preenchido: noPreambulo,
      substituicoes_no_corpo: noCorpo,
      cabecalho_rodape: noRodape,
    },
  };
}

export { abrirZip, escreverZip, mapearItens, crc32 };
