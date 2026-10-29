// =====================================================================
// ÁREA ADMINISTRATIVA — login, cadastro e painel (CEO e professor)
//
// SENHAS DE CADASTRO: só existem 2. A senha define o perfil da conta:
//   professor -> edita apenas as modalidades que o CEO liberar para ele
//   ceo       -> cria, edita e exclui tudo
// Qualquer outra senha é recusada no cadastro.
//
// ATENÇÃO: este arquivo roda no navegador, então tudo aqui (inclusive as
// senhas e as regras de permissão) pode ser visto e burlado por quem
// abrir o site. Serve para montar e testar as telas. Para proteger de
// verdade, a validação precisa ir para um servidor. Os dados (contas,
// modalidades, solicitações) ficam em js/dados.js, isolados para
// facilitar essa troca.
// =====================================================================
const SENHAS = {
  professor: "profdelprefeiturarf00",
  ceo: "ceodelprefeiturarf00"
};

const NOME_PERFIL = { professor: "Professor", ceo: "CEO" };

const CHAVE_SESSAO = "del_admin_sessao";   // quem está logado (sessionStorage)
const MAX_FOTOS = 3;
const MAX_FOTO_KB = 500;
const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
const POR = { modalidades: 6, solicitacoes: 8, usuarios: 10 };

// ===== UTIL =====
function esc(txt) {
  return String(txt ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function soDigitos(txt) {
  return String(txt || "").replace(/\D/g, "");
}

function mascaraCPF(txt) {
  const d = soDigitos(txt).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;          // 111.111.111-11 etc.
  const digito = tam => {
    let soma = 0;
    for (let i = 0; i < tam; i++) soma += Number(cpf[i]) * (tam + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

const PARTICULAS_NOME = new Set(["de", "da", "do", "das", "dos", "e"]);

// "kauã rodrigues DE sousa" -> "Kauã Rodrigues de Sousa"
function formatarNome(txt) {
  return String(txt || "").trim().replace(/\s+/g, " ").toLowerCase().split(" ")
    .map((p, i) => (i > 0 && PARTICULAS_NOME.has(p)) ? p : p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function nomeValido(nome) {
  if (!nome || nome.length > 100) return false;
  if (!/^\p{L}[\p{L}' .-]*$/u.test(nome)) return false;
  return nome.split(" ").filter(p => p.length >= 2).length >= 2;   // nome e sobrenome
}

function primeiroNome(nome) {
  return String(nome || "").trim().split(" ")[0];
}

const normalizarTexto = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function formatarData(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
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

function mostrarAviso(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("visivel");
  clearTimeout(mostrarAviso.timer);
  mostrarAviso.timer = setTimeout(() => t.classList.remove("visivel"), 4000);
}

// ===== AUTENTICAÇÃO =====
function perfilPelaSenha(senha) {
  return Object.keys(SENHAS).find(p => SENHAS[p] === senha) || null;
}

async function cadastrar(nomeDigitado, cpf, senha) {
  const nome = formatarNome(nomeDigitado);
  if (!nomeValido(nome)) return { ok: false, erro: "Informe o seu nome completo." };
  if (!cpfValido(cpf)) return { ok: false, erro: "CPF inválido. Confira os números." };
  if (!senha) return { ok: false, erro: "Informe a senha." };

  const perfil = perfilPelaSenha(senha);
  if (!perfil) return { ok: false, erro: "Senha não reconhecida." };

  try {
    const criou = await Dados.criarConta({ cpf, perfil, nome });
    if (!criou) return { ok: false, erro: "Este CPF já está cadastrado. Acesse a sua conta." };
    return { ok: true };
  } catch {
    return { ok: false, erro: "Não foi possível salvar o cadastro neste navegador." };
  }
}

async function autenticar(cpf, senha) {
  if (!cpfValido(cpf)) return { ok: false, erro: "CPF inválido. Confira os números." };
  if (!senha) return { ok: false, erro: "Informe a senha." };

  try {
    const conta = await Dados.buscarConta(cpf);
    if (!conta) return { ok: false, semConta: true, erro: "Nenhuma conta encontrada com este CPF." };

    const perfilDigitado = perfilPelaSenha(senha);
    if (!perfilDigitado || conta.perfil !== perfilDigitado) return { ok: false, erro: "Senha incorreta." };
    return { ok: true, conta: resumoDaConta(conta) };
  } catch {
    return { ok: false, erro: "Não foi possível acessar os dados neste navegador." };
  }
}

function resumoDaConta(c) {
  return { cpf: c.cpf, perfil: c.perfil, nome: c.nome || "", modalidadesIds: c.modalidadesIds || [] };
}

// ===== SESSÃO =====
function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO)); }
  catch { return null; }
}
function salvarSessao(conta) {
  try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ cpf: conta.cpf, perfil: conta.perfil })); } catch { /* ignora */ }
}
function limparSessao() {
  try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* ignora */ }
}

// ===== ESTADO DO PAINEL =====
const est = {
  conta: null,
  aba: "modalidades",
  pag: { modalidades: 1, solicitacoes: 1, usuarios: 1 },
  modalidades: [],
  filtros: [],
  solicitacoes: [],
  contas: [],
  turmas: [],
  alunos: [],
  chamadas: []
};

const ehCeo = () => Boolean(est.conta) && est.conta.perfil === "ceo";
const idsDoProfessor = () => (est.conta && est.conta.modalidadesIds) || [];
const podeEditar = m => ehCeo() || idsDoProfessor().includes(m.id);
const modalidadesVisiveis = () => (ehCeo() ? est.modalidades : est.modalidades.filter(m => idsDoProfessor().includes(m.id)));

// ===== ELEMENTOS =====
const telaAcesso = document.getElementById("telaAcesso");
const telaPainel = document.getElementById("telaPainel");
const formLogin = document.getElementById("formLogin");
const formCadastro = document.getElementById("formCadastro");
const msgLogin = document.getElementById("msgLogin");
const msgCadastro = document.getElementById("msgCadastro");

function mostrarMsg(el, texto, tipo) {
  el.textContent = texto || "";
  el.className = "msg" + (texto && tipo ? " " + tipo : "");
}

function marcarErro(form, comErro) {
  form.querySelectorAll(".input-pill").forEach(p => p.classList.toggle("erro", comErro));
}

// ===== TROCA DE TELAS =====
function trocarTela(qual) {
  telaAcesso.hidden = qual !== "acesso";
  telaPainel.hidden = qual !== "painel";
  document.body.classList.toggle("acesso", qual !== "painel");
  window.scrollTo(0, 0);
}

function mostrarAcesso(qual, focar) {
  const jaVisivel = !telaAcesso.hidden && (qual === "login" ? !formLogin.hidden : !formCadastro.hidden);

  trocarTela("acesso");
  formLogin.hidden = qual !== "login";
  formCadastro.hidden = qual !== "cadastro";
  document.querySelector(".cartao").classList.toggle("cadastro", qual === "cadastro");
  document.title = (qual === "login" ? "Login" : "Cadastro") + " — Acesso Administrativo DEL";
  if (jaVisivel) return;   // o evento de troca de hash não deve apagar mensagens que acabaram de aparecer

  mostrarMsg(msgLogin, "");
  mostrarMsg(msgCadastro, "");
  marcarErro(formLogin, false);
  marcarErro(formCadastro, false);
  // no celular não foca sozinho, para o teclado não abrir sem a pessoa tocar no campo
  if (focar && !window.matchMedia("(pointer: coarse)").matches) {
    document.getElementById(qual === "login" ? "loginCpf" : "cadCpf").focus();
  }
}

async function entrarNaArea(conta) {
  est.conta = conta;
  await iniciarPainel(conta);
  if (!conta.nome) pedirNome();   // contas criadas antes do campo de nome
}

async function rotear(focar) {
  const sessao = lerSessao();
  if (sessao) {
    let conta = null;
    try { conta = await Dados.buscarConta(sessao.cpf); } catch { /* segue para o login */ }
    if (conta && conta.perfil === sessao.perfil) {
      await entrarNaArea(resumoDaConta(conta));
      return;
    }
    limparSessao();   // conta excluída ou sessão inválida
  }
  mostrarAcesso(location.hash === "#cadastro" ? "cadastro" : "login", focar);
}

window.addEventListener("hashchange", () => { if (!lerSessao()) rotear(true); });

// ===== MÁSCARA DO CPF + LIMPEZA DE ERROS =====
["loginCpf", "cadCpf"].forEach(id => {
  document.getElementById(id).addEventListener("input", e => {
    e.target.value = mascaraCPF(e.target.value);
  });
});

[formLogin, formCadastro].forEach(form => {
  form.addEventListener("input", () => {
    marcarErro(form, false);
    mostrarMsg(form === formLogin ? msgLogin : msgCadastro, "");
  });
});

// ===== LOGIN =====
formLogin.addEventListener("submit", async e => {
  e.preventDefault();
  const cpf = soDigitos(document.getElementById("loginCpf").value);
  const senha = document.getElementById("loginSenha").value.trim();
  const botao = formLogin.querySelector(".btn");

  botao.disabled = true;
  try {
    const r = await autenticar(cpf, senha);
    if (!r.ok) {
      marcarErro(formLogin, true);
      mostrarMsg(msgLogin, r.erro, "erro");
      if (r.semConta) {
        msgLogin.insertAdjacentHTML("beforeend", ' Se ela foi excluída, <a href="#cadastro">cadastre-se de novo</a>.');
      }
      return;
    }
    salvarSessao(r.conta);
    formLogin.reset();
    await entrarNaArea(r.conta);
  } finally {
    botao.disabled = false;
  }
});

// ===== CADASTRO =====
formCadastro.addEventListener("submit", async e => {
  e.preventDefault();
  const nome = document.getElementById("cadNome").value;
  const cpf = soDigitos(document.getElementById("cadCpf").value);
  const senha = document.getElementById("cadSenha").value.trim();
  const botao = formCadastro.querySelector(".btn");

  botao.disabled = true;
  try {
    const r = await cadastrar(nome, cpf, senha);
    if (!r.ok) {
      marcarErro(formCadastro, true);
      mostrarMsg(msgCadastro, r.erro, "erro");
      return;
    }

    // cadastro feito: volta ao login com o CPF já preenchido
    formCadastro.reset();
    location.hash = "#login";
    mostrarAcesso("login", false);
    document.getElementById("loginCpf").value = mascaraCPF(cpf);
    document.getElementById("loginSenha").focus();
    mostrarMsg(msgLogin, "Conta criada com sucesso! Agora é só entrar.", "ok");
  } finally {
    botao.disabled = false;
  }
});

// ===== LEVA O CPF DIGITADO ENTRE LOGIN E CADASTRO =====
formLogin.addEventListener("click", e => {
  if (!e.target.closest('a[href="#cadastro"]')) return;
  const cpf = document.getElementById("loginCpf").value;
  if (cpf) document.getElementById("cadCpf").value = cpf;
});
formCadastro.addEventListener("click", e => {
  if (!e.target.closest('a[href="#login"]')) return;
  const cpf = document.getElementById("cadCpf").value;
  if (cpf) document.getElementById("loginCpf").value = cpf;
});

// ===== SAIR =====
document.getElementById("btnSairCeo").addEventListener("click", () => {
  limparSessao();
  est.conta = null;
  location.hash = "#login";
  mostrarAcesso("login", false);
});

// =====================================================================
// PAINEL (CEO: tudo | professor: só editar as modalidades liberadas)
// =====================================================================
async function carregarDados() {
  const [m, f, s, c, t, a, h] = await Promise.all([
    Dados.listarModalidades(),
    Dados.listarFiltros(),
    Dados.listarSolicitacoes(),
    Dados.listarContas(),
    Dados.listarTurmas(),
    Dados.listarAlunos(),
    Dados.listarChamadas()
  ]);
  est.modalidades = m;
  est.filtros = f;
  est.solicitacoes = s;
  est.contas = c;
  est.turmas = t;
  est.alunos = a;
  est.chamadas = h;
  atualizarContaAtual();
}

// mantém os dados da conta logada em dia (nome, modalidades liberadas)
function atualizarContaAtual() {
  if (!est.conta) return;
  const atual = est.contas.find(c => c.cpf === est.conta.cpf);
  if (atual) est.conta = resumoDaConta(atual);
}

async function iniciarPainel(conta) {
  est.conta = conta;
  est.aba = "modalidades";
  est.pag = { modalidades: 1, solicitacoes: 1, usuarios: 1 };
  ch.turmaId = "";
  ch.sessaoKey = "";
  ch.data = "";
  ch.presentes = new Set();
  ch.salvoEm = null;
  ch.sujo = false;
  trocarTela("painel");
  document.title = (ehCeo() ? "Painel do CEO" : "Painel do Professor") + " — DEL";
  try {
    await carregarDados();
  } catch {
    mostrarAviso("Não foi possível carregar os dados neste navegador.");
  }
  renderTudo();
}

const ICONE_EDITAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
const ICONE_EXCLUIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>';
const ICONE_LISTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 6 2 2 3-3"></path><path d="m4 15 2 2 3-3"></path><line x1="13" y1="7" x2="21" y2="7"></line><line x1="13" y1="16" x2="21" y2="16"></line></svg>';

function nomeDoFiltro(id) {
  const f = est.filtros.find(x => x.id === id);
  return f ? f.nome : "Sem categoria";
}

// monta uma página da lista e desenha a paginação
function paginar(lista, chave, elNav) {
  const total = Math.max(1, Math.ceil(lista.length / POR[chave]));
  if (est.pag[chave] > total) est.pag[chave] = total;
  const atual = est.pag[chave];

  elNav.dataset.chave = chave;
  if (total <= 1) {
    elNav.innerHTML = "";
  } else {
    let html = `<button data-p="${atual - 1}" aria-label="Página anterior" ${atual === 1 ? "disabled" : ""}>&lt;</button>`;
    listaDePaginas(total, atual).forEach(p => {
      if (p === "…") html += `<span>…</span>`;
      else html += `<button data-p="${p}" class="${p === atual ? "ativo" : ""}" ${p === atual ? 'aria-current="page"' : ""}>${p}</button>`;
    });
    html += `<button data-p="${atual + 1}" aria-label="Próxima página" ${atual === total ? "disabled" : ""}>&gt;</button>`;
    elNav.innerHTML = html;
  }
  return lista.slice((atual - 1) * POR[chave], atual * POR[chave]);
}

function renderSaudacao() {
  const nome = est.conta && est.conta.nome;
  const padrao = ehCeo() ? "CEO" : "Professor";
  document.getElementById("admOla").textContent = `Olá, ${nome ? primeiroNome(nome) : padrao}!`;
}

function renderAbas() {
  const ceo = ehCeo();
  const permitidas = ceo ? ["modalidades", "solicitacoes", "usuarios"] : ["modalidades", "turmas", "chamada"];
  if (!permitidas.includes(est.aba)) est.aba = "modalidades";

  document.getElementById("abasCeo").hidden = !ceo;
  document.getElementById("abasProf").hidden = ceo;
  document.querySelector(".adm-topo-acoes").hidden = !ceo;

  document.querySelectorAll(".adm-aba").forEach(b => {
    const ativa = b.dataset.aba === est.aba;
    b.classList.toggle("ativa", ativa);
    b.setAttribute("aria-selected", ativa);
  });
  document.getElementById("abaModalidades").hidden = est.aba !== "modalidades";
  document.getElementById("abaSolicitacoes").hidden = est.aba !== "solicitacoes";
  document.getElementById("abaUsuarios").hidden = est.aba !== "usuarios";
  document.getElementById("abaTurmas").hidden = est.aba !== "turmas";
  document.getElementById("abaChamada").hidden = est.aba !== "chamada";

  const badge = document.getElementById("badgeSolic");
  badge.hidden = est.solicitacoes.length === 0;
  badge.textContent = est.solicitacoes.length;
}

function renderModalidades() {
  const el = document.getElementById("admCards");
  const ceo = ehCeo();
  const pagina = paginar(modalidadesVisiveis(), "modalidades", document.getElementById("pagModalidades"));

  if (pagina.length === 0) {
    el.innerHTML = ceo
      ? '<p class="vazio">Nenhuma modalidade cadastrada. Clique em “Nova Modalidade” para começar.</p>'
      : '<p class="vazio">Nenhuma modalidade foi liberada para a sua conta ainda. Fale com o CEO.</p>';
    return;
  }
  el.innerHTML = pagina.map(m => `
    <article class="card">
      <h2 class="card-titulo">${esc(m.nome)}</h2>
      <div class="card-corpo">
        <div>Dias: ${esc(m.dias)}</div>
        <div>Categoria: ${esc(nomeDoFiltro(m.cat))}</div>
        <div>Local: ${esc(m.local)}</div>
      </div>
      <div class="adm-card-acoes ${ceo ? "" : "so-um"}">
        <button type="button" class="adm-btn-card" data-acao="editar" data-id="${esc(m.id)}">${ICONE_EDITAR} Editar</button>
        ${ceo ? `<button type="button" class="adm-btn-card" data-acao="excluir-mod" data-id="${esc(m.id)}">${ICONE_EXCLUIR} Excluir</button>` : ""}
      </div>
    </article>
  `).join("");
}

function renderSolicitacoes() {
  const el = document.getElementById("listaSolic");
  const pagina = paginar(est.solicitacoes, "solicitacoes", document.getElementById("pagSolic"));

  if (pagina.length === 0) {
    el.innerHTML = '<p class="adm-vazio">Nenhuma solicitação de vaga no momento.</p>';
    return;
  }
  el.innerHTML = pagina.map(s => `
    <article class="adm-item">
      <div class="adm-item-topo">
        <h3>${esc(s.nome)}</h3>
        <span class="adm-tag">${esc(s.modalidadeNome || "Modalidade")}</span>
      </div>
      <p><strong>Idade:</strong> ${esc(s.idade)} anos</p>
      <p><strong>Telefone:</strong> <a href="tel:+55${esc(soDigitos(s.telefone))}">${esc(s.telefone)}</a></p>
      <p class="adm-texto"><strong>Horários disponíveis:</strong> ${esc(s.disponibilidade)}</p>
      <p class="adm-data">Solicitada em ${esc(formatarData(s.criadoEm))}</p>
      <div class="adm-item-acoes">
        <button type="button" class="adm-btn-card" data-acao="excluir-solic" data-id="${esc(s.id)}">${ICONE_EXCLUIR} Excluir solicitação</button>
      </div>
    </article>
  `).join("");
}

function renderUsuarios() {
  const el = document.getElementById("listaUsuarios");
  const ordenadas = [...est.contas].sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  const pagina = paginar(ordenadas, "usuarios", document.getElementById("pagUsuarios"));

  if (pagina.length === 0) {
    el.innerHTML = '<p class="adm-vazio">Nenhuma conta cadastrada.</p>';
    return;
  }
  el.innerHTML = pagina.map(c => {
    const propria = est.conta && c.cpf === est.conta.cpf;
    const professor = c.perfil === "professor";
    const nomes = (c.modalidadesIds || [])
      .map(id => est.modalidades.find(m => m.id === id))
      .filter(Boolean)
      .map(m => m.nome);

    return `
    <article class="adm-item">
      <div class="adm-item-topo">
        <h3 class="${c.nome ? "" : "adm-sem-nome"}">${esc(c.nome || "Sem nome cadastrado")}</h3>
        <span class="adm-tag">${esc(NOME_PERFIL[c.perfil] || c.perfil)}</span>
      </div>
      <p><strong>CPF:</strong> ${esc(mascaraCPF(c.cpf))}</p>
      ${professor ? `<p><strong>Pode editar:</strong> ${nomes.length ? esc(nomes.join(", ")) : "nenhuma modalidade liberada"}</p>` : ""}
      <p class="adm-data">Cadastrado em ${esc(formatarData(c.criadoEm))}</p>
      <div class="adm-item-acoes">
        ${professor ? `<button type="button" class="adm-btn-card" data-acao="atribuir" data-cpf="${esc(c.cpf)}">${ICONE_LISTA} Modalidades</button>` : ""}
        <button type="button" class="adm-btn-card" data-acao="excluir-conta" data-cpf="${esc(c.cpf)}" ${propria ? "disabled" : ""}>
          ${propria ? "Conta atual" : ICONE_EXCLUIR + " Excluir"}
        </button>
      </div>
    </article>`;
  }).join("");
}

function renderTudo() {
  renderSaudacao();
  renderAbas();
  renderModalidades();
  renderSolicitacoes();
  renderUsuarios();
  renderTurmas();
  renderChamada();
}

// ===== MODAIS (abrir / fechar) =====
const modalForm = document.getElementById("modalModalidade");
const modalFiltros = document.getElementById("modalFiltros");
const modalAtribuir = document.getElementById("modalAtribuir");
const modalConfirmar = document.getElementById("modalConfirmar");
const modalNome = document.getElementById("modalNome");

function abrirModal(el) {
  el.classList.add("aberto");
  el.setAttribute("aria-hidden", "false");
  document.body.classList.add("trava");
}

function fecharModal(el) {
  el.classList.remove("aberto");
  el.setAttribute("aria-hidden", "true");
  if (!document.querySelector(".modal.aberto")) document.body.classList.remove("trava");
}

// ----- confirmação de exclusão -----
let confirmarResolver = null;

function confirmar({ titulo, texto, botao = "Excluir" }) {
  return new Promise(resolve => {
    document.getElementById("confTitulo").textContent = titulo;
    document.getElementById("confTexto").textContent = texto;
    document.getElementById("confSim").textContent = botao;
    confirmarResolver = resolve;
    abrirModal(modalConfirmar);
    document.getElementById("confNao").focus();
  });
}

function responderConfirmar(valor) {
  fecharModal(modalConfirmar);
  if (confirmarResolver) { confirmarResolver(valor); confirmarResolver = null; }
}

document.getElementById("confSim").addEventListener("click", () => responderConfirmar(true));
document.getElementById("confNao").addEventListener("click", () => responderConfirmar(false));
modalConfirmar.addEventListener("click", e => { if (e.target === modalConfirmar) responderConfirmar(false); });

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (modalConfirmar.classList.contains("aberto")) responderConfirmar(false);
  else if (modalNome.classList.contains("aberto")) fecharModal(modalNome);
  else if (modalEncerrar.classList.contains("aberto")) fecharModal(modalEncerrar);
  else if (modalAlunos.classList.contains("aberto")) fecharAlunos();
  else if (modalTurma.classList.contains("aberto")) fecharModal(modalTurma);
  else if (modalAtribuir.classList.contains("aberto")) fecharModal(modalAtribuir);
  else if (modalFiltros.classList.contains("aberto")) fecharFiltros();
  else if (modalForm.classList.contains("aberto")) fecharModal(modalForm);
});

// ===== FORMULÁRIO: NOVA / EDITAR MODALIDADE =====
const formMod = document.getElementById("formModalidade");
const fCat = document.getElementById("fCat");
const fErro = document.getElementById("fErro");
const fArquivos = document.getElementById("fArquivos");
const btnFotos = document.getElementById("btnFotos");
let editandoId = null;
let fotosForm = [];

// a categoria só pode ser escolhida entre os filtros que já existem
function montarSelectCategorias(selecionado) {
  const opcoes = ['<option value="">Selecione…</option>']
    .concat(est.filtros.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`));
  fCat.innerHTML = opcoes.join("");
  fCat.value = selecionado || "";
  document.getElementById("fCatDica").hidden = est.filtros.length > 0;
}

function renderFotosForm() {
  document.getElementById("fFotos").innerHTML = fotosForm.map((src, i) => `
    <div class="foto-mini">
      <img src="${esc(src)}" alt="Foto ${i + 1}">
      <button type="button" data-remover-foto="${i}" aria-label="Remover foto ${i + 1}">×</button>
    </div>`).join("");
  const cheio = fotosForm.length >= MAX_FOTOS;
  btnFotos.disabled = cheio;
  btnFotos.textContent = cheio ? `Limite de ${MAX_FOTOS} fotos atingido` : "+ Adicionar fotos";
}

function abrirFormModalidade(m) {
  editandoId = m ? m.id : null;
  formMod.reset();
  fErro.textContent = "";
  document.getElementById("formTitulo").textContent = m ? "Editar modalidade" : "Nova modalidade";

  document.getElementById("fNome").value = m ? m.nome : "";
  document.getElementById("fDias").value = m ? m.dias : "";
  document.getElementById("fLocal").value = m ? m.local : "";
  document.getElementById("fEndereco").value = m ? m.endereco : "";
  document.getElementById("fProfessor").value = m ? m.professor : "";
  document.getElementById("fDescricao").value = m ? m.descricao : "";
  document.getElementById("fHorarios").value = m ? m.horarios : "";

  agendaForm = m ? (m.agenda || []).map(sl => ({ ...sl })) : [];
  renderAgendaForm();

  montarSelectCategorias(m ? m.cat : "");
  fotosForm = m ? (m.fotos || []).slice(0, MAX_FOTOS) : [];
  renderFotosForm();

  abrirModal(modalForm);
  modalForm.scrollTop = 0;
  setTimeout(() => document.getElementById("fNome").focus(), 50);
}

formMod.addEventListener("input", () => { fErro.textContent = ""; });

// ----- dias e horários das aulas (só professores e CEO; usados na chamada) -----
const fAgenda = document.getElementById("fAgenda");
let agendaForm = [];   // [{ id, dia, inicio, fim }]

function renderAgendaForm() {
  fAgenda.innerHTML = ORDEM_DIAS.map(dia => {
    const slots = agendaForm.filter(sl => sl.dia === dia);
    const ativo = slots.length > 0;
    return `
    <div class="agenda-dia">
      <label class="dia-chip">
        <input type="checkbox" data-agenda-dia="${dia}" ${ativo ? "checked" : ""}>
        <span>${esc(DIAS_EXTENSO[dia])}</span>
      </label>
      ${ativo ? `
      <div class="agenda-horarios">
        ${slots.map(sl => `
        <div class="agenda-linha">
          <input type="time" data-slot="${esc(sl.id)}" data-campo="inicio" value="${esc(sl.inicio)}" aria-label="Início do horário">
          <span>às</span>
          <input type="time" data-slot="${esc(sl.id)}" data-campo="fim" value="${esc(sl.fim)}" aria-label="Fim do horário">
          <button type="button" class="agenda-rem" data-agenda-rem="${esc(sl.id)}" aria-label="Remover horário">×</button>
        </div>`).join("")}
        <button type="button" class="mbtn sec agenda-add" data-agenda-add="${dia}">+ Adicionar horário</button>
      </div>` : ""}
    </div>`;
  }).join("");
}

fAgenda.addEventListener("change", e => {
  const marca = e.target.closest("[data-agenda-dia]");
  if (!marca) return;
  const dia = Number(marca.dataset.agendaDia);
  if (marca.checked) agendaForm.push({ id: novoId("h"), dia, inicio: "", fim: "" });
  else agendaForm = agendaForm.filter(sl => sl.dia !== dia);
  renderAgendaForm();
  fErro.textContent = "";
});

fAgenda.addEventListener("input", e => {
  const campo = e.target.closest("[data-slot]");
  if (!campo) return;
  const sl = agendaForm.find(x => x.id === campo.dataset.slot);
  if (sl) sl[campo.dataset.campo] = campo.value;
});

fAgenda.addEventListener("click", e => {
  const add = e.target.closest("[data-agenda-add]");
  if (add) {
    agendaForm.push({ id: novoId("h"), dia: Number(add.dataset.agendaAdd), inicio: "", fim: "" });
    renderAgendaForm();
    return;
  }
  const rem = e.target.closest("[data-agenda-rem]");
  if (rem) {
    agendaForm = agendaForm.filter(sl => sl.id !== rem.dataset.agendaRem);
    renderAgendaForm();
  }
});

function validarAgenda() {
  for (const dia of ORDEM_DIAS) {
    const slots = agendaForm.filter(sl => sl.dia === dia).sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (const sl of slots) {
      if (!sl.inicio || !sl.fim) return "Preencha o início e o fim de todos os horários das aulas (ou remova os que estiverem vazios).";
      if (sl.fim <= sl.inicio) return `Em ${DIAS_EXTENSO[dia]}, o horário de fim precisa ser depois do início.`;
    }
    for (let i = 1; i < slots.length; i++) {
      if (slots[i].inicio < slots[i - 1].fim) return `Há horários sobrepostos em ${DIAS_EXTENSO[dia]}.`;
    }
  }
  return "";
}

document.getElementById("formFechar").addEventListener("click", () => fecharModal(modalForm));
document.getElementById("formCancelar").addEventListener("click", () => fecharModal(modalForm));

// ----- fotos -----
function lerArquivo(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsDataURL(arquivo);
  });
}

btnFotos.addEventListener("click", () => fArquivos.click());

fArquivos.addEventListener("change", async () => {
  const arquivos = Array.from(fArquivos.files);
  fArquivos.value = "";
  const erros = [];

  for (const arq of arquivos) {
    if (fotosForm.length >= MAX_FOTOS) { erros.push(`O limite é de ${MAX_FOTOS} fotos.`); break; }
    if (!TIPOS_FOTO.includes(arq.type)) { erros.push(`“${arq.name}” não é JPG, PNG ou WebP.`); continue; }
    if (arq.size > MAX_FOTO_KB * 1024) {
      erros.push(`“${arq.name}” tem ${Math.round(arq.size / 1024)} KB (o máximo é ${MAX_FOTO_KB} KB).`);
      continue;
    }
    try { fotosForm.push(await lerArquivo(arq)); }
    catch { erros.push(`Não foi possível ler “${arq.name}”.`); }
  }
  renderFotosForm();
  fErro.textContent = erros.join(" ");
});

document.getElementById("fFotos").addEventListener("click", e => {
  const b = e.target.closest("[data-remover-foto]");
  if (!b) return;
  fotosForm.splice(Number(b.dataset.removerFoto), 1);
  renderFotosForm();
  fErro.textContent = "";
});

// ----- salvar -----
formMod.addEventListener("submit", async e => {
  e.preventDefault();
  const v = id => document.getElementById(id).value.trim();
  const campos = {
    nome: v("fNome"), dias: v("fDias"), local: v("fLocal"), endereco: v("fEndereco"),
    professor: v("fProfessor"), descricao: v("fDescricao"), horarios: v("fHorarios")
  };
  const rotulos = {
    nome: "Nome da modalidade", dias: "Dias", local: "Local", endereco: "Endereço",
    professor: "Nome do professor", descricao: "Descrição", horarios: "Dias e horários"
  };

  if (!est.filtros.length) {
    fErro.textContent = "Ainda não há filtros cadastrados. O CEO precisa criá-los em “Gerenciar Filtros”.";
    return;
  }

  const faltando = Object.keys(rotulos).filter(k => !campos[k]).map(k => rotulos[k]);
  const catId = fCat.value;
  if (!catId) faltando.push("Categoria (filtro)");

  if (faltando.length) {
    fErro.textContent = "Preencha: " + faltando.join(", ") + ".";
    return;
  }

  const erroAgenda = validarAgenda();
  if (erroAgenda) { fErro.textContent = erroAgenda; return; }

  // permissões: professor só edita as modalidades liberadas e não cria nenhuma
  const base = editandoId ? est.modalidades.find(x => x.id === editandoId) : null;
  if (editandoId && (!base || !podeEditar(base))) {
    fErro.textContent = "Você não tem permissão para editar esta modalidade.";
    return;
  }
  if (!editandoId && !ehCeo()) {
    fErro.textContent = "Apenas o CEO pode criar modalidades.";
    return;
  }

  const botao = document.getElementById("formSalvar");
  botao.disabled = true;
  try {
    await Dados.salvarModalidade({
      ...(base || {}), ...campos, cat: catId, fotos: fotosForm.slice(0, MAX_FOTOS),
      agenda: agendaForm.map(({ id, dia, inicio, fim }) => ({ id, dia, inicio, fim }))
    });

    est.modalidades = await Dados.listarModalidades();
    if (!editandoId) est.pag.modalidades = 1;   // a nova aparece na primeira página
    const foiEdicao = Boolean(editandoId);
    fecharModal(modalForm);
    renderTudo();
    mostrarAviso(foiEdicao ? "Modalidade atualizada com sucesso." : "Modalidade criada com sucesso.");
  } catch (erro) {
    const cheio = erro && (erro.name === "QuotaExceededError" || /quota/i.test(erro.message || ""));
    fErro.textContent = cheio
      ? "O navegador ficou sem espaço para salvar. Remova alguma foto ou exclua modalidades antigas."
      : "Não foi possível salvar agora. Tente novamente.";
  } finally {
    botao.disabled = false;
  }
});

// ===== CLIQUES NO PAINEL (abas, botões e paginação) =====
telaPainel.addEventListener("click", async e => {
  // abas (só o CEO as vê)
  const aba = e.target.closest("[data-aba]");
  if (aba) {
    est.aba = aba.dataset.aba;   // renderAbas confere se a aba é permitida para o perfil
    renderAbas();
    return;
  }

  // paginação
  const pag = e.target.closest(".paginacao button");
  if (pag && !pag.disabled) {
    est.pag[pag.parentElement.dataset.chave] = Number(pag.dataset.p);
    renderTudo();
    const topo = ehCeo() ? "#abasCeo" : "#abasProf";
    document.querySelector(topo).scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  // nova modalidade e filtros: só CEO
  if (e.target.closest("#btnNova")) { if (ehCeo()) abrirFormModalidade(null); return; }
  if (e.target.closest("#btnGerFiltros")) { if (ehCeo()) abrirFiltros(); return; }

  // ações dos botões
  const btn = e.target.closest("[data-acao]");
  if (!btn || btn.disabled) return;
  const acao = btn.dataset.acao;

  try {
    if (acao === "editar") {
      const m = est.modalidades.find(x => x.id === btn.dataset.id);
      if (!m) return;
      if (!podeEditar(m)) { mostrarAviso("Você não tem permissão para editar esta modalidade."); return; }
      abrirFormModalidade(m);
      return;
    }

    // turmas e alunos: exclusivos do professor
    if (["nova-turma", "editar-turma", "excluir-turma", "alunos"].includes(acao)) {
      if (!ehCeo()) await acaoTurma(acao, btn);
      return;
    }

    // todas as ações abaixo são exclusivas do CEO
    if (!ehCeo()) return;

    if (acao === "excluir-mod") {
      const m = est.modalidades.find(x => x.id === btn.dataset.id);
      if (!m) return;
      const ok = await confirmar({
        titulo: "Excluir modalidade",
        texto: `Tem certeza que deseja excluir “${m.nome}”? Esta ação não pode ser desfeita.`
      });
      if (!ok) return;
      await Dados.excluirModalidade(m.id);
      [est.modalidades, est.contas] = await Promise.all([Dados.listarModalidades(), Dados.listarContas()]);
      renderTudo();
      mostrarAviso("Modalidade excluída.");

    } else if (acao === "excluir-solic") {
      const s = est.solicitacoes.find(x => x.id === btn.dataset.id);
      if (!s) return;
      const ok = await confirmar({
        titulo: "Excluir solicitação",
        texto: `Exclua somente depois de entrar em contato e resolver. Excluir a solicitação de ${s.nome}?`
      });
      if (!ok) return;
      await Dados.excluirSolicitacao(s.id);
      est.solicitacoes = await Dados.listarSolicitacoes();
      renderTudo();
      mostrarAviso("Solicitação excluída.");

    } else if (acao === "atribuir") {
      abrirAtribuir(btn.dataset.cpf);

    } else if (acao === "excluir-conta") {
      const c = est.contas.find(x => x.cpf === btn.dataset.cpf);
      if (!c) return;
      if (est.conta && c.cpf === est.conta.cpf) {
        mostrarAviso("Você não pode excluir a conta com a qual está logado.");
        return;
      }
      const ok = await confirmar({
        titulo: "Excluir conta",
        texto: `Excluir a conta de ${c.nome || "CPF " + mascaraCPF(c.cpf)} (${NOME_PERFIL[c.perfil] || c.perfil})? Essa pessoa não conseguirá mais entrar, mas poderá se cadastrar de novo quando quiser.`
      });
      if (!ok) return;
      await Dados.excluirConta(c.cpf);
      est.contas = await Dados.listarContas();
      renderTudo();
      if (est.contas.some(x => x.cpf === c.cpf)) {
        mostrarAviso("A conta não foi excluída. Tente novamente.");
      } else {
        mostrarAviso("Conta excluída. Essa pessoa pode se cadastrar novamente.");
      }
    }
  } catch {
    mostrarAviso("Não foi possível concluir a ação. Tente novamente.");
  }
});

// ===== LIBERAR MODALIDADES PARA UM PROFESSOR (só CEO) =====
const atribLista = document.getElementById("atribLista");
const atribBusca = document.getElementById("atribBusca");
const atribErro = document.getElementById("atribErro");
let atribCpf = null;
let atribSel = new Set();

function renderAtribLista() {
  const termo = normalizarTexto(atribBusca.value);
  const lista = est.modalidades.filter(m => !termo || normalizarTexto(m.nome).includes(termo));

  atribLista.innerHTML = lista.length
    ? lista.map(m => `
      <label class="atrib-item">
        <input type="checkbox" value="${esc(m.id)}" ${atribSel.has(m.id) ? "checked" : ""}>
        <span>
          <strong>${esc(m.nome)}</strong>
          <small>${esc(m.dias)} · ${esc(m.local)}</small>
        </span>
      </label>`).join("")
    : '<p class="adm-vazio">Nenhuma modalidade encontrada.</p>';

  document.getElementById("atribContagem").textContent =
    `${atribSel.size} ${atribSel.size === 1 ? "selecionada" : "selecionadas"}`;
}

function abrirAtribuir(cpf) {
  const c = est.contas.find(x => x.cpf === cpf);
  if (!c) return;
  atribCpf = cpf;
  atribSel = new Set((c.modalidadesIds || []).filter(id => est.modalidades.some(m => m.id === id)));
  document.getElementById("atribProfessor").textContent =
    `${c.nome || "Sem nome cadastrado"} — CPF ${mascaraCPF(c.cpf)}`;
  atribBusca.value = "";
  atribErro.textContent = "";
  renderAtribLista();
  abrirModal(modalAtribuir);
}

atribLista.addEventListener("change", e => {
  const caixa = e.target.closest("input[type=checkbox]");
  if (!caixa) return;
  if (caixa.checked) atribSel.add(caixa.value); else atribSel.delete(caixa.value);
  document.getElementById("atribContagem").textContent =
    `${atribSel.size} ${atribSel.size === 1 ? "selecionada" : "selecionadas"}`;
  atribErro.textContent = "";
});

atribBusca.addEventListener("input", renderAtribLista);
document.getElementById("atribFechar").addEventListener("click", () => fecharModal(modalAtribuir));
document.getElementById("atribCancelar").addEventListener("click", () => fecharModal(modalAtribuir));

document.getElementById("atribSalvar").addEventListener("click", async () => {
  if (!ehCeo()) return;
  try {
    await Dados.atualizarConta(atribCpf, { modalidadesIds: [...atribSel] });
    est.contas = await Dados.listarContas();
    atualizarContaAtual();
    fecharModal(modalAtribuir);
    renderUsuarios();
    mostrarAviso("Modalidades do professor atualizadas.");
  } catch {
    atribErro.textContent = "Não foi possível salvar agora. Tente novamente.";
  }
});

// ===== GERENCIAR FILTROS (só CEO: adicionar / editar / excluir) =====
const filtrosErro = document.getElementById("filtrosErro");
const listaFiltrosAdm = document.getElementById("listaFiltrosAdm");
let filtroEditandoId = null;

function renderListaFiltros() {
  if (!est.filtros.length) {
    listaFiltrosAdm.innerHTML = '<li class="adm-vazio">Nenhum filtro criado ainda.</li>';
    return;
  }
  listaFiltrosAdm.innerHTML = est.filtros.map(f => {
    if (f.id === filtroEditandoId) {
      return `
      <li class="filtro-linha">
        <input type="text" class="filtro-edit" id="filtroEditNome" maxlength="40" value="${esc(f.nome)}" aria-label="Novo nome do filtro">
        <div class="filtro-btns">
          <button type="button" class="mbtn" data-facao="salvar" data-id="${esc(f.id)}">Salvar</button>
          <button type="button" class="mbtn sec" data-facao="cancelar">Cancelar</button>
        </div>
      </li>`;
    }
    const qtd = est.modalidades.filter(m => m.cat === f.id).length;
    return `
    <li class="filtro-linha">
      <div class="filtro-info">
        <strong>${esc(f.nome)}</strong>
        <small>${qtd} ${qtd === 1 ? "modalidade" : "modalidades"}</small>
      </div>
      <div class="filtro-btns">
        <button type="button" class="adm-btn-card" data-facao="editar" data-id="${esc(f.id)}">${ICONE_EDITAR} Editar</button>
        <button type="button" class="adm-btn-card" data-facao="excluir" data-id="${esc(f.id)}">${ICONE_EXCLUIR} Excluir</button>
      </div>
    </li>`;
  }).join("");

  if (filtroEditandoId) {
    const campo = document.getElementById("filtroEditNome");
    if (campo) { campo.focus(); campo.select(); }
  }
}

function abrirFiltros() {
  filtroEditandoId = null;
  filtrosErro.textContent = "";
  document.getElementById("novoFiltroNome").value = "";
  renderListaFiltros();
  abrirModal(modalFiltros);
}

function fecharFiltros() {
  filtroEditandoId = null;
  fecharModal(modalFiltros);
}

async function recarregarFiltrosEModalidades() {
  [est.filtros, est.modalidades] = await Promise.all([Dados.listarFiltros(), Dados.listarModalidades()]);
  renderListaFiltros();
  renderTudo();
}

async function salvarFiltroEditado(id) {
  const nome = document.getElementById("filtroEditNome").value.trim();
  if (!nome) { filtrosErro.textContent = "Informe o nome do filtro."; return; }
  try {
    const r = await Dados.renomearFiltro(id, nome);
    if (!r.ok) { filtrosErro.textContent = r.erro; return; }
    filtroEditandoId = null;
    filtrosErro.textContent = "";
    await recarregarFiltrosEModalidades();
    mostrarAviso("Filtro atualizado.");
  } catch {
    filtrosErro.textContent = "Não foi possível salvar agora. Tente novamente.";
  }
}

document.getElementById("formNovoFiltro").addEventListener("submit", async e => {
  e.preventDefault();
  const campo = document.getElementById("novoFiltroNome");
  const nome = campo.value.trim();
  if (!nome) { filtrosErro.textContent = "Informe o nome do filtro."; return; }
  if (est.filtros.some(f => normalizarTexto(f.nome) === normalizarTexto(nome))) {
    filtrosErro.textContent = "Já existe um filtro com esse nome.";
    return;
  }
  try {
    await Dados.criarFiltro(nome);
    campo.value = "";
    filtrosErro.textContent = "";
    await recarregarFiltrosEModalidades();
    mostrarAviso("Filtro criado.");
  } catch {
    filtrosErro.textContent = "Não foi possível criar agora. Tente novamente.";
  }
});

document.getElementById("novoFiltroNome").addEventListener("input", () => { filtrosErro.textContent = ""; });

listaFiltrosAdm.addEventListener("click", async e => {
  const b = e.target.closest("[data-facao]");
  if (!b) return;
  const id = b.dataset.id;
  const acao = b.dataset.facao;
  filtrosErro.textContent = "";

  if (acao === "editar") {
    filtroEditandoId = id;
    renderListaFiltros();
  } else if (acao === "cancelar") {
    filtroEditandoId = null;
    renderListaFiltros();
  } else if (acao === "salvar") {
    await salvarFiltroEditado(id);
  } else if (acao === "excluir") {
    const f = est.filtros.find(x => x.id === id);
    if (!f) return;
    const qtd = est.modalidades.filter(m => m.cat === id).length;
    const aviso = qtd
      ? ` ${qtd} ${qtd === 1 ? "modalidade ficará" : "modalidades ficarão"} sem categoria até você escolher outra.`
      : "";
    const ok = await confirmar({ titulo: "Excluir filtro", texto: `Excluir o filtro “${f.nome}”?${aviso}` });
    if (!ok) return;
    try {
      await Dados.excluirFiltro(id);
      await recarregarFiltrosEModalidades();
      mostrarAviso("Filtro excluído.");
    } catch {
      filtrosErro.textContent = "Não foi possível excluir agora. Tente novamente.";
    }
  }
});

listaFiltrosAdm.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "filtroEditNome") {
    e.preventDefault();
    salvarFiltroEditado(filtroEditandoId);
  }
});

document.getElementById("filtrosFechar").addEventListener("click", fecharFiltros);
document.getElementById("filtrosOk").addEventListener("click", fecharFiltros);

// ===== COMPLETAR O NOME (contas criadas antes do campo de nome) =====
const formNome = document.getElementById("formNome");
const nomeErro = document.getElementById("nomeErro");

function pedirNome() {
  formNome.reset();
  nomeErro.textContent = "";
  abrirModal(modalNome);
  setTimeout(() => document.getElementById("nomeCompleto").focus(), 50);
}

formNome.addEventListener("input", () => { nomeErro.textContent = ""; });
document.getElementById("nomeDepois").addEventListener("click", () => fecharModal(modalNome));

formNome.addEventListener("submit", async e => {
  e.preventDefault();
  const nome = formatarNome(document.getElementById("nomeCompleto").value);
  if (!nomeValido(nome)) { nomeErro.textContent = "Informe o seu nome completo."; return; }
  try {
    await Dados.atualizarConta(est.conta.cpf, { nome });
    est.contas = await Dados.listarContas();
    atualizarContaAtual();
    fecharModal(modalNome);
    if (!telaPainel.hidden) renderTudo();
    mostrarAviso("Nome salvo.");
  } catch {
    nomeErro.textContent = "Não foi possível salvar agora. Tente novamente.";
  }
});

// =====================================================================
// PROFESSOR: TURMAS, ALUNOS, CHAMADA E FOLHA DO MÊS
//
// - A MODALIDADE define os dias e horários das aulas (campo "agenda", que só
//   professores e CEO enxergam). Pode haver mais de um horário no mesmo dia.
// - A TURMA escolhe em quais desses horários ela tem aula e guarda os alunos.
// - A CHAMADA é feita aula por aula, dentro do mês da modalidade
//   (ex.: "Janeiro - 2026").
// - No fim do mês o professor gera a folha (PDF / impressão) e então as
//   chamadas são apagadas e a modalidade passa para o mês seguinte.
// =====================================================================
const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_EXTENSO = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];   // semana começando na segunda
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const novoId = prefixo => prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const horaBonita = h => String(h || "").replace(":", "h");

function dataISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dataBR(iso) {
  const [a, m, d] = String(iso).split("-");
  return `${d}/${m}/${a}`;
}

// ----- mês de trabalho da modalidade -----
const rotuloPeriodo = p => { const [a, m] = p.split("-"); return `${MESES[Number(m) - 1]} - ${a}`; };
function periodoDaModalidade(m) {
  return (m && m.periodo) || dataISO().slice(0, 7);   // sem mês salvo: o mês atual
}

// ----- acesso -----
const modalidadePorId = id => est.modalidades.find(m => m.id === id);
const nomeDaModalidade = id => { const m = modalidadePorId(id); return m ? m.nome : "Modalidade"; };
const idsMinhasModalidades = () => modalidadesVisiveis().map(m => m.id);
const turmaPermitida = t => Boolean(t) && idsMinhasModalidades().includes(t.modalidadeId);
const alunosDaTurma = id => est.alunos.filter(a => a.turmaId === id).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
const nomeAlunoValido = n => n.length >= 2 && n.length <= 80 && /^\p{L}[\p{L}' .-]*$/u.test(n);

function turmasOrdenadas() {
  const ids = idsMinhasModalidades();
  return est.turmas
    .filter(t => ids.includes(t.modalidadeId))
    .sort((a, b) =>
      nomeDaModalidade(a.modalidadeId).localeCompare(nomeDaModalidade(b.modalidadeId), "pt-BR") ||
      a.nome.localeCompare(b.nome, "pt-BR"));
}

// ----- horários (agenda da modalidade) e aulas do mês -----
function slotsOrdenados(m) {
  const lista = m && Array.isArray(m.agenda) ? m.agenda : [];
  return [...lista].sort((a, b) => ORDEM_DIAS.indexOf(a.dia) - ORDEM_DIAS.indexOf(b.dia) || a.inicio.localeCompare(b.inicio));
}
const rotuloSlotCurto = sl => `${DIAS_CURTOS[sl.dia]} ${horaBonita(sl.inicio)}–${horaBonita(sl.fim)}`;

function slotsDaTurma(t) {
  const ids = t.slotIds || [];
  return slotsOrdenados(modalidadePorId(t.modalidadeId)).filter(sl => ids.includes(sl.id));
}

// todas as aulas da turma dentro do mês da modalidade
function sessoesDaTurma(t) {
  const [ano, mes] = periodoDaModalidade(modalidadePorId(t.modalidadeId)).split("-").map(Number);
  const slots = slotsDaTurma(t);
  const saida = [];
  for (let d = 1; d <= new Date(ano, mes, 0).getDate(); d++) {
    const dow = new Date(ano, mes - 1, d).getDay();
    slots.filter(sl => sl.dia === dow).forEach(sl => saida.push({
      slotId: sl.id, dia: dow, inicio: sl.inicio, fim: sl.fim,
      data: `${ano}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    }));
  }
  return saida.sort((a, b) => a.data.localeCompare(b.data) || a.inicio.localeCompare(b.inicio));
}
const chaveSessao = sess => `${sess.slotId}|${sess.data}`;
const chamadaDaSessao = (turmaId, sess) =>
  est.chamadas.find(c => c.turmaId === turmaId && c.slotId === sess.slotId && c.data === sess.data);

// ----- aba Turmas -----
function htmlTurma(t) {
  const n = alunosDaTurma(t.id).length;
  const slots = slotsDaTurma(t);
  return `
    <article class="adm-item">
      <div class="adm-item-topo">
        <h3>${esc(t.nome)}</h3>
        <span class="adm-tag">${n} ${n === 1 ? "aluno" : "alunos"}</span>
      </div>
      <p><strong>Aulas:</strong> ${slots.length ? esc(slots.map(rotuloSlotCurto).join(" · ")) : "nenhum horário definido — edite a turma"}</p>
      <div class="adm-item-acoes">
        <button type="button" class="adm-btn-card" data-acao="alunos" data-id="${esc(t.id)}">${ICONE_LISTA} Alunos</button>
        <button type="button" class="adm-btn-card" data-acao="editar-turma" data-id="${esc(t.id)}">${ICONE_EDITAR} Editar</button>
        <button type="button" class="adm-btn-card" data-acao="excluir-turma" data-id="${esc(t.id)}">${ICONE_EXCLUIR} Excluir</button>
      </div>
    </article>`;
}

function renderTurmas() {
  const el = document.getElementById("listaTurmas");
  if (ehCeo()) { el.innerHTML = ""; return; }

  const mods = modalidadesVisiveis();
  if (!mods.length) {
    el.innerHTML = '<p class="adm-vazio">Nenhuma modalidade foi liberada para a sua conta ainda. Fale com o CEO.</p>';
    return;
  }
  el.innerHTML = mods.map(m => {
    const turmas = est.turmas
      .filter(t => t.modalidadeId === m.id)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    return `
    <div class="adm-grupo">
      <div class="adm-grupo-topo">
        <h3 class="adm-grupo-titulo">${esc(m.nome)}</h3>
        <button type="button" class="adm-btn-card" data-acao="nova-turma" data-mid="${esc(m.id)}">+ Nova turma</button>
      </div>
      ${turmas.length
        ? `<div class="adm-lista">${turmas.map(htmlTurma).join("")}</div>`
        : '<p class="adm-vazio">Nenhuma turma cadastrada nesta modalidade.</p>'}
    </div>`;
  }).join("");
}

// ----- formulário da turma -----
const modalTurma = document.getElementById("modalTurma");
const formTurma = document.getElementById("formTurma");
const tErro = document.getElementById("tErro");
let turmaForm = { id: null, modalidadeId: null };

function abrirFormTurma(modalidadeId, turma) {
  turmaForm = { id: turma ? turma.id : null, modalidadeId };
  formTurma.reset();
  tErro.textContent = "";
  document.getElementById("turmaTitulo").textContent = turma ? "Editar turma" : "Nova turma";
  document.getElementById("turmaModalidade").textContent = nomeDaModalidade(modalidadeId);
  document.getElementById("tNome").value = turma ? turma.nome : "";

  const slots = slotsOrdenados(modalidadePorId(modalidadeId));
  const marcados = turma ? turma.slotIds || [] : [];
  document.getElementById("tSlots").innerHTML = slots.map(sl => `
    <label class="atrib-item">
      <input type="checkbox" value="${esc(sl.id)}" ${marcados.includes(sl.id) ? "checked" : ""}>
      <span><strong>${esc(DIAS_EXTENSO[sl.dia])}</strong><small>${esc(horaBonita(sl.inicio))} às ${esc(horaBonita(sl.fim))}</small></span>
    </label>`).join("");
  document.getElementById("tSlotsDica").textContent = slots.length
    ? "Marque os horários em que esta turma tem aula."
    : "Esta modalidade ainda não tem dias e horários das aulas. Cadastre-os em Modalidades → Editar → “Dias e horários das aulas”.";

  abrirModal(modalTurma);
  setTimeout(() => document.getElementById("tNome").focus(), 50);
}

formTurma.addEventListener("input", () => { tErro.textContent = ""; });
document.getElementById("turmaFechar").addEventListener("click", () => fecharModal(modalTurma));
document.getElementById("turmaCancelar").addEventListener("click", () => fecharModal(modalTurma));

formTurma.addEventListener("submit", async e => {
  e.preventDefault();
  const nome = document.getElementById("tNome").value.trim().replace(/\s+/g, " ");
  const slotIds = [...document.querySelectorAll("#tSlots input:checked")].map(i => i.value);

  let erro = "";
  if (!nome) erro = "Informe o nome da turma.";
  else if (!slotIds.length) erro = "Marque pelo menos um horário de aula para a turma.";
  else if (!idsMinhasModalidades().includes(turmaForm.modalidadeId)) erro = "Você não tem permissão para esta modalidade.";
  if (erro) { tErro.textContent = erro; return; }

  const botao = document.getElementById("turmaSalvar");
  botao.disabled = true;
  try {
    const { dias, inicio, fim, ...base } = turmaForm.id ? est.turmas.find(t => t.id === turmaForm.id) || {} : {};
    await Dados.salvarTurma({ ...base, modalidadeId: turmaForm.modalidadeId, nome, slotIds });
    est.turmas = await Dados.listarTurmas();
    const foiEdicao = Boolean(turmaForm.id);
    fecharModal(modalTurma);
    renderTurmas();
    renderChamada();
    mostrarAviso(foiEdicao ? "Turma atualizada." : "Turma criada.");
  } catch {
    tErro.textContent = "Não foi possível salvar agora. Tente novamente.";
  } finally {
    botao.disabled = false;
  }
});

async function acaoTurma(acao, btn) {
  if (acao === "nova-turma") {
    if (!idsMinhasModalidades().includes(btn.dataset.mid)) return;
    abrirFormTurma(btn.dataset.mid, null);
    return;
  }

  const turma = est.turmas.find(t => t.id === btn.dataset.id);
  if (!turmaPermitida(turma)) { mostrarAviso("Você não tem permissão para esta turma."); return; }

  if (acao === "editar-turma") {
    abrirFormTurma(turma.modalidadeId, turma);
  } else if (acao === "alunos") {
    abrirAlunos(turma);
  } else if (acao === "excluir-turma") {
    const ok = await confirmar({
      titulo: "Excluir turma",
      texto: `Excluir a turma “${turma.nome}”? Os alunos e as chamadas dela também serão apagados.`
    });
    if (!ok) return;
    await Dados.excluirTurma(turma.id);
    [est.turmas, est.alunos, est.chamadas] = await Promise.all([Dados.listarTurmas(), Dados.listarAlunos(), Dados.listarChamadas()]);
    renderTurmas();
    renderChamada();
    mostrarAviso("Turma excluída.");
  }
}

// ----- alunos da turma -----
const modalAlunos = document.getElementById("modalAlunos");
const formAluno = document.getElementById("formAluno");
const alunosErro = document.getElementById("alunosErro");
const listaAlunos = document.getElementById("listaAlunos");
let alunosTurmaId = null;
let alunoEditandoId = null;

function renderAlunos() {
  const alunos = alunosDaTurma(alunosTurmaId);
  document.getElementById("alunosContagem").textContent =
    `${alunos.length} ${alunos.length === 1 ? "aluno" : "alunos"} na turma.`;

  if (!alunos.length) {
    listaAlunos.innerHTML = '<li class="adm-vazio">Nenhum aluno cadastrado nesta turma.</li>';
    return;
  }
  listaAlunos.innerHTML = alunos.map(a => {
    if (a.id === alunoEditandoId) {
      return `
      <li class="filtro-linha">
        <input type="text" class="filtro-edit" id="alunoEditNome" maxlength="80" value="${esc(a.nome)}" aria-label="Novo nome do aluno">
        <div class="filtro-btns">
          <button type="button" class="mbtn" data-aacao="salvar" data-id="${esc(a.id)}">Salvar</button>
          <button type="button" class="mbtn sec" data-aacao="cancelar">Cancelar</button>
        </div>
      </li>`;
    }
    return `
    <li class="filtro-linha">
      <div class="filtro-info"><strong>${esc(a.nome)}</strong></div>
      <div class="filtro-btns">
        <button type="button" class="adm-btn-card" data-aacao="editar" data-id="${esc(a.id)}">${ICONE_EDITAR} Editar</button>
        <button type="button" class="adm-btn-card" data-aacao="excluir" data-id="${esc(a.id)}">${ICONE_EXCLUIR} Excluir</button>
      </div>
    </li>`;
  }).join("");

  if (alunoEditandoId) {
    const campo = document.getElementById("alunoEditNome");
    if (campo) { campo.focus(); campo.select(); }
  }
}

function abrirAlunos(turma) {
  alunosTurmaId = turma.id;
  alunoEditandoId = null;
  alunosErro.textContent = "";
  formAluno.reset();
  document.getElementById("alunosSub").textContent = `${nomeDaModalidade(turma.modalidadeId)} — ${turma.nome}`;
  renderAlunos();
  abrirModal(modalAlunos);
  setTimeout(() => document.getElementById("alunoNome").focus(), 50);
}

function fecharAlunos() {
  alunoEditandoId = null;
  fecharModal(modalAlunos);
}

async function recarregarAlunos() {
  est.alunos = await Dados.listarAlunos();
  renderAlunos();
  renderTurmas();
  renderChamada();
}

// confere nome e duplicidade; devolve o nome formatado ou null (e mostra o erro)
function validarNomeAluno(texto, idIgnorado) {
  const nome = formatarNome(texto);
  if (!nomeAlunoValido(nome)) { alunosErro.textContent = "Informe o nome do aluno."; return null; }
  const repetido = alunosDaTurma(alunosTurmaId)
    .some(a => a.id !== idIgnorado && normalizarTexto(a.nome) === normalizarTexto(nome));
  if (repetido) { alunosErro.textContent = "Já existe um aluno com esse nome nesta turma."; return null; }
  return nome;
}

formAluno.addEventListener("input", () => { alunosErro.textContent = ""; });

formAluno.addEventListener("submit", async e => {
  e.preventDefault();
  const turma = est.turmas.find(t => t.id === alunosTurmaId);
  if (!turmaPermitida(turma)) { alunosErro.textContent = "Você não tem permissão para esta turma."; return; }

  const campo = document.getElementById("alunoNome");
  const nome = validarNomeAluno(campo.value, null);
  if (!nome) return;
  try {
    await Dados.salvarAluno({ turmaId: turma.id, nome });
    campo.value = "";
    alunosErro.textContent = "";
    await recarregarAlunos();
    campo.focus();
  } catch {
    alunosErro.textContent = "Não foi possível salvar agora. Tente novamente.";
  }
});

async function salvarAlunoEditado(id) {
  const aluno = est.alunos.find(a => a.id === id);
  const turma = aluno && est.turmas.find(t => t.id === aluno.turmaId);
  if (!turmaPermitida(turma)) return;
  const nome = validarNomeAluno(document.getElementById("alunoEditNome").value, id);
  if (!nome) return;
  try {
    await Dados.salvarAluno({ ...aluno, nome });
    alunoEditandoId = null;
    alunosErro.textContent = "";
    await recarregarAlunos();
  } catch {
    alunosErro.textContent = "Não foi possível salvar agora. Tente novamente.";
  }
}

listaAlunos.addEventListener("click", async e => {
  const b = e.target.closest("[data-aacao]");
  if (!b) return;
  const id = b.dataset.id;
  alunosErro.textContent = "";

  if (b.dataset.aacao === "editar") {
    alunoEditandoId = id;
    renderAlunos();
  } else if (b.dataset.aacao === "cancelar") {
    alunoEditandoId = null;
    renderAlunos();
  } else if (b.dataset.aacao === "salvar") {
    await salvarAlunoEditado(id);
  } else if (b.dataset.aacao === "excluir") {
    const aluno = est.alunos.find(a => a.id === id);
    const turma = aluno && est.turmas.find(t => t.id === aluno.turmaId);
    if (!aluno || !turmaPermitida(turma)) return;
    const ok = await confirmar({
      titulo: "Excluir aluno",
      texto: `Excluir “${aluno.nome}” da turma? Ele deixa de aparecer na lista e na folha do mês.`
    });
    if (!ok) return;
    try {
      await Dados.excluirAluno(id);
      await recarregarAlunos();
    } catch {
      alunosErro.textContent = "Não foi possível excluir agora. Tente novamente.";
    }
  }
});

listaAlunos.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "alunoEditNome") {
    e.preventDefault();
    salvarAlunoEditado(alunoEditandoId);
  }
});

document.getElementById("alunosFechar").addEventListener("click", fecharAlunos);
document.getElementById("alunosOk").addEventListener("click", fecharAlunos);

// ----- tabela da folha (usada na tela e na impressão) -----
function htmlTabelaFolha(turma, sessoes, alunos) {
  const ids = new Set(alunos.map(a => a.id));
  const cab = sessoes.map(sess => {
    const [, mes, dia] = sess.data.split("-");
    return `<th><span>${dia}/${mes}</span><small>${DIAS_CURTOS[sess.dia]}<br>${esc(horaBonita(sess.inicio))}</small></th>`;
  }).join("");

  const linhas = alunos.map((a, i) => {
    let total = 0;
    const celulas = sessoes.map(sess => {
      const c = chamadaDaSessao(turma.id, sess);
      if (!c) return "<td></td>";
      const presente = c.presentes.includes(a.id);
      if (presente) total++;
      return `<td class="${presente ? "p" : "f"}">${presente ? "P" : "F"}</td>`;
    }).join("");
    return `<tr><td class="n">${i + 1}</td><td class="nome">${esc(a.nome)}</td>${celulas}<td class="tot">${total}</td></tr>`;
  }).join("");

  let totalGeral = 0;
  const rodape = sessoes.map(sess => {
    const c = chamadaDaSessao(turma.id, sess);
    if (!c) return "<td></td>";
    const n = c.presentes.filter(id => ids.has(id)).length;
    totalGeral += n;
    return `<td>${n}</td>`;
  }).join("");

  return `
    <table class="folha-tabela">
      <thead><tr><th class="n">Nº</th><th class="nome">Aluno</th>${cab}<th>Presenças</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><td></td><td class="nome">Presentes na aula</td>${rodape}<td>${totalGeral}</td></tr></tfoot>
    </table>`;
}

// ----- aba Chamada -----
const ch = { turmaId: "", sessaoKey: "", data: "", presentes: new Set(), salvoEm: null, sujo: false };

const turmaAtual = () => est.turmas.find(t => t.id === ch.turmaId);
const sessoesAtuais = () => { const t = turmaAtual(); return t ? sessoesDaTurma(t) : []; };

function carregarEstadoChamada() {
  const t = turmaAtual();
  const sess = sessoesAtuais().find(x => chaveSessao(x) === ch.sessaoKey);
  const c = t && sess ? chamadaDaSessao(t.id, sess) : null;
  ch.data = sess ? sess.data : "";
  ch.presentes = new Set(c ? c.presentes : []);
  ch.salvoEm = c ? c.atualizadoEm : null;
  ch.sujo = false;
}

function escolherSessaoPadrao(sessoes) {
  const hoje = dataISO();
  return sessoes.find(x => x.data === hoje)
    || [...sessoes].reverse().find(x => x.data < hoje)
    || sessoes[0];
}

function garantirSelecaoChamada() {
  const turmas = turmasOrdenadas();
  if (!turmas.some(t => t.id === ch.turmaId)) {
    ch.turmaId = turmas.length ? turmas[0].id : "";
    ch.sessaoKey = "";
  }
  const sessoes = sessoesAtuais();
  if (!sessoes.some(x => chaveSessao(x) === ch.sessaoKey)) {
    ch.sessaoKey = sessoes.length ? chaveSessao(escolherSessaoPadrao(sessoes)) : "";
    carregarEstadoChamada();
  }
}

function atualizarContadorChamada() {
  const ids = new Set(alunosDaTurma(ch.turmaId).map(a => a.id));
  const n = [...ch.presentes].filter(id => ids.has(id)).length;
  const el = document.getElementById("chContador");
  if (el) el.textContent = `Presentes: ${n} de ${ids.size}`;
}

function renderChamada() {
  if (ehCeo()) return;
  garantirSelecaoChamada();

  const turmas = turmasOrdenadas();
  const sel = document.getElementById("chTurma");
  const caixaPeriodo = document.getElementById("chPeriodoBox");
  const elSessoes = document.getElementById("chSessoes");
  const corpo = document.getElementById("chCorpo");
  const resumo = document.getElementById("chResumo");
  const folha = document.getElementById("chFolha");

  if (!turmas.length) {
    sel.innerHTML = '<option value="">Nenhuma turma cadastrada</option>';
    sel.disabled = true;
    caixaPeriodo.innerHTML = "";
    elSessoes.innerHTML = "";
    corpo.innerHTML = '<p class="adm-vazio">Cadastre uma turma na aba “Turmas” para fazer a chamada.</p>';
    resumo.innerHTML = "";
    folha.innerHTML = "";
    return;
  }

  sel.disabled = false;
  sel.innerHTML = turmas.map(t =>
    `<option value="${esc(t.id)}">${esc(nomeDaModalidade(t.modalidadeId))} — ${esc(t.nome)}</option>`).join("");
  sel.value = ch.turmaId;

  const turma = turmaAtual();
  const modalidade = modalidadePorId(turma.modalidadeId);
  const periodo = periodoDaModalidade(modalidade);
  const sessoes = sessoesDaTurma(turma);
  const alunos = alunosDaTurma(turma.id);
  const hoje = dataISO();

  // mês de trabalho + botão de encerrar
  caixaPeriodo.innerHTML = `
    <div class="ch-periodo">
      <div>
        <small>Mês de ${esc(modalidade.nome)}</small>
        <strong>${esc(rotuloPeriodo(periodo))}</strong>
      </div>
      <button type="button" class="mbtn" data-ch="encerrar">Encerrar mês</button>
    </div>`;

  // aulas do mês
  if (!sessoes.length) {
    elSessoes.innerHTML = `<p class="adm-vazio">Esta turma não tem aulas em ${esc(rotuloPeriodo(periodo))}. Confira os horários da turma na aba “Turmas” e os dias e horários das aulas da modalidade.</p>`;
  } else {
    elSessoes.innerHTML = `
      <div class="ch-sessoes" role="group" aria-label="Aulas do mês">
        ${sessoes.map(sess => {
          const [, mes, dia] = sess.data.split("-");
          const classes = ["ch-sessao"];
          if (chamadaDaSessao(turma.id, sess)) classes.push("salva");
          if (chaveSessao(sess) === ch.sessaoKey) classes.push("ativa");
          if (sess.data === hoje) classes.push("hoje");
          return `<button type="button" class="${classes.join(" ")}" data-sessao="${esc(chaveSessao(sess))}">
            <strong>${DIAS_CURTOS[sess.dia]} ${dia}/${mes}</strong><small>${esc(horaBonita(sess.inicio))}</small>
          </button>`;
        }).join("")}
      </div>`;
  }

  // chamada da aula escolhida
  const sessao = sessoes.find(x => chaveSessao(x) === ch.sessaoKey);
  if (!sessao) {
    corpo.innerHTML = "";
  } else if (!alunos.length) {
    corpo.innerHTML = '<p class="adm-vazio">Esta turma ainda não tem alunos. Cadastre-os na aba “Turmas”, no botão “Alunos”.</p>';
  } else {
    corpo.innerHTML = `
      <div class="ch-painel">
        <p class="ch-titulo-aula">${esc(DIAS_EXTENSO[sessao.dia])}, ${esc(dataBR(sessao.data))} · ${esc(horaBonita(sessao.inicio))} às ${esc(horaBonita(sessao.fim))}</p>
        <div class="ch-topo">
          <div class="ch-contador" id="chContador"></div>
          <div class="ch-botoes">
            <button type="button" class="mbtn sec" data-ch="todos">Marcar todos</button>
            <button type="button" class="mbtn sec" data-ch="nenhum">Limpar</button>
          </div>
        </div>
        <div class="ch-lista">
          ${alunos.map(a => `
            <label class="ch-aluno ${ch.presentes.has(a.id) ? "presente" : ""}">
              <input type="checkbox" data-aluno="${esc(a.id)}" ${ch.presentes.has(a.id) ? "checked" : ""}>
              <span>${esc(a.nome)}</span>
            </label>`).join("")}
        </div>
        <p class="mdica">${ch.salvoEm ? "Chamada salva em " + esc(formatarData(ch.salvoEm)) + "." : "Esta chamada ainda não foi salva."}</p>
        <button type="button" class="mbtn ch-salvar" data-ch="salvar">Salvar chamada</button>
      </div>`;
    atualizarContadorChamada();
  }

  // resumo do dia (todas as turmas do professor)
  if (sessao) {
    const idsTurmas = new Set(turmas.map(t => t.id));
    const doDia = est.chamadas.filter(c => c.data === sessao.data && idsTurmas.has(c.turmaId));
    const totalDia = doDia.reduce((soma, c) => soma + c.presentes.length, 0);
    resumo.innerHTML = `
      <div class="ch-bloco">
        <h3>Resumo do dia ${esc(dataBR(sessao.data))}</h3>
        ${doDia.length ? `
          <p class="ch-total">${totalDia} ${totalDia === 1 ? "aluno presente" : "alunos presentes"} no dia</p>
          ${doDia.map(c => {
            const t = est.turmas.find(x => x.id === c.turmaId);
            const sl = t && slotsOrdenados(modalidadePorId(t.modalidadeId)).find(x => x.id === c.slotId);
            return `<div class="ch-linha"><span>${esc(t ? nomeDaModalidade(t.modalidadeId) + " — " + t.nome : "Turma")}${sl ? " (" + esc(horaBonita(sl.inicio)) + ")" : ""}</span><strong>${c.presentes.length} de ${c.total}</strong></div>`;
          }).join("")}`
          : '<p class="adm-vazio">Nenhuma chamada salva neste dia.</p>'}
      </div>`;
  } else {
    resumo.innerHTML = "";
  }

  // folha do mês (visão geral)
  folha.innerHTML = sessoes.length && alunos.length ? `
    <div class="ch-bloco">
      <h3>Folha de ${esc(rotuloPeriodo(periodo))}</h3>
      <div class="ch-tabela-wrap">${htmlTabelaFolha(turma, sessoes, alunos)}</div>
    </div>` : "";
}

async function salvarChamadaAtual() {
  const turma = turmaAtual();
  const sessao = sessoesAtuais().find(x => chaveSessao(x) === ch.sessaoKey);
  if (!turmaPermitida(turma) || !sessao) { mostrarAviso("Você não tem permissão para esta turma."); return; }

  const alunos = alunosDaTurma(turma.id);
  const ids = new Set(alunos.map(a => a.id));
  const presentes = [...ch.presentes].filter(id => ids.has(id));
  try {
    const salva = await Dados.salvarChamada({
      turmaId: turma.id, slotId: sessao.slotId, data: sessao.data, presentes, total: alunos.length
    });

    // fixa o mês de trabalho da modalidade na primeira chamada, para ele não "andar" sozinho
    const modalidade = modalidadePorId(turma.modalidadeId);
    if (modalidade && !modalidade.periodo) {
      await Dados.salvarModalidade({ ...modalidade, periodo: periodoDaModalidade(modalidade) });
      est.modalidades = await Dados.listarModalidades();
    }

    est.chamadas = await Dados.listarChamadas();
    ch.presentes = new Set(presentes);
    ch.salvoEm = salva.atualizadoEm;
    ch.sujo = false;
    renderChamada();
    mostrarAviso(`Chamada salva: ${presentes.length} de ${alunos.length} presentes.`);
  } catch {
    mostrarAviso("Não foi possível salvar a chamada. Tente novamente.");
  }
}

// ao trocar de turma ou de aula com marcações não salvas, pergunta antes de descartar
async function podeTrocarSelecao() {
  if (!ch.sujo) return true;
  return confirmar({
    titulo: "Marcações não salvas",
    texto: "Se trocar de aula, as marcações que você ainda não salvou serão descartadas.",
    botao: "Descartar"
  });
}

document.getElementById("chTurma").addEventListener("change", async e => {
  const nova = e.target.value;
  if (!(await podeTrocarSelecao())) { e.target.value = ch.turmaId; return; }
  ch.turmaId = nova;
  ch.sessaoKey = "";
  garantirSelecaoChamada();
  renderChamada();
});

document.getElementById("chCorpo").addEventListener("change", e => {
  const caixa = e.target.closest("input[data-aluno]");
  if (!caixa) return;
  if (caixa.checked) ch.presentes.add(caixa.dataset.aluno); else ch.presentes.delete(caixa.dataset.aluno);
  ch.sujo = true;
  caixa.closest(".ch-aluno").classList.toggle("presente", caixa.checked);
  atualizarContadorChamada();
});

document.getElementById("abaChamada").addEventListener("click", async e => {
  const aula = e.target.closest("[data-sessao]");
  if (aula) {
    if (aula.dataset.sessao === ch.sessaoKey) return;
    if (!(await podeTrocarSelecao())) return;
    ch.sessaoKey = aula.dataset.sessao;
    carregarEstadoChamada();
    renderChamada();
    return;
  }

  const b = e.target.closest("[data-ch]");
  if (!b) return;
  const acao = b.dataset.ch;

  if (acao === "salvar") { salvarChamadaAtual(); return; }
  if (acao === "encerrar") { abrirEncerrar(); return; }

  // "todos" / "nenhum"
  const alunos = alunosDaTurma(ch.turmaId);
  ch.presentes = acao === "todos" ? new Set(alunos.map(a => a.id)) : new Set();
  ch.sujo = true;
  renderChamada();
});

// ----- folha do mês: impressão / PDF -----
function htmlFolhasDoMes(modalidade) {
  const periodo = periodoDaModalidade(modalidade);
  const professor = (est.conta && est.conta.nome) || modalidade.professor || "";
  const agora = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return est.turmas
    .filter(t => t.modalidadeId === modalidade.id)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map(t => ({ t, sessoes: sessoesDaTurma(t), alunos: alunosDaTurma(t.id) }))
    .filter(x => x.sessoes.length && x.alunos.length)
    .map(({ t, sessoes, alunos }) => `
      <section class="folha">
        <header class="folha-topo">
          <img src="images/brasao.jpg" alt="">
          <div><strong>Prefeitura de Regente Feijó</strong><br>Departamento de Esporte e Lazer</div>
          <div class="folha-titulo">Folha de chamada — ${esc(rotuloPeriodo(periodo))}</div>
        </header>
        <p class="folha-info">
          <strong>Modalidade:</strong> ${esc(modalidade.nome)} &nbsp;&nbsp;
          <strong>Turma:</strong> ${esc(t.nome)} &nbsp;&nbsp;
          <strong>Professor(a):</strong> ${esc(professor)}<br>
          <strong>Aulas:</strong> ${esc(slotsDaTurma(t).map(rotuloSlotCurto).join(" · "))}
        </p>
        ${htmlTabelaFolha(t, sessoes, alunos)}
        <div class="folha-rodape">
          <span>P = presente &nbsp; F = faltou &nbsp; (em branco = chamada não registrada)</span>
          <span>Gerado em ${esc(agora)}</span>
        </div>
        <p class="folha-assinatura">Assinatura do(a) professor(a): ______________________________________</p>
      </section>`)
    .join("");
}

// manda a folha para a janela de impressão do navegador ("Salvar como PDF" ou papel)
function imprimirFolha(html, nomeDoArquivo) {
  const alvo = document.getElementById("folhaImpressao");
  const tituloAntes = document.title;
  alvo.innerHTML = html;
  document.title = nomeDoArquivo;            // o navegador usa o título como nome padrão do PDF
  document.body.classList.add("imprimindo");

  const terminar = () => {
    window.removeEventListener("afterprint", terminar);
    document.body.classList.remove("imprimindo");
    document.title = tituloAntes;
    alvo.innerHTML = "";
  };
  window.addEventListener("afterprint", terminar);
  window.print();
}

// ----- encerrar o mês -----
const modalEncerrar = document.getElementById("modalEncerrar");
const encConfirma = document.getElementById("encConfirma");
const encLimpar = document.getElementById("encLimpar");
const encErro = document.getElementById("encErro");
let enc = { modalidadeId: null, temFolha: false, pdfFeito: false };

function abrirEncerrar() {
  const turma = turmaAtual();
  if (!turmaPermitida(turma)) return;
  const modalidade = modalidadePorId(turma.modalidadeId);
  const periodo = periodoDaModalidade(modalidade);
  const proximo = proximoPeriodo(periodo);

  const turmas = est.turmas.filter(t => t.modalidadeId === modalidade.id);
  let aulas = 0, salvas = 0;
  turmas.forEach(t => sessoesDaTurma(t).forEach(sess => { aulas++; if (chamadaDaSessao(t.id, sess)) salvas++; }));

  enc = { modalidadeId: modalidade.id, temFolha: htmlFolhasDoMes(modalidade) !== "", pdfFeito: false };
  enc.pdfFeito = !enc.temFolha;   // sem folha para gerar, não há o que guardar antes de limpar

  document.getElementById("encSub").textContent = `${modalidade.nome} — ${rotuloPeriodo(periodo)}`;
  document.getElementById("encResumo").textContent = aulas
    ? `${turmas.length} ${turmas.length === 1 ? "turma" : "turmas"}, ${aulas} ${aulas === 1 ? "aula" : "aulas"} no mês, ${salvas} com chamada salva e ${aulas - salvas} sem chamada.`
    : "Esta modalidade não tem aulas cadastradas neste mês.";

  document.getElementById("encPassos").hidden = !enc.temFolha;
  document.getElementById("encPdf").hidden = !enc.temFolha;
  document.getElementById("encConfirmaTxt").textContent = enc.temFolha
    ? `Já salvei ou imprimi a folha e quero apagar as chamadas de ${rotuloPeriodo(periodo)}.`
    : `Quero avançar para ${rotuloPeriodo(proximo)}.`;
  encConfirma.checked = false;
  encConfirma.disabled = !enc.pdfFeito;
  encLimpar.disabled = true;
  encLimpar.textContent = `Limpar e ir para ${rotuloPeriodo(proximo)}`;
  encErro.textContent = "";
  abrirModal(modalEncerrar);
}

function proximoPeriodo(p) {
  let [ano, mes] = p.split("-").map(Number);
  mes++;
  if (mes > 12) { mes = 1; ano++; }
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

document.getElementById("encPdf").addEventListener("click", () => {
  const modalidade = modalidadePorId(enc.modalidadeId);
  if (!modalidade) return;
  imprimirFolha(htmlFolhasDoMes(modalidade), `Chamada - ${modalidade.nome} - ${rotuloPeriodo(periodoDaModalidade(modalidade))}`);
  enc.pdfFeito = true;
  encConfirma.disabled = false;
});

encConfirma.addEventListener("change", () => { encLimpar.disabled = !encConfirma.checked; });
document.getElementById("encFechar").addEventListener("click", () => fecharModal(modalEncerrar));
document.getElementById("encCancelar").addEventListener("click", () => fecharModal(modalEncerrar));

encLimpar.addEventListener("click", async () => {
  const modalidade = modalidadePorId(enc.modalidadeId);
  if (!modalidade || !enc.pdfFeito || !encConfirma.checked) return;
  if (!idsMinhasModalidades().includes(modalidade.id)) return;

  const periodo = periodoDaModalidade(modalidade);
  encLimpar.disabled = true;
  try {
    await Dados.encerrarMes(modalidade.id, periodo);
    [est.modalidades, est.chamadas] = await Promise.all([Dados.listarModalidades(), Dados.listarChamadas()]);
    ch.sessaoKey = "";
    ch.sujo = false;
    fecharModal(modalEncerrar);
    renderTudo();
    mostrarAviso(`Mês encerrado. Agora você está em ${rotuloPeriodo(proximoPeriodo(periodo))}.`);
  } catch {
    encErro.textContent = "Não foi possível limpar agora. Tente novamente.";
    encLimpar.disabled = false;
  }
});

// ===== MENU MOBILE (cabeçalho do painel) =====
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

// ===== INÍCIO =====
rotear(false);