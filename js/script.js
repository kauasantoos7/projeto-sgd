// =====================================================================
// SITE PÚBLICO — Esporte e Lazer de Regente Feijó
// As modalidades, os filtros e as solicitações vêm de js/dados.js
// (cadastrados pelo CEO na área administrativa).
// =====================================================================
const MAX_BOTOES_DESKTOP = 7; // no notebook: "Todas" + 6 filtros; o que passar vai para "Mais ↓"
const MAX_FOTOS = 3;          // no máximo 3 fotos por modalidade
const POR_PAGINA = 6;         // a cada 6 modalidades, 1 página nova
const TITULO_SITE = document.title;

let modalidades = [];
let filtros = [];
let carregado = false;
let categoriaAtual = "todas";
let termoBusca = "";
let paginaAtual = 1;

const elCards = document.getElementById("cards");
const elPaginacao = document.getElementById("paginacao");
const elBusca = document.getElementById("campoBusca");
const elFiltros = document.getElementById("filtros");
const elPainel = document.getElementById("painelFiltros");
const viewLista = document.getElementById("viewLista");
const viewDetalhe = document.getElementById("viewDetalhe");

// ===== UTIL =====
function esc(txt) {
  return String(txt ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normalizar(txt) {
  return String(txt || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function mostrarAviso(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visivel");
  clearTimeout(mostrarAviso.timer);
  mostrarAviso.timer = setTimeout(() => t.classList.remove("visivel"), 4000);
}

function irPara(y) {
  window.scrollTo({ top: y, behavior: "instant" });
}

function nomeDoFiltro(id) {
  const f = filtros.find(x => x.id === id);
  return f ? f.nome : "Sem categoria";
}

// ===== CONTADOR DE MODALIDADES (variável) =====
function atualizarContador() {
  const total = modalidades.length;
  document.getElementById("totalModalidades").textContent = total;
  document.getElementById("rotuloModalidades").innerHTML =
    total === 1 ? "Modalidade<br>regular" : "Modalidades<br>regulares";
}

// ===== FILTROS =====
// Notebook: "Todas" + até 6 filtros; se passar disso aparece "Mais ↓".
// Mobile:   apenas "Todas" + "Filtros ↓" (com a lista de todos os filtros).
let painelGatilho = null;

function renderFiltros() {
  const visiveis = filtros.slice(0, MAX_BOTOES_DESKTOP - 1);
  const extras = filtros.slice(MAX_BOTOES_DESKTOP - 1);
  const classeAtivo = id => (categoriaAtual === id ? "ativo" : "");

  let html = `<button class="filtro ${classeAtivo("todas")}" data-cat="todas">Todas</button>`;

  html += visiveis.map(f =>
    `<button class="filtro f-desk ${classeAtivo(f.id)}" data-cat="${esc(f.id)}">${esc(f.nome)}</button>`
  ).join("");

  if (extras.length) {
    const ativo = extras.some(f => f.id === categoriaAtual) ? "ativo" : "";
    html += `<button class="filtro mais f-desk ${ativo}" id="btnMais" aria-haspopup="true" aria-expanded="false">Mais ↓</button>`;
  }

  if (filtros.length) {
    const ativo = categoriaAtual !== "todas" ? "ativo" : "";
    html += `<button class="filtro mais f-mob ${ativo}" id="btnFiltros" aria-haspopup="true" aria-expanded="false">Filtros ↓</button>`;
  }

  elFiltros.innerHTML = html;
}

function abrirPainel(gatilho) {
  const mobile = gatilho.id === "btnFiltros";
  const lista = mobile ? filtros : filtros.slice(MAX_BOTOES_DESKTOP - 1);

  elPainel.className = "painel-filtros " + (mobile ? "painel-mob" : "painel-desk");
  elPainel.innerHTML = lista.map(f =>
    `<button class="painel-item ${f.id === categoriaAtual ? "ativo" : ""}" data-cat="${esc(f.id)}">${esc(f.nome)}</button>`
  ).join("");
  elPainel.hidden = false;
  gatilho.setAttribute("aria-expanded", "true");
  painelGatilho = gatilho;
}

function fecharPainel() {
  elPainel.hidden = true;
  if (painelGatilho) painelGatilho.setAttribute("aria-expanded", "false");
  painelGatilho = null;
}

function selecionarFiltro(id) {
  categoriaAtual = id;
  paginaAtual = 1;
  fecharPainel();
  renderFiltros();
  renderCards();
}

// ===== LISTA: CARDS E PAGINAÇÃO =====
function filtrar() {
  return modalidades
    .filter(m => categoriaAtual === "todas" || m.cat === categoriaAtual)
    .filter(m => normalizar(m.nome).includes(normalizar(termoBusca)));
}

function renderCards() {
  const lista = filtrar();
  const totalPaginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;

  const inicio = (paginaAtual - 1) * POR_PAGINA;
  const pagina = lista.slice(inicio, inicio + POR_PAGINA);

  if (pagina.length === 0) {
    elCards.innerHTML = '<p class="vazio">Nenhuma modalidade encontrada.</p>';
  } else {
    elCards.innerHTML = pagina.map(m => `
      <article class="card">
        <h2 class="card-titulo">${esc(m.nome)}</h2>
        <div class="card-corpo">
          <div>Dias: ${esc(m.dias)}</div>
          <div>Categoria: ${esc(nomeDoFiltro(m.cat))}</div>
          <div>Local: ${esc(m.local)}</div>
        </div>
        <button class="card-btn" data-id="${esc(m.id)}">Ver Mais Informações →</button>
      </article>
    `).join("");
  }
  renderPaginacao(totalPaginas);
}

function listaDePaginas(total, atual) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, atual - 1, atual, atual + 1]);
  const nums = [...set].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const saida = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) saida.push("…");
    saida.push(n);
  });
  return saida;
}

function renderPaginacao(total) {
  if (total <= 1) { elPaginacao.innerHTML = ""; return; }

  let html = `<button data-p="${paginaAtual - 1}" aria-label="Página anterior" ${paginaAtual === 1 ? "disabled" : ""}>&lt;</button>`;
  listaDePaginas(total, paginaAtual).forEach(p => {
    if (p === "…") html += `<span>…</span>`;
    else html += `<button data-p="${p}" class="${p === paginaAtual ? "ativo" : ""}" ${p === paginaAtual ? 'aria-current="page"' : ""}>${p}</button>`;
  });
  html += `<button data-p="${paginaAtual + 1}" aria-label="Próxima página" ${paginaAtual === total ? "disabled" : ""}>&gt;</button>`;
  elPaginacao.innerHTML = html;
}

// ===== TELA DE DETALHES =====
function htmlGaleria(fotos) {
  if (!fotos || fotos.length === 0) return "";
  const lista = fotos.slice(0, MAX_FOTOS);
  const slides = lista.map((src, i) => `
    <div class="galeria-slide ${i === 0 ? "ativo" : ""}">
      ${src ? `<img src="${esc(src)}" alt="Foto ${i + 1}">` : `FOTO ${i + 1}`}
    </div>`).join("");
  const botoes = lista.length > 1
    ? `<button class="galeria-btn ant" aria-label="Foto anterior">&lt;</button>
       <button class="galeria-btn prox" aria-label="Próxima foto">&gt;</button>`
    : "";
  return `<div class="galeria" id="galeria">${slides}${botoes}</div>`;
}

function renderDetalhe(m) {
  viewDetalhe.innerHTML = `
    <div class="detalhe-topo">
      <button class="btn-voltar" id="btnVoltar" aria-label="Voltar para a lista de modalidades">
        <svg viewBox="0 0 40 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="38" y1="12" x2="3" y2="12"></line><polyline points="13,2 3,12 13,22"></polyline>
        </svg>
      </button>
      <h2>${esc(m.nome)}</h2>
    </div>

    <div class="detalhe-corpo">
      <div class="detalhe-info">
        <p>Dias: ${esc(m.dias)}</p>
        <p>Categoria: ${esc(nomeDoFiltro(m.cat))}</p>
        <p>Local: ${esc(m.local)}</p>
        ${m.endereco ? `<p>Endereço: ${esc(m.endereco)}</p>` : ""}
      </div>

      ${m.descricao ? `<p class="detalhe-desc">Descrição: ${esc(m.descricao)}</p>` : ""}

      ${htmlGaleria(m.fotos)}

      ${m.horarios ? `<div class="horarios"><h3>Horários:</h3><p class="horarios-texto">${esc(m.horarios)}</p></div>` : ""}

      ${m.professor ? `<p class="detalhe-prof">Professor(a): ${esc(m.professor)}</p>` : ""}

      <button class="btn-solicitar" id="btnSolicitar">Solicitar Vaga →</button>
    </div>
  `;

  iniciarGaleria();
  document.getElementById("btnVoltar").addEventListener("click", voltarParaLista);
  document.getElementById("btnSolicitar").addEventListener("click", () => abrirModalVaga(m.id));
  document.title = `${m.nome} — ${TITULO_SITE}`;
}

function iniciarGaleria() {
  const galeria = document.getElementById("galeria");
  if (!galeria) return;
  const slides = Array.from(galeria.querySelectorAll(".galeria-slide"));
  let atual = 0;

  function ir(i) {
    slides[atual].classList.remove("ativo");
    atual = (i + slides.length) % slides.length;
    slides[atual].classList.add("ativo");
  }

  const ant = galeria.querySelector(".ant");
  const prox = galeria.querySelector(".prox");
  if (ant) ant.addEventListener("click", () => ir(atual - 1));
  if (prox) prox.addEventListener("click", () => ir(atual + 1));

  // arrastar com o dedo (celular)
  let x0 = null;
  galeria.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
  galeria.addEventListener("touchend", e => {
    if (x0 === null || slides.length < 2) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) ir(dx < 0 ? atual + 1 : atual - 1);
    x0 = null;
  });
}

// ===== SOLICITAR VAGA =====
const modalVaga = document.getElementById("modalVaga");
const formVaga = document.getElementById("formVaga");
const vagaErro = document.getElementById("vagaErro");
let vagaModalidadeId = null;

function mascaraTelefone(txt) {
  const d = String(txt).replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function abrirModalVaga(id) {
  const m = modalidades.find(x => x.id === id);
  if (!m) return;
  vagaModalidadeId = id;
  formVaga.reset();
  vagaErro.textContent = "";
  document.getElementById("vagaModalidade").textContent = m.nome;
  modalVaga.classList.add("aberto");
  modalVaga.setAttribute("aria-hidden", "false");
  document.body.classList.add("trava");
  setTimeout(() => document.getElementById("vagaNome").focus(), 50);
}

function fecharModalVaga() {
  modalVaga.classList.remove("aberto");
  modalVaga.setAttribute("aria-hidden", "true");
  document.body.classList.remove("trava");
}

document.getElementById("vagaTelefone").addEventListener("input", e => {
  e.target.value = mascaraTelefone(e.target.value);
});
formVaga.addEventListener("input", () => { vagaErro.textContent = ""; });
document.getElementById("vagaFechar").addEventListener("click", fecharModalVaga);
document.getElementById("vagaCancelar").addEventListener("click", fecharModalVaga);
modalVaga.addEventListener("click", e => { if (e.target === modalVaga) fecharModalVaga(); });

formVaga.addEventListener("submit", async e => {
  e.preventDefault();
  const nome = document.getElementById("vagaNome").value.trim().replace(/\s+/g, " ");
  const idade = Number(document.getElementById("vagaIdade").value);
  const telefone = document.getElementById("vagaTelefone").value.trim();
  const disponibilidade = document.getElementById("vagaHorarios").value.trim();

  let erro = "";
  if (nome.split(" ").filter(p => p.length > 1).length < 2) erro = "Informe o seu nome completo.";
  else if (!Number.isInteger(idade) || idade < 1 || idade > 120) erro = "Informe uma idade válida.";
  else if (![10, 11].includes(telefone.replace(/\D/g, "").length)) erro = "Informe um telefone válido, com DDD.";
  else if (disponibilidade.length < 3) erro = "Conte em quais horários você tem disponibilidade.";

  if (erro) { vagaErro.textContent = erro; return; }

  const m = modalidades.find(x => x.id === vagaModalidadeId);
  const botao = document.getElementById("vagaEnviar");
  botao.disabled = true;
  try {
    await Dados.criarSolicitacao({
      modalidadeId: vagaModalidadeId,
      modalidadeNome: m ? m.nome : "",
      nome, idade, telefone, disponibilidade
    });
    fecharModalVaga();
    mostrarAviso("Solicitação enviada! Entraremos em contato pelo telefone informado.");
  } catch {
    vagaErro.textContent = "Não foi possível enviar agora. Tente novamente.";
  } finally {
    botao.disabled = false;
  }
});

// ===== NAVEGAÇÃO ENTRE AS TELAS (sem outra página .html) =====
let viewAtual = "lista";
let scrollSalvo = null;   // posição da lista antes de abrir os detalhes
let hashAntes = "";       // hash que estava ativo antes de abrir os detalhes
let veioDaLista = false;

function mostrarLista() {
  viewDetalhe.hidden = true;
  viewLista.hidden = false;
  viewAtual = "lista";
  document.title = TITULO_SITE;
}

function mostrarDetalhe(m) {
  fecharPainel();
  renderDetalhe(m);
  viewLista.hidden = true;
  viewDetalhe.hidden = false;
  viewAtual = "detalhe";
  irPara(0);
}

function abrirDetalhe(id) {
  scrollSalvo = window.scrollY;
  hashAntes = location.hash;
  veioDaLista = true;
  location.hash = "modalidade-" + id;
}

function voltarParaLista() {
  if (veioDaLista) {
    veioDaLista = false;
    history.back();
  } else {
    location.hash = "#grade";
  }
}

function rotear() {
  if (!carregado) return;
  const h = location.hash;
  const achou = h.match(/^#modalidade-([A-Za-z0-9_-]+)$/);
  const m = achou ? modalidades.find(x => x.id === achou[1]) : null;

  if (m) { mostrarDetalhe(m); return; }

  // rodapé existe nas duas telas: o navegador já rola até ele
  if (h === "#estrutura") return;

  const veioDoDetalhe = viewAtual === "detalhe";
  mostrarLista();
  if (!veioDoDetalhe) return;

  if (scrollSalvo !== null && h === hashAntes) {
    irPara(scrollSalvo);
  } else {
    const alvo = h ? document.getElementById(h.slice(1)) : null;
    if (alvo) alvo.scrollIntoView();
    else irPara(0);
  }
}

window.addEventListener("hashchange", rotear);

// ===== CARROSSEL AUTOMÁTICO DA CAPA =====
(function iniciarCarrossel() {
  const slides = Array.from(document.querySelectorAll("#carrossel .slide"));
  const INTERVALO = 5000;   // tempo de uma foto até a próxima (ms)
  const TRANSICAO = 1500;   // duração do efeito de fade entre as fotos (ms)
  let atual = 0;

  slides.forEach(s => { s.style.transitionDuration = TRANSICAO + "ms"; });

  // só participam os slides que já tiverem src preenchido
  const preenchido = s => (s.getAttribute("src") || "").trim() !== "";

  function proximo() {
    const ativos = slides.filter(preenchido);
    if (ativos.length < 2) return;
    let i = atual;
    do { i = (i + 1) % slides.length; } while (!preenchido(slides[i]));

    // a foto nova aparece por cima da antiga, que só sai de cena depois do fade
    const saindo = slides[atual];
    saindo.classList.remove("ativo");
    saindo.classList.add("saindo");
    slides[i].classList.add("ativo");
    setTimeout(() => saindo.classList.remove("saindo"), TRANSICAO + 50);
    atual = i;
  }

  setInterval(proximo, INTERVALO);
})();

// ===== MENU MOBILE =====
(function iniciarMenu() {
  const btn = document.getElementById("btnMenu");
  const menu = document.getElementById("menu");

  function alternar(abrir) {
    menu.classList.toggle("aberto", abrir);
    btn.classList.toggle("aberto", abrir);
    btn.setAttribute("aria-expanded", abrir);
  }

  btn.addEventListener("click", e => {
    e.stopPropagation();
    alternar(!menu.classList.contains("aberto"));
  });
  menu.addEventListener("click", e => { if (e.target.closest("a")) alternar(false); });
  document.addEventListener("click", e => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) alternar(false);
  });
  window.addEventListener("resize", () => { if (window.innerWidth > 900) alternar(false); });
})();

// ===== EVENTOS DA LISTA =====
elBusca.addEventListener("input", e => {
  termoBusca = e.target.value;
  paginaAtual = 1;
  renderCards();
});

document.querySelector(".filtros-wrap").addEventListener("click", e => {
  const item = e.target.closest("[data-cat]");
  if (item) { selecionarFiltro(item.dataset.cat); return; }

  const gatilho = e.target.closest("#btnMais, #btnFiltros");
  if (gatilho) {
    if (painelGatilho === gatilho && !elPainel.hidden) fecharPainel();
    else { fecharPainel(); abrirPainel(gatilho); }
  }
});

// fecha a tabelinha ao clicar fora, ao apertar Esc ou ao trocar entre mobile/notebook
document.addEventListener("click", e => {
  if (!e.target.closest(".filtros-wrap")) fecharPainel();
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  fecharPainel();
  if (modalVaga.classList.contains("aberto")) fecharModalVaga();
});
window.matchMedia("(max-width: 900px)").addEventListener("change", fecharPainel);

elPaginacao.addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn || btn.disabled) return;
  paginaAtual = Number(btn.dataset.p);
  renderCards();
  document.getElementById("grade").scrollIntoView({ behavior: "smooth" });
});

elCards.addEventListener("click", e => {
  const btn = e.target.closest(".card-btn");
  if (btn) abrirDetalhe(btn.dataset.id);
});

// ===== INÍCIO =====
async function iniciarSite() {
  elCards.innerHTML = '<p class="vazio">Carregando…</p>';
  try {
    [modalidades, filtros] = await Promise.all([Dados.listarModalidades(), Dados.listarFiltros()]);
  } catch {
    elCards.innerHTML = '<p class="vazio">Não foi possível carregar as modalidades.</p>';
    return;
  }
  carregado = true;
  atualizarContador();
  renderFiltros();
  renderCards();
  rotear(); // abre direto nos detalhes se a URL for, por exemplo, index.html#modalidade-m2
}

iniciarSite();