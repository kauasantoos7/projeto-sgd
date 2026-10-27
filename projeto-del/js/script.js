// =====================================================================
// FILTROS (criados pelo admin)
// "Todas" sempre existe e não faz parte desta lista.
// Cada modalidade aponta para um filtro pelo campo "cat" (= id do filtro).
// =====================================================================
const filtros = [
  { id: "infantil", nome: "Infantil (06-11)" },
  { id: "sub15", nome: "Sub-15 (12-15)" },
  { id: "sub18", nome: "Sub-18 (16-18)" },
  { id: "adulto", nome: "Adulto (19-59)" },
  { id: "idade", nome: "Melhor Idade (60+)" },
  { id: "livre", nome: "Livre" }
];

const MAX_BOTOES_DESKTOP = 7; // no notebook: "Todas" + 6 filtros; o que passar vai para "Mais ↓"

// =====================================================================
// DADOS DAS MODALIDADES CADASTRADAS
// Cada item é uma modalidade. No futuro, o painel do administrador
// vai criar, editar e excluir estes itens.
//
//  Informações completas de cada modalidade:
//    dias, categoria, local, endereco, descricao e até 3 fotos.
//  Limite de fotos: MAX_FOTOS por modalidade, com no máximo MAX_FOTO_KB
//  cada uma (o limite de peso deve ser conferido no upload do admin).
//  Se a modalidade não tiver fotos, a galeria simplesmente não aparece.
//
//  nome ................ título do card e da tela de detalhes
//  cat ................. id do filtro (veja a lista "filtros")
//  localDetalhe ........ (opcional) local na tela de detalhes
//  fotos ............... caminhos das fotos ("" = mostra "FOTO n")
//  horarios ............ (opcional) [{ dia, turmas: [...] }]
// =====================================================================
const MAX_FOTOS = 3;
const MAX_FOTO_KB = 500; // usado pelo admin na validação do upload

const CAF_ENDERECO = "Avenida José Bonifácio, nº 23, Centro, Regente Feijó - SP, CEP 19570-000";
const FOTOS = ["", "", ""];

const modalidades = [
  { nome: "Vôlei - Sub 15", dias: "Terça-feira", categoria: "Sub15 (12-15)", cat: "sub15", local: "Ginásio de Esportes", fotos: FOTOS },
  {
    nome: "Karatê",
    dias: "Segunda, Quarta e Sexta-feira",
    categoria: "Livre",
    cat: "livre",
    local: "Centro de Atividade Física - Tênis Clube",
    localDetalhe: "CAF (Centro de Atividade Física) - Tênis Clube",
    endereco: CAF_ENDERECO,
    descricao: "Oferecida gratuitamente no Centro de Atividade Física (CAF), a modalidade de Karatê do Departamento de Esporte e Lazer de Regente Feijó combina desenvolvimento físico, cidadania e inclusão social para crianças, jovens e adultos. Além de cultivar disciplina, respeito e saúde na comunidade, o projeto conta com orientação técnica qualificada para preparar atletas locais que representam o município com destaque em campeonatos regionais, estaduais e nacionais.",
    fotos: FOTOS,
    horarios: [
      { dia: "Terça-feira (Tarde)", turmas: ["15h00 às 16h30: 09 a 13 anos", "17h00 às 18h00: 14 a 17 anos"] },
      { dia: "Quarta-feira (Manhã)", turmas: ["09h30 às 11h00: 09 a 14 anos"] },
      { dia: "Quinta-feira (Tarde)", turmas: ["15h30 às 17h00: 09 a 13 anos"] }
    ]
  },
  { nome: "Atletismo - Sub 18", dias: "Segunda, Quarta e Sexta-feira", categoria: "Livre", cat: "sub18", local: "Centro de Atividade Física - Tênis Clube", endereco: CAF_ENDERECO, fotos: FOTOS },
  { nome: "Vôlei - Sub 15", dias: "Segunda, Quarta e Sexta-feira", categoria: "Livre", cat: "sub15", local: "Centro de Atividade Física - Tênis Clube", endereco: CAF_ENDERECO, fotos: FOTOS },
  { nome: "Vôlei - Sub 15", dias: "Segunda, Quarta e Sexta-feira", categoria: "Livre", cat: "sub15", local: "Centro de Atividade Física - Tênis Clube", endereco: CAF_ENDERECO, fotos: FOTOS },
  { nome: "Vôlei - Sub 15", dias: "Segunda, Quarta e Sexta-feira", categoria: "Livre", cat: "sub15", local: "Centro de Atividade Física - Tênis Clube", endereco: CAF_ENDERECO, fotos: FOTOS },
  { nome: "Futsal - Infantil", dias: "Terça e Quinta-feira", categoria: "Infantil (06-11)", cat: "infantil", local: "Ginásio de Esportes", fotos: FOTOS },
  { nome: "Hidroginástica", dias: "Segunda e Quarta-feira", categoria: "Melhor Idade (60+)", cat: "idade", local: "Piscina Municipal", fotos: FOTOS },
  { nome: "Caminhada Orientada", dias: "Terça e Quinta-feira", categoria: "Melhor Idade (60+)", cat: "idade", local: "Praça Central", fotos: FOTOS },
  { nome: "Basquete - Sub 18", dias: "Quarta e Sexta-feira", categoria: "Sub18 (16-18)", cat: "sub18", local: "Ginásio de Esportes", fotos: FOTOS },
  { nome: "Treino Funcional", dias: "Segunda, Quarta e Sexta-feira", categoria: "Adulto (19-59)", cat: "adulto", local: "Centro de Atividade Física - Tênis Clube", endereco: CAF_ENDERECO, fotos: FOTOS },
  { nome: "Natação - Infantil", dias: "Terça e Quinta-feira", categoria: "Infantil (06-11)", cat: "infantil", local: "Piscina Municipal", fotos: FOTOS }
];

const POR_PAGINA = 6; // a cada 6 modalidades, 1 página nova
const TITULO_SITE = document.title;

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
  return txt.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function mostrarAviso(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visivel");
  clearTimeout(mostrarAviso.timer);
  mostrarAviso.timer = setTimeout(() => t.classList.remove("visivel"), 3500);
}

function irPara(y) {
  window.scrollTo({ top: y, behavior: "instant" });
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
    .map((m, i) => ({ ...m, id: i }))
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
          <div>Categoria: ${esc(m.categoria)}</div>
          <div>Local: ${esc(m.local)}</div>
        </div>
        <button class="card-btn" data-id="${m.id}">Ver Mais Informações →</button>
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
  const lista = fotos.slice(0, MAX_FOTOS); // no máximo 3 fotos por modalidade
  const slides = lista.map((src, i) => `
    <div class="galeria-slide ${i === 0 ? "ativo" : ""}">
      ${src ? `<img src="${esc(src)}" alt="Foto ${i + 1}" loading="lazy">` : `FOTO ${i + 1}`}
    </div>`).join("");
  const botoes = lista.length > 1
    ? `<button class="galeria-btn ant" aria-label="Foto anterior">&lt;</button>
       <button class="galeria-btn prox" aria-label="Próxima foto">&gt;</button>`
    : "";
  return `<div class="galeria" id="galeria">${slides}${botoes}</div>`;
}

function htmlHorarios(horarios) {
  if (!horarios || horarios.length === 0) return "";
  const blocos = horarios.map(h => `
    <p class="horario-dia">${esc(h.dia)}</p>
    <ul>${(h.turmas || []).map(t => `<li>${esc(t)}</li>`).join("")}</ul>
  `).join("");
  return `<div class="horarios"><h3>Horários:</h3>${blocos}</div>`;
}

function renderDetalhe(id) {
  const m = modalidades[id];
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
        <p>Categoria: ${esc(m.categoria)}</p>
        <p>Local: ${esc(m.localDetalhe || m.local)}</p>
        ${m.endereco ? `<p>Endereço: ${esc(m.endereco)}</p>` : ""}
      </div>

      ${m.descricao ? `<p class="detalhe-desc">Descrição: ${esc(m.descricao)}</p>` : ""}

      ${htmlGaleria(m.fotos)}
      ${htmlHorarios(m.horarios)}

      <button class="btn-solicitar" id="btnSolicitar">Solicitar Vaga →</button>
    </div>
  `;

  iniciarGaleria();
  document.getElementById("btnVoltar").addEventListener("click", voltarParaLista);
  document.getElementById("btnSolicitar").addEventListener("click", () => solicitarVaga(id));
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

// Ponto de ligação para o futuro sistema de solicitações (admin aceita/recusa)
function solicitarVaga(id) {
  mostrarAviso("Em breve você poderá solicitar sua vaga por aqui.");
}

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

function mostrarDetalhe(id) {
  fecharPainel();
  renderDetalhe(id);
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
  const h = location.hash;
  const m = h.match(/^#modalidade-(\d+)$/);

  if (m && modalidades[Number(m[1])]) {
    mostrarDetalhe(Number(m[1]));
    return;
  }

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
  const INTERVALO = 4000;
  let atual = 0;

  // só participam os slides que já tiverem src preenchido
  const preenchido = s => (s.getAttribute("src") || "").trim() !== "";

  function proximo() {
    const ativos = slides.filter(preenchido);
    if (ativos.length < 2) return;
    let i = atual;
    do { i = (i + 1) % slides.length; } while (!preenchido(slides[i]));
    slides[atual].classList.remove("ativo");
    slides[i].classList.add("ativo");
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
document.addEventListener("keydown", e => { if (e.key === "Escape") fecharPainel(); });
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
  if (btn) abrirDetalhe(Number(btn.dataset.id));
});

// ===== INÍCIO =====
atualizarContador();
renderFiltros();
renderCards();
rotear(); // abre direto nos detalhes se a URL for, por exemplo, index.html#modalidade-1