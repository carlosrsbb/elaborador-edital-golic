/* Extrator de Termo de Referência — versão do navegador.
 *
 * Porte do extrator em Python (codigo/extrair_do_tr.py) para JavaScript, para
 * rodar dentro da página sem servidor.
 *
 * Sem bibliotecas externas: um .docx é um ZIP, e o navegador já descompacta
 * sozinho pelo DecompressionStream. Assim a leitura funciona mesmo com os CDNs
 * bloqueados pela rede.
 *
 * Regra que atravessa tudo: nada é preenchido por suposição. Cada campo sai com
 * o item do TR de onde veio e o quanto a leitura é confiável. O que não for
 * encontrado sai PENDENTE, para o pregoeiro informar.
 */

// ═══════════════════════════════════════════════════════════ ZIP
// Leitura mínima do formato: acha o diretório central, lê as entradas e
// descomprime as que interessam.

async function lerZip(arrayBuffer) {
  const dados = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  // "End of Central Directory": assinatura 0x06054b50, perto do fim
  let eocd = -1;
  for (let i = dados.length - 22; i >= Math.max(0, dados.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('não parece um arquivo .docx válido');

  const qtd = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true);
  const arquivos = new Map();

  for (let n = 0; n < qtd; n++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) break;
    const metodo    = dv.getUint16(pos + 10, true);
    const tamComp   = dv.getUint32(pos + 20, true);
    const nomeLen   = dv.getUint16(pos + 28, true);
    const extraLen  = dv.getUint16(pos + 30, true);
    const comentLen = dv.getUint16(pos + 32, true);
    const offset    = dv.getUint32(pos + 42, true);
    const nome = new TextDecoder().decode(dados.subarray(pos + 46, pos + 46 + nomeLen));
    arquivos.set(nome, { metodo, tamComp, offset });
    pos += 46 + nomeLen + extraLen + comentLen;
  }

  async function extrair(nome) {
    const e = arquivos.get(nome);
    if (!e) return null;
    // o cabeçalho local repete nome e extra, com tamanhos próprios
    const nomeLen  = dv.getUint16(e.offset + 26, true);
    const extraLen = dv.getUint16(e.offset + 28, true);
    const ini = e.offset + 30 + nomeLen + extraLen;
    const bruto = dados.subarray(ini, ini + e.tamComp);
    if (e.metodo === 0) return new TextDecoder().decode(bruto);          // sem compressão
    if (e.metodo !== 8) throw new Error(`compressão não suportada (${e.metodo})`);
    const fluxo = new Blob([bruto]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(fluxo).arrayBuffer());
  }

  return { arquivos, extrair };
}

// ═══════════════════════════════════════════════════════════ numeração
// No .docx o número não está no texto: o arquivo guarda "nível 2 da lista 4" e o
// Word calcula "15.2.1" ao exibir. Aqui a contagem é refeita do zero.

const ROMANOS = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
                 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];

function formatarNivel(valor, formato) {
  switch (formato) {
    case 'lowerLetter': return String.fromCharCode(97 + (valor - 1) % 26);
    case 'upperLetter': return String.fromCharCode(65 + (valor - 1) % 26);
    case 'lowerRoman':  return ROMANOS[valor] || String(valor);
    case 'upperRoman':  return (ROMANOS[valor] || String(valor)).toUpperCase();
    case 'bullet':      return '•';
    default:            return String(valor);
  }
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const filho  = (el, tag) => el ? el.getElementsByTagNameNS(W, tag)[0] || null : null;
const filhos = (el, tag) => el ? [...el.getElementsByTagNameNS(W, tag)] : [];
const attr   = (el, nome) => el ? el.getAttributeNS(W, nome) : null;

function lerNumeracao(xmlNumbering) {
  const niveis = new Map();      // "abstractId|ilvl" -> {formato, padrao, inicio}
  const paraAbstract = new Map(); // numId -> abstractId
  if (!xmlNumbering) return { niveis, paraAbstract };

  const doc = new DOMParser().parseFromString(xmlNumbering, 'application/xml');
  for (const a of doc.getElementsByTagNameNS(W, 'abstractNum')) {
    const aid = attr(a, 'abstractNumId');
    for (const lvl of filhos(a, 'lvl')) {
      niveis.set(`${aid}|${attr(lvl, 'ilvl')}`, {
        formato: attr(filho(lvl, 'numFmt'), 'val') || 'decimal',
        padrao:  attr(filho(lvl, 'lvlText'), 'val') || '%1',
        inicio:  parseInt(attr(filho(lvl, 'start'), 'val') || '1', 10),
      });
    }
  }
  for (const n of doc.getElementsByTagNameNS(W, 'num')) {
    const a = filho(n, 'abstractNumId');
    if (a) paraAbstract.set(attr(n, 'numId'), attr(a, 'val'));
  }
  return { niveis, paraAbstract };
}

// ═══════════════════════════════════════════════════════════ blocos do TR

async function lerDocx(arrayBuffer) {
  const zip = await lerZip(arrayBuffer);
  const xmlDoc = await zip.extrair('word/document.xml');
  if (!xmlDoc) throw new Error('não achei word/document.xml — o arquivo é mesmo um .docx?');
  const { niveis, paraAbstract } = lerNumeracao(await zip.extrair('word/numbering.xml'));

  const doc = new DOMParser().parseFromString(xmlDoc, 'application/xml');
  const contadores = new Map();

  function numero(numId, ilvl) {
    const aid = paraAbstract.get(numId);
    if (aid === undefined) return '';
    const il = parseInt(ilvl, 10);
    const cfg = k => niveis.get(`${aid}|${k}`) || { formato: 'decimal', padrao: '%1', inicio: 1 };

    const chave = `${numId}|${il}`;
    contadores.set(chave, (contadores.get(chave) ?? cfg(il).inicio - 1) + 1);
    for (const k of [...contadores.keys()]) {
      const [n, lv] = k.split('|');
      if (n === numId && parseInt(lv, 10) > il) contadores.delete(k);
    }

    let saida = cfg(il).padrao;
    for (let n = 0; n <= il; n++) {
      const c = cfg(n);
      const v = contadores.get(`${numId}|${n}`) ?? c.inicio;
      saida = saida.replace(`%${n + 1}`, formatarNivel(v, c.formato));
    }
    return saida.trim().replace(/\.$/, '');
  }

  const blocos = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    const texto = [...p.getElementsByTagNameNS(W, 't')]
      .map(t => t.textContent).join('').replace(/\s+/g, ' ').trim();
    let item = '';
    const numPr = filho(filho(p, 'pPr'), 'numPr');
    if (numPr) {
      const nid = attr(filho(numPr, 'numId'), 'val');
      const ilv = attr(filho(numPr, 'ilvl'), 'val') || '0';
      if (nid && nid !== '0') item = numero(nid, ilv);
    }
    if (texto) blocos.push({ item, pagina: 0, texto });
  }
  return blocos;
}

// ═══════════════════════════════════════════════════════════ o TR

class TR {
  constructor(blocos) {
    this.blocos = blocos.filter(b => b.texto);
    this.inicios = [];
    this.refs = [];
    const partes = [];
    let pos = 0;
    for (const b of this.blocos) {
      this.inicios.push(pos);
      this.refs.push([b.item, b.pagina]);
      partes.push(b.texto);
      pos += b.texto.length + 1;
    }
    this.texto = partes.join('\n');
  }

  /* Nem todo parágrafo é numerado — alínea, linha de tabela, texto corrido.
     Caindo num desses, o item volta à última cláusula numerada anterior. */
  onde(posicao) {
    if (!this.refs.length) return ['', 0];
    let lo = 0, hi = this.inicios.length - 1, i = 0;
    while (lo <= hi) {
      const meio = (lo + hi) >> 1;
      if (this.inicios[meio] <= posicao) { i = meio; lo = meio + 1; } else hi = meio - 1;
    }
    let [item, pagina] = this.refs[i];
    if (!item) {
      for (let j = i - 1; j >= 0; j--) {
        if (this.refs[j][0]) { item = this.refs[j][0]; pagina = pagina || this.refs[j][1]; break; }
      }
    }
    return [item, pagina];
  }

  /* Duas formas de restringir o alcance, porque buscar no documento inteiro
     produz falso positivo:
       perto_de — só na janela que segue uma âncora. Sem isso, "X% do valor"
                  casaria com a cláusula de multa tão bem quanto com a garantia.
       abertura — só nos primeiros N caracteres, onde o objeto é definido. Mais
                  adiante, um "prestação de serviço" solto classificaria um TR
                  de lubrificantes como serviço. */
  procurar(padrao, { pertoDe = null, janela = 900, abertura = 0 } = {}) {
    let base = this.texto, deslocamento = 0;
    if (abertura) {
      base = this.texto.slice(0, abertura);
    } else if (pertoDe) {
      const a = new RegExp(pertoDe, 'i').exec(this.texto);
      if (!a) return null;
      deslocamento = a.index;
      base = this.texto.slice(a.index, a.index + janela);
    }
    const m = new RegExp(padrao, 'i').exec(base);
    if (!m) return null;
    const [item, pagina] = this.onde(deslocamento + m.index);
    const ini = Math.max(0, m.index - 90);
    const fim = Math.min(base.length, m.index + m[0].length + 150);
    return { m, item, pagina, trecho: base.slice(ini, fim).replace(/\s+/g, ' ').trim() };
  }

  secao(tituloRegex) {
    for (const b of this.blocos) {
      if (!b.item || b.item.includes('.')) continue;
      if (new RegExp(tituloRegex, 'i').test(b.texto.trim())) return b.item;
    }
    return null;
  }

  itensDaSecao(numero) {
    if (!numero) return [];
    return this.blocos.filter(b => b.item === numero || b.item.startsWith(numero + '.'));
  }
}

// ═══════════════════════════════════════════════════════════ regras

const ANCORA_GARANTIA = 'garantia\\s+de\\s+execu[çc][ãa]o';

function achar(tr, campo, regras, observacao = '', opcoes = {}) {
  for (const [padrao, resultado, confianca] of regras) {
    const r = tr.procurar(padrao, opcoes);
    if (r) {
      const valor = typeof resultado === 'function' ? resultado(r.m) : resultado;
      return { campo, valor, item: r.item, pagina: r.pagina, trecho: r.trecho, confianca, observacao };
    }
  }
  return { campo, valor: null, item: '', pagina: 0, trecho: '', confianca: 'pendente', observacao };
}

const g = (m, i = 1) => (m[i] || '').trim();

function habilitacao(tr) {
  const achados = [];
  const sec = tr.secao('(QUALIFICA[ÇC][ÃA]O|CAPACIDADE)\\s+T[ÉE]CNICA');
  const itens = tr.itensDaSecao(sec);
  const corpo = itens.map(b => b.texto).join(' ');

  const dispensa = /(?:est[áa]\s+)?dispensad[ao]s?\s+a\s+apresenta[çc][ãa]o\s+de\s+atestados?/i.test(corpo);
  if (dispensa) {
    const alvo = itens.find(b => /dispensad/i.test(b.texto));
    achados.push({ campo: 'exige_atestado_capacidade', valor: 'não — dispensado no TR',
      item: alvo?.item || sec || '', pagina: alvo?.pagina || 0,
      trecho: (alvo?.texto || '').slice(0, 300), confianca: 'alta',
      observacao: 'o TR dispensa expressamente o atestado — R4' });
  } else if (/atestado/i.test(corpo)) {
    const alvo = itens.find(b => /atestado/i.test(b.texto));
    achados.push({ campo: 'exige_atestado_capacidade', valor: 'sim',
      item: alvo?.item || sec || '', pagina: alvo?.pagina || 0,
      trecho: (alvo?.texto || '').slice(0, 300), confianca: 'alta', observacao: 'R4' });
  } else {
    achados.push({ campo: 'exige_atestado_capacidade', valor: null, item: '', pagina: 0,
      trecho: '', confianca: 'pendente', observacao: 'R4' });
  }

  for (const [rotulo, padrao] of [
    ['qualificacao_tecnico_operacional', /t[ée]cnico[\s-]*operacional/i],
    ['qualificacao_tecnico_profissional', /t[ée]cnico[\s-]*profissional/i]]) {
    const alvo = itens.find(b => padrao.test(b.texto));
    achados.push(alvo
      ? { campo: rotulo, valor: 'exigida', item: alvo.item, pagina: alvo.pagina,
          trecho: alvo.texto.slice(0, 300), confianca: 'alta',
          observacao: 'o edital replica este requisito' }
      : { campo: rotulo, valor: null, item: '', pagina: 0, trecho: '', confianca: 'pendente',
          observacao: 'não mencionada no TR — típico fora de engenharia' });
  }

  const requisitos = itens
    .filter(b => b.item && b.item.includes('.') && b.texto.length > 40)
    .map(b => ({ item: b.item, pagina: b.pagina, texto: b.texto }));
  achados.push({ campo: 'requisitos_habilitacao', valor: requisitos.length ? requisitos : null,
    item: sec || '', pagina: itens[0]?.pagina || 0,
    trecho: sec ? `${requisitos.length} requisito(s) na seção ${sec}` : '',
    confianca: requisitos.length ? 'alta' : 'pendente',
    observacao: 'transcritos para o edital — conferir um a um' });
  return achados;
}

function extrair(tr) {
  const r = [];

  r.push(achar(tr, 'natureza_objeto', [
    ['dedica[çc][ãa]o\\s+exclusiva\\s+de\\s+m[ãa]o\\s+de\\s+obra', 'serviço com dedicação exclusiva', 'alta'],
    ['obra\\s+de\\s+engenharia', 'obra de engenharia', 'alta'],
    ['servi[çc]os?\\s+(?:comum\\s+)?de\\s+engenharia', 'serviço comum de engenharia', 'alta'],
    ['CLASSIFICA[ÇC][ÃA]O\\s+DO\\s+MATERIAL|aquisi[çc][ãa]o\\s+de\\s+materia', 'material', 'alta'],
    ['servi[çc]os?\\s+(?:s[ãa]o|ser[ãa]o)\\s+de\\s+natureza\\s+comum', 'serviço comum', 'alta'],
    ['\\baquisi[çc][ãa]o\\s+d[eo]s?\\b|\\bfornecimento\\s+d[eo]s?\\b|\\bcompra\\s+d[eo]s?\\b', 'material', 'alta'],
    ['contrata[çc][ãa]o\\s+de\\s+(?:empresa\\s+)?(?:especializada\\s+)?para\\s+presta[çc][ãa]o', 'serviço comum', 'alta'],
    ['presta[çc][ãa]o\\s+de\\s+servi[çc]o', 'serviço comum', 'media'],
  ], 'escolhe qual dos cinco modelos será usado — R1 · lido na abertura do TR', { abertura: 4000 }));

  r.push(achar(tr, 'objeto_continuado', [
    ['natureza\\s+comum\\s+e\\s+cont[íi]nua|servi[çc]os?\\s+cont[íi]nuos?', 'sim', 'alta'],
    ['prorrogado\\s+por\\s+iguais\\s+e\\s+sucessivos', 'sim', 'alta'],
  ], 'serviço contínuo admite prorrogação — art. 71 da Lei 13.303'));

  r.push(achar(tr, 'modalidade', [
    ['\\bdispensa\\s+de\\s+licita[çc][ãa]o\\b|\\bDISPENSA\\b', 'dispensa de licitação', 'alta'],
    ['\\bLEC\\b|licita[çc][ãa]o\\s+eletr[ôo]nica\\s+CBTU', 'LEC — Licitação Eletrônica CBTU', 'alta'],
    ['preg[ãa]o\\s+eletr[ôo]nico', 'Pregão Eletrônico', 'alta'],
  ], 'dispensa segue rito próprio — não gera edital de pregão'));

  const srp = achar(tr, 'usa_srp', [
    ['sistema\\s+de\\s+registro\\s+de\\s+pre[çc]os|ata\\s+de\\s+registro\\s+de\\s+pre[çc]os', 'sim', 'alta'],
  ], 'liga as três seções de SRP e a minuta da Ata — R2');
  if (srp.valor === null) {
    srp.valor = 'não'; srp.confianca = 'media';
    srp.observacao += ' · nenhuma menção a registro de preços';
  }
  r.push(srp);

  r.push(achar(tr, 'criterio_julgamento', [
    ['maior\\s+desconto', 'maior desconto', 'alta'],
    ['crit[ée]rio\\s+menor\\s+pre[çc]o|menor\\s+pre[çc]o\\s+(?:por|global|do\\s+item)', 'menor preço', 'alta'],
    ['escolhida\\s+a\\s+proposta\\s+com\\s+menor\\s+valor', 'menor preço', 'alta'],
    ['menor\\s+pre[çc]o', 'menor preço', 'media'],
  ], 'R11: define se o orçamento pode ser sigiloso'));

  r.push(achar(tr, 'julgamento_por', [
    ['adjudica[çc][ãa]o\\s+(?:ser[áa]\\s+)?(?:realizada\\s+)?por\\s+(item|grupo|lote|pre[çc]o\\s+global)', g, 'alta'],
    ['julgamento\\s+ser[áa]\\s+por\\s+(item|grupo|lote|pre[çc]o\\s+global)', g, 'alta'],
    ['por\\s+(item|grupo|lote)\\s+[uú]nico', g, 'media'],
    ['menor\\s+pre[çc]o\\s+por\\s+(item|grupo|lote)', g, 'media'],
  ]));

  r.push(achar(tr, 'regime_execucao', [
    ['empreitada\\s+por\\s+pre[çc]o\\s+(unit[áa]rio|global)', m => `empreitada por preço ${g(m)}`, 'alta'],
    ['contrata[çc][ãa]o\\s+(integrada|semi-?integrada)', m => `contratação ${g(m)}`, 'alta'],
    ['contrata[çc][ãa]o\\s+por\\s+tarefa', 'contratação por tarefa', 'alta'],
    ['fornecimento\\s+(?:parcelad|integral)', 'fornecimento', 'media'],
    ['entrega\\s+realizada\\s+em\\s+parcela\\s+[úu]nica', 'fornecimento', 'media'],
  ], "em material o modelo usa 'Forma de fornecimento', não 'Regime de execução'"));

  r.push(achar(tr, 'forma_fornecimento', [
    ['entrega\\s+realizada\\s+em\\s+parcela\\s+[úu]nica', 'parcelada (por pedido da ata)', 'alta'],
    ['fornecimento\\s+parcelad', 'parcelada', 'alta'],
    ['entrega\\s+[úu]nica|fornecimento\\s+integral|parcela\\s+[úu]nica', 'integral', 'media'],
  ]));

  r.push(achar(tr, 'admite_consorcio', [
    ['n[ãa]o\\s+[ée]\\s+aberta\\s+a\\s+cooperativas\\s+e\\s+cons[óo]rcios', 'não', 'alta'],
    ['vedada?\\s+a\\s+participa[çc][ãa]o\\s+de\\s+.{0,40}cons[óo]rcio', 'não', 'alta'],
    ['ser[áa]\\s+permitida\\s+a\\s+participa[çc][ãa]o\\s+.{0,40}cons[óo]rcio', 'sim', 'alta'],
  ], 'permitir consórcio traz 10 cláusulas ao edital'));

  r.push(achar(tr, 'admite_subcontratacao', [
    ['[ée]\\s+vedada\\s+a\\s+subcontrata[çc][ãa]o\\s+do\\s+objeto,\\s+admitindo', 'vedada, com ressalva', 'alta'],
    ['[ée]\\s+vedada\\s+a\\s+subcontrata[çc][ãa]o', 'vedada', 'alta'],
    ['n[ãa]o\\s+poder[áa]\\s+subcontratar', 'vedada', 'alta'],
    ['admite-se\\s+a\\s+subcontrata[çc][ãa]o|poder[áa]\\s+subcontratar', 'permitida', 'media'],
  ], 'R8'));

  r.push(achar(tr, 'participacao_meepp', [
    ['exclusiva\\s+(?:para|a)\\s+microempresas', 'exclusiva', 'alta'],
    ['cota\\s+reservada', 'cota reservada', 'alta'],
    ['prerrogativas\\s+de\\s+prefer[êe]ncia\\s+das\\s+Microempresas', 'ampla concorrência com preferência', 'alta'],
    ['microempresas?\\s*\\(ME\\)|empresas?\\s+de\\s+pequeno\\s+porte', 'ampla concorrência com preferência', 'media'],
  ], 'R5'));

  r.push(achar(tr, 'exige_garantia_execucao', [
    ['n[ãa]o\\s+(?:ser[áa]|haver[áa])\\s+(?:exigida\\s+)?garantia', 'não', 'alta'],
    ['garantia\\s+de\\s+execu[çc][ãa]o\\s+d[oe]\\s+contrato', 'sim', 'alta'],
  ], 'R6'));

  r.push(achar(tr, 'percentual_garantia_execucao', [
    ['(\\d{1,2}(?:,\\d+)?)\\s*%\\s*(?:\\([^)]{2,40}\\))?\\s*(?:por\\s+cento)?\\s*d[oe]\\s+valor',
      m => `${g(m)}%`, 'alta'],
  ], 'lido dentro da cláusula de garantia, não do TR inteiro', { pertoDe: ANCORA_GARANTIA }));

  r.push(achar(tr, 'prazo_apresentacao_garantia', [
    ['no\\s+prazo\\s+de\\s+(\\d+)\\s*\\(?[^)]*\\)?\\s*dias\\s+[úu]teis', m => `${g(m)} dias úteis`, 'alta'],
  ], '', { pertoDe: ANCORA_GARANTIA }));

  r.push(achar(tr, 'prazo_vigencia', [
    ['prazo\\s+de\\s+vig[êe]ncia\\s+d[oa]\\s+(?:contrato|ata)\\s+ser[áa]\\s+de\\s+(\\d+)\\s*\\(([^)]*)\\)\\s*(meses|dias|anos)',
      m => `${m[1]} ${m[3]}`, 'alta'],
    ['contrato\\s+dever[áa]\\s+ser\\s+executado\\s+no\\s+per[íi]odo\\s+de\\s+(\\d+)\\s*\\(?[^)]*\\)?\\s*(meses|dias|anos)',
      m => `${m[1]} ${m[2]}`, 'alta'],
    ['vig[êe]ncia\\s+(?:ser[áa]\\s+)?d[eo]\\s+(\\d+)\\s*\\(?[^)]*\\)?\\s*(meses|dias|anos)',
      m => `${m[1]} ${m[2]}`, 'media'],
  ]));

  r.push(achar(tr, 'prazo_entrega_execucao', [
    ['prazo\\s+de\\s+entrega\\s+d[oa]s?\\s+\\w+\\s+ser[áa]\\s+de\\s+(\\d+)\\s*\\(([^)]*)\\)\\s*(meses|dias)',
      m => `${m[1]} ${m[3]}`, 'alta'],
    ['entrega\\s+.{0,40}?prazo\\s+(?:m[áa]ximo\\s+)?de\\s+(\\d+)\\s*\\(?[^)]*\\)?\\s*(dias|meses)',
      m => `${m[1]} ${m[2]}`, 'media'],
    ['prazo\\s+(?:de\\s+)?(?:execu[çc][ãa]o|entrega)\\s+.{0,30}?(\\d+)\\s*\\(?[^)]*\\)?\\s*(meses|dias)',
      m => `${m[1]} ${m[2]}`, 'media'],
  ]));

  r.push(...habilitacao(tr));

  r.push(achar(tr, 'exige_visita_tecnica', [
    ['vistoria\\s+(?:pr[ée]via\\s+)?(?:ser[áa]\\s+)?obrigat[óo]ria|visita\\s+t[ée]cnica\\s+obrigat[óo]ria',
      'obrigatória', 'alta'],
    ['vistoria|visita\\s+t[ée]cnica', 'facultativa', 'media'],
  ], 'R4: se obrigatória, exige justificativa no TR'));

  r.push(achar(tr, 'exige_registro_conselho', [
    ['registro\\s+(?:ou\\s+inscri[çc][ãa]o\\s+)?n[oa]\\s+(CREA|CAU|CRA|CRM|CRO|CRC|CRQ)\\b', g, 'alta'],
  ]));

  r.push(achar(tr, 'valor_total_estimado', [
    ['valor\\s+(?:total\\s+)?estimad[oa].{0,50}?(R\\$\\s*[\\d.]+,\\d{2})', g, 'alta'],
    ['valor\\s+global.{0,50}?(R\\$\\s*[\\d.]+,\\d{2})', g, 'media'],
  ], 'só entra no edital quando o orçamento for divulgado — R11'));

  r.push(achar(tr, 'prazo_pagamento', [
    ['pagamento\\s+.{0,80}?prazo\\s+de\\s+at[ée]\\s+(\\d+)\\s*\\(?[^)]*\\)?\\s*dias', m => `${g(m)} dias`, 'alta'],
    ['prazo\\s+de\\s+at[ée]\\s+(\\d+)\\s*\\(?[^)]*\\)?\\s*dias\\s+.{0,50}?pagamento', m => `${g(m)} dias`, 'media'],
  ]));

  r.push(achar(tr, 'exige_sustentabilidade', [
    ['crit[ée]rios?\\s+(?:e\\s+pr[áa]ticas\\s+)?de\\s+sustentabilidade', 'sim', 'alta'],
    ['sustentabilidade', 'sim', 'media'],
  ]));

  r.push(achar(tr, 'garantia_produto', [
    ['garantia\\s+(?:do|dos)\\s+(?:produto|material|equipamento)s?.{0,40}?(\\d+)\\s*\\(?[^)]*\\)?\\s*(meses|anos)',
      m => `${m[1]} ${m[2]}`, 'alta'],
    ['prazo\\s+de\\s+garantia.{0,40}?(\\d+)\\s*\\(?[^)]*\\)?\\s*(meses|anos)',
      m => `${m[1]} ${m[2]}`, 'media'],
  ], 'garantia técnica do bem, distinta da garantia de execução'));

  r.push(achar(tr, 'objeto_resumido', [
    ['(?:OBJETO|DEFINI[ÇC][ÃA]O\\s+DO\\s+OBJETO)\\s*[:.]?\\s*(.{25,300}?)(?:\\.|$)', g, 'media'],
  ], 'copiado literalmente do TR, nunca redigitado', { abertura: 4000 }));

  r.push(achar(tr, 'unidade_requisitante', [
    ['TR\\s*N?[ºo°]?\\s*[\\d\\-/]+\\s*[/_]\\s*([A-Z]{4,6})\\b', g, 'alta'],
    ['\\b(CO[A-Z]{3}|G[IO][A-Z]{3})\\b\\s*[–\\-/]', g, 'media'],
  ], 'define o setor requisitante e o recebedor do objeto'));

  return r;
}

// ═══════════════════════════════════════════════════════════ interface pública

export async function extrairDoArquivo(arquivo) {
  const nome = arquivo.name.toLowerCase();
  if (!nome.endsWith('.docx')) {
    throw new Error(nome.endsWith('.pdf')
      ? 'PDF ainda não é lido no navegador — por ora, envie o TR em .docx'
      : 'formato não suportado: envie um .docx');
  }
  const blocos = await lerDocx(await arquivo.arrayBuffer());
  if (!blocos.length) throw new Error('o documento não tem texto — pode ser digitalizado');
  const tr = new TR(blocos);
  const achados = extrair(tr);
  return {
    achados,
    resumo: {
      blocos: tr.blocos.length,
      caracteres: tr.texto.length,
      localizados: achados.filter(a => a.valor !== null).length,
      total: achados.length,
      alta: achados.filter(a => a.confianca === 'alta').length,
    },
  };
}

export { TR, lerDocx, extrair };
