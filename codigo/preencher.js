/* Liga o extrator ao formulário: pega o que foi lido do TR e preenche a tela.
 *
 * Cada campo recebe também a PROCEDÊNCIA — item do TR, página quando houver, e o
 * quanto a leitura é confiável. O que o pregoeiro alterar depois passa a valer
 * sobre a leitura, e fica marcado como correção.
 */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* Como cada campo do extrator chega à tela.
   `tipo` diz o que fazer com o valor; `casar` traduz o texto do TR para a opção
   do formulário, quando os dois não usam as mesmas palavras. */
const MAPA = {
  objeto_resumido: { alvo: '#objeto', tipo: 'texto' },

  natureza_objeto: { alvo: '#natureza', tipo: 'select', casar: v => ({
    'material': 'material',
    'serviço comum': 'serviço comum',
    'serviço com dedicação exclusiva': 'serviço com dedicação exclusiva de mão de obra',
    'serviço comum de engenharia': 'serviço comum de engenharia',
    'obra de engenharia': 'obra de engenharia',
  }[v] || v) },

  usa_srp: { alvo: 'input[name=srp]', tipo: 'radio', casar: v => v === 'sim' ? 0 : 1 },

  criterio_julgamento: { alvo: '#criterio', tipo: 'select' },
  forma_fornecimento:  { alvo: '#fornecimento', tipo: 'texto' },

  admite_consorcio: { alvo: 'input[name=cons]', tipo: 'radio', casar: v => v === 'sim' ? 0 : 1 },

  admite_subcontratacao: { alvo: '#subc', tipo: 'select', casar: v => ({
    'permitida': 'permitida',
    'vedada, com ressalva': 'vedada, com ressalva',
    'vedada': 'vedada',
  }[v] || v) },

  participacao_meepp: { alvo: '#meepp', tipo: 'select', casar: v => ({
    'ampla concorrência com preferência': 'ampla concorrência com preferência',
    'exclusiva': 'exclusiva para ME/EPP',
    'cota reservada': 'cota reservada',
  }[v] || v) },

  prazo_vigencia:          { alvo: '#vig', tipo: 'texto' },
  prazo_entrega_execucao:  { alvo: '#ent', tipo: 'texto' },
  garantia_produto:        { alvo: '#gar-prod', tipo: 'texto' },
  unidade_requisitante:    { alvo: '#unid', tipo: 'texto' },

  exige_atestado_capacidade: { alvo: 'input[name=atest]', tipo: 'radio',
    casar: v => String(v).startsWith('não') ? 1 : 0 },

  qualificacao_tecnico_operacional:  { alvo: 'input[name=qto]', tipo: 'radio',
    casar: v => v === 'exigida' ? 0 : 1 },
  qualificacao_tecnico_profissional: { alvo: 'input[name=qtp]', tipo: 'radio',
    casar: v => v === 'exigida' ? 0 : 1 },

  exige_registro_conselho: { alvo: '#conselho', tipo: 'select' },
};

const SELO = { alta: 'alta', media: 'média', pendente: 'pendente' };

function origemHTML(a) {
  if (a.valor === null) {
    return `<span class="selo pendente">não localizado</span>` +
           `<span class="fonte">o TR não traz — informe abaixo</span>`;
  }
  const onde = [a.item ? `<b>item ${a.item}</b>` : null, a.pagina ? `p. ${a.pagina}` : null]
    .filter(Boolean).join(' · ');
  const obs = a.observacao ? ` · ${a.observacao}` : '';
  return `<span class="selo ${a.confianca}">${SELO[a.confianca]}</span>` +
         `<span class="fonte">TR${onde ? ' · ' + onde : ''}${obs}</span>`;
}

/* Preenche a tela a partir dos achados. Devolve o que não coube em nenhum campo,
   para o chamador decidir o que fazer. */
export function preencher(achados, { origens, explicadores, aoTerminar } = {}) {
  const porCampo = Object.fromEntries(achados.map(a => [a.campo, a]));
  const naoAplicados = [];

  for (const [campo, cfg] of Object.entries(MAPA)) {
    const a = porCampo[campo];
    if (!a) continue;

    if (a.valor !== null) {
      const bruto = cfg.casar ? cfg.casar(a.valor) : a.valor;
      if (cfg.tipo === 'radio') {
        const opcoes = $$(cfg.alvo);
        if (typeof bruto === 'number' && opcoes[bruto]) opcoes[bruto].checked = true;
      } else if (cfg.tipo === 'select') {
        const el = $(cfg.alvo);
        const opcao = [...el.options].find(o =>
          o.value.toLowerCase() === String(bruto).toLowerCase() ||
          o.textContent.trim().toLowerCase() === String(bruto).toLowerCase());
        if (opcao) el.value = opcao.value; else naoAplicados.push({ campo, valor: a.valor });
      } else {
        const el = $(cfg.alvo);
        if (el) el.value = bruto;
      }
    }

    // procedência: nos campos com explicação dinâmica, guarda para o explicador usar
    const campoEl = (cfg.tipo === 'radio' ? $$(cfg.alvo)[0] : $(cfg.alvo))?.closest('.campo');
    const origem = campoEl?.querySelector('.origem');
    if (!origem) continue;
    if (origem.id && origens) origens[origem.id] = origemHTML(a);
    else origem.innerHTML = origemHTML(a);
  }

  // habilitação: a lista de requisitos é reconstruída inteira
  const req = porCampo['requisitos_habilitacao'];
  const lista = $('ul.requisitos');
  if (lista && req) {
    lista.innerHTML = '';
    if (Array.isArray(req.valor)) {
      for (const r of req.valor) {
        const li = document.createElement('li');
        li.innerHTML = `<label><input type="checkbox" checked>` +
          `<span><b>${r.item}</b> ${r.texto.replace(/</g, '&lt;').slice(0, 420)}</span></label>`;
        lista.appendChild(li);
      }
    } else {
      lista.innerHTML = '<li><label><span>Nenhum requisito localizado na seção de ' +
                        'qualificação técnica do TR.</span></label></li>';
    }
    const o = lista.closest('.campo')?.querySelector('.origem');
    if (o) o.innerHTML = origemHTML(req);
  }

  if (explicadores) for (const f of Object.values(explicadores)) f();
  if (aoTerminar) aoTerminar(porCampo, naoAplicados);
  return { porCampo, naoAplicados };
}

export { MAPA, origemHTML };
