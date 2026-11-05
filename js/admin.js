// =====================================================================
// ÁREA ADMINISTRATIVA — login, cadastro e painel (OED e professor)
//
// ACESSO (Supabase Auth): cada pessoa tem CPF + a SUA PRÓPRIA senha.
// O perfil (professor ou OED) só é criado pelo banco de dados quando a
// pessoa informa, no cadastro, o CÓDIGO DE ACESSO correto (guardado em
// hash no banco, nunca neste arquivo):
//   professor -> edita apenas as modalidades que o OED liberar para ele
//   oed       -> cria, edita e exclui tudo
//
// Este arquivo só monta as telas. Quem decide o que cada perfil pode ler
// ou gravar são as regras de segurança do banco (setup.sql): mesmo que
// alguém altere este JavaScript no navegador, o banco recusa.
// =====================================================================
const TAM_MIN_SENHA = 10;                       // o mínimo real é configurado no painel do Supabase
const OCIOSO_MS = 30 * 60 * 1000;               // sai sozinho após 30 min sem usar

const NOME_PERFIL = { professor: "Professor", oed: "OED" };

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

// ===== AUTENTICAÇÃO (Supabase Auth) =====
async function cadastrar(nomeDigitado, cpf, senha, codigo) {
  const nome = formatarNome(nomeDigitado);
  if (!nomeValido(nome)) return { ok: false, erro: "Informe o seu nome completo." };
  if (!cpfValido(cpf)) return { ok: false, erro: "CPF inválido. Confira os números." };
  if (senha.length < TAM_MIN_SENHA) return { ok: false, erro: `Crie uma senha com pelo menos ${TAM_MIN_SENHA} caracteres.` };
  if (senha.length > 72) return { ok: false, erro: "A senha pode ter no máximo 72 caracteres." };
  if (!/[A-Za-z]/.test(senha) || !/[0-9]/.test(senha)) return { ok: false, erro: "Use letras e números na senha." };
  if (!codigo) return { ok: false, erro: "Informe o código de acesso." };

  try {
    return await Dados.auth.cadastrar({ nome, cpf, senha, codigo });
  } catch {
    return { ok: false, erro: "Não foi possível concluir o cadastro agora. Tente novamente." };
  }
}

async function autenticar(cpf, senha) {
  if (!cpfValido(cpf)) return { ok: false, erro: "CPF inválido. Confira os números." };
  if (!senha) return { ok: false, erro: "Informe a senha." };

  try {
    const r = await Dados.auth.entrar(cpf, senha);
    return r.ok ? { ok: true, conta: resumoDaConta(r.conta) } : r;
  } catch {
    return { ok: false, erro: "Não foi possível conectar agora. Tente novamente." };
  }
}

function resumoDaConta(c) {
  return { cpf: c.cpf, perfil: c.perfil, nome: c.nome || "", modalidadesIds: c.modalidadesIds || [] };
}

// ===== SESSÃO =====
// A sessão é do Supabase Auth (guardada só enquanto a aba estiver aberta) e é
// conferida no servidor a cada abertura da área: Dados.auth.contaAtual().

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
  chamadas: [],
  periodo: ""          // mês de trabalho ("2026-10"); só o OED troca
};

const ehOed = () => Boolean(est.conta) && est.conta.perfil === "oed";
const idsDoProfessor = () => (est.conta && est.conta.modalidadesIds) || [];
const podeEditar = m => ehOed() || idsDoProfessor().includes(m.id);
const modalidadesVisiveis = () => (ehOed() ? est.modalidades : est.modalidades.filter(m => idsDoProfessor().includes(m.id)));

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

  esconderSenhas();

  mostrarMsg(msgLogin, "");
  mostrarMsg(msgCadastro, "");
  marcarErro(formLogin, false);
  marcarErro(formCadastro, false);
  // no celular não foca sozinho, para o teclado não abrir sem a pessoa tocar no campo
  if (focar && !window.matchMedia("(pointer: coarse)").matches) {
    document.getElementById(qual === "login" ? "loginCpf" : "cadCpf").focus();
  }
}

// ----- saída automática por inatividade -----
let temporizadorOcioso = null;
function reiniciarOcioso() {
  clearTimeout(temporizadorOcioso);
  if (!est.conta) return;
  temporizadorOcioso = setTimeout(async () => {
    est.conta = null;
    await Dados.auth.sair();
    location.hash = "#login";
    mostrarAcesso("login", false);
    mostrarMsg(msgLogin, "Sessão encerrada por inatividade. Entre novamente.", "ok");
  }, OCIOSO_MS);
}
["click", "keydown", "pointerdown", "touchstart"].forEach(ev =>
  document.addEventListener(ev, reiniciarOcioso, { passive: true }));

async function entrarNaArea(conta) {
  est.conta = conta;
  reiniciarOcioso();
  await iniciarPainel(conta);
  if (!conta.nome) pedirNome();   // contas criadas antes do campo de nome
}

async function rotear(focar) {
  let conta = null;
  try { conta = await Dados.auth.contaAtual(); } catch { /* segue para o login */ }
  if (conta) {
    await entrarNaArea(resumoDaConta(conta));
    return;
  }
  mostrarAcesso(location.hash === "#cadastro" ? "cadastro" : "login", focar);
}

window.addEventListener("hashchange", () => { if (!est.conta) rotear(true); });

// se a sessão cair (outra aba saiu, token expirou), volta para o login
Dados.auth.aoSair(() => {
  if (!est.conta) return;
  est.conta = null;
  location.hash = "#login";
  mostrarAcesso("login", false);
});

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
  const senha = document.getElementById("loginSenha").value;
  const botao = formLogin.querySelector(".btn");

  botao.disabled = true;
  try {
    const r = await autenticar(cpf, senha);
    if (!r.ok) {
      marcarErro(formLogin, true);
      mostrarMsg(msgLogin, r.erro, "erro");
      return;
    }
    formLogin.reset();
    esconderSenhas();
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
  const senha = document.getElementById("cadSenha").value;
  const codigo = document.getElementById("cadCodigo").value.trim();
  const botao = formCadastro.querySelector(".btn");

  botao.disabled = true;
  try {
    const r = await cadastrar(nome, cpf, senha, codigo);
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
    esconderSenhas();
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

// ===== OLHINHO: MOSTRAR / OCULTAR A SENHA =====
function esconderSenhas() {
  document.querySelectorAll("[data-alternar-senha]").forEach(b => {
    const campo = document.getElementById(b.dataset.alternarSenha);
    if (campo) campo.type = "password";
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-label", "Mostrar senha");
    b.querySelector(".olho-aberto").hidden = false;
    b.querySelector(".olho-fechado").hidden = true;
  });
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-alternar-senha]");
  if (!b) return;
  const campo = document.getElementById(b.dataset.alternarSenha);
  const mostrar = campo.type === "password";
  campo.type = mostrar ? "text" : "password";
  b.setAttribute("aria-pressed", String(mostrar));
  b.setAttribute("aria-label", mostrar ? "Ocultar senha" : "Mostrar senha");
  b.querySelector(".olho-aberto").hidden = mostrar;
  b.querySelector(".olho-fechado").hidden = !mostrar;
  campo.focus();
});

// ===== SAIR =====
document.getElementById("btnSairOed").addEventListener("click", async () => {
  est.conta = null;
  clearTimeout(temporizadorOcioso);
  await Dados.auth.sair();
  location.hash = "#login";
  mostrarAcesso("login", false);
});

// =====================================================================
// PAINEL (OED: tudo | professor: só editar as modalidades liberadas)
// =====================================================================
async function carregarDados() {
  const [m, f, s, c, t, a, h, p] = await Promise.all([
    Dados.listarModalidades(),
    Dados.listarFiltros(),
    Dados.listarSolicitacoes(),
    Dados.listarContas(),
    Dados.listarTurmas(),
    Dados.listarAlunos(),
    Dados.listarChamadas(),
    Dados.obterPeriodo()
  ]);
  est.modalidades = m;
  est.filtros = f;
  est.solicitacoes = s;
  est.contas = c;
  est.turmas = t;
  est.alunos = a;
  est.chamadas = h;
  est.periodo = p;
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
  ch.status = new Map();
  ch.motivos = new Map();
  ch.semAula = false;
  ch.det = { aulas: false, resumo: false, folha: false };
  ch.salvoEm = null;
  ch.sujo = false;
  hist.modalidadeId = "todas";
  hist.estado = new Map();
  trocarTela("painel");
  document.title = (ehOed() ? "Painel do OED" : "Painel do Professor") + " — DEL";
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
  const padrao = ehOed() ? "OED" : "Professor";
  document.getElementById("admOla").textContent = `Olá, ${nome ? primeiroNome(nome) : padrao}!`;
}

function renderAbas() {
  const oed = ehOed();
  const permitidas = oed ? ["modalidades", "solicitacoes", "usuarios", "historico"] : ["modalidades", "turmas", "chamada"];
  if (!permitidas.includes(est.aba)) est.aba = "modalidades";

  document.getElementById("abasOed").hidden = !oed;
  document.getElementById("abasProf").hidden = oed;
  document.querySelector(".adm-topo-acoes").hidden = !oed;

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
  document.getElementById("abaHistorico").hidden = est.aba !== "historico";

  const badge = document.getElementById("badgeSolic");
  badge.hidden = est.solicitacoes.length === 0;
  badge.textContent = est.solicitacoes.length;
}

function renderModalidades() {
  const el = document.getElementById("admCards");
  const oed = ehOed();
  const pagina = paginar(modalidadesVisiveis(), "modalidades", document.getElementById("pagModalidades"));

  if (pagina.length === 0) {
    el.innerHTML = oed
      ? '<p class="vazio">Nenhuma modalidade cadastrada. Clique em “Nova Modalidade” para começar.</p>'
      : '<p class="vazio">Nenhuma modalidade foi liberada para a sua conta ainda. Fale com o OED.</p>';
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
      <div class="adm-card-acoes ${oed ? "" : "so-um"}">
        <button type="button" class="adm-btn-card" data-acao="editar" data-id="${esc(m.id)}">${ICONE_EDITAR} Editar</button>
        ${oed ? `<button type="button" class="adm-btn-card" data-acao="excluir-mod" data-id="${esc(m.id)}">${ICONE_EXCLUIR} Excluir</button>` : ""}
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
  renderHistorico();
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
  else if (modalPdf.classList.contains("aberto")) fecharModal(modalPdf);
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

// ----- dias e horários das aulas (só professores e OED; usados na chamada) -----
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
    professor: v("fProfessor"), descricao: v("fDescricao")
  };
  const rotulos = {
    nome: "Nome da modalidade", dias: "Dias", local: "Local", endereco: "Endereço",
    professor: "Nome do professor", descricao: "Descrição"
  };

  if (!est.filtros.length) {
    fErro.textContent = "Ainda não há filtros cadastrados. O OED precisa criá-los em “Gerenciar Filtros”.";
    return;
  }

  const faltando = Object.keys(rotulos).filter(k => !campos[k]).map(k => rotulos[k]);
  const catId = fCat.value;
  if (!catId) faltando.push("Categoria (filtro)");
  if (!agendaForm.length) faltando.push("Dias e horários das aulas");

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
  if (!editandoId && !ehOed()) {
    fErro.textContent = "Apenas o OED pode criar modalidades.";
    return;
  }

  const botao = document.getElementById("formSalvar");
  botao.disabled = true;
  try {
    await Dados.salvarModalidade({
      ...(base || {}), ...campos, horarios: "", cat: catId, fotos: fotosForm.slice(0, MAX_FOTOS),
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
  // abas (só o OED as vê)
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
    const topo = ehOed() ? "#abasOed" : "#abasProf";
    document.querySelector(topo).scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  // nova modalidade e filtros: só OED
  if (e.target.closest("#btnNova")) { if (ehOed()) abrirFormModalidade(null); return; }
  if (e.target.closest("#btnGerFiltros")) { if (ehOed()) abrirFiltros(); return; }

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
      if (!ehOed()) await acaoTurma(acao, btn);
      return;
    }

    // todas as ações abaixo são exclusivas do OED
    if (!ehOed()) return;

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

// ===== LIBERAR MODALIDADES PARA UM PROFESSOR (só OED) =====
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
  if (!ehOed()) return;
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

// ===== GERENCIAR FILTROS (só OED: adicionar / editar / excluir) =====
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
// PROFESSOR: TURMAS, ALUNOS E CHAMADA  |  OED: HISTÓRICO, PDF E TROCA DO MÊS
//
// - A MODALIDADE define os dias e horários das aulas ("agenda"). O público
//   também vê essas informações no site, só para leitura.
// - A TURMA escolhe em quais desses horários tem aula e guarda os alunos.
// - O PROFESSOR faz a chamada aula por aula, no mês de trabalho do site
//   (ex.: "Janeiro - 2026"). Cada aluno fica como presente, falta ou falta
//   justificada, e a aula pode ser marcada como "sem aula".
// - SÓ O OED troca o mês de trabalho, baixa a folha em PDF e apaga as chamadas.
// =====================================================================
const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_EXTENSO = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0];   // semana começando na segunda
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const RAZOES_SEM_AULA = ["Feriado", "Aula cancelada", "Alerta de segurança", "Condições climáticas", "Professor ausente", "Outro motivo"];

const novoId = prefixo => prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const horaBonita = h => String(h || "").replace(":", "h");

function dataISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dataBR(iso) {
  const [a, m, d] = String(iso).split("-");
  return `${d}/${m}/${a}`;
}

// ----- mês de trabalho (um só para o site; só o OED troca) -----
const rotuloPeriodo = p => { const [a, m] = p.split("-"); return `${MESES[Number(m) - 1]} - ${Number(a)}`; };

// ----- calendário de qualquer ano (1 a 9999) -----
// O Date do JavaScript trata anos de 0 a 99 como 1900 a 1999, então o dia da semana
// e o tamanho do mês são calculados aqui, pela regra do calendário gregoriano.
const ANO_MIN = 1;
const ANO_MAX = 9999;
const anoBissexto = a => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
const diasDoMes = (ano, mes) => [31, anoBissexto(ano) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1];
function diaDaSemana(ano, mes, dia) {
  const d = new Date(2000, 0, 1);
  d.setFullYear(ano, mes - 1, dia);   // setFullYear aceita qualquer ano sem o "1900 + ano"
  return d.getDay();
}
const textoAno = ano => String(ano).padStart(4, "0");   // "0999", "2026": mantém a ordem certa ao comparar
const periodoAtual = () => est.periodo || dataISO().slice(0, 7);
function proximoPeriodo(p) {
  let [ano, mes] = p.split("-").map(Number);
  mes++;
  if (mes > 12) { mes = 1; ano++; }
  return `${textoAno(ano)}-${String(mes).padStart(2, "0")}`;
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

// todas as aulas da turma dentro do mês de trabalho
function sessoesDaTurma(t) {
  const [ano, mes] = periodoAtual().split("-").map(Number);
  const slots = slotsDaTurma(t);
  const saida = [];
  for (let d = 1; d <= diasDoMes(ano, mes); d++) {
    const dow = diaDaSemana(ano, mes, d);
    slots.filter(sl => sl.dia === dow).forEach(sl => saida.push({
      slotId: sl.id, dia: dow, inicio: sl.inicio, fim: sl.fim,
      data: `${textoAno(ano)}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`
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
  if (ehOed()) { el.innerHTML = ""; return; }

  const mods = modalidadesVisiveis();
  if (!mods.length) {
    el.innerHTML = '<p class="adm-vazio">Nenhuma modalidade foi liberada para a sua conta ainda. Fale com o OED.</p>';
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

// ----- folha: tabela, cartões (celular), legenda e observações -----
// situação de um aluno numa aula: P presente | F falta | J falta justificada | S/A sem aula
function celulaChamada(c, alunoId) {
  if (!c) return { classe: "", txt: "" };
  if (c.semAula) return { classe: "sa", txt: "S/A" };
  if ((c.presentes || []).includes(alunoId)) return { classe: "p", txt: "P" };
  if (alunoId in (c.justificadas || {})) return { classe: "j", txt: "J" };
  return { classe: "f", txt: "F" };
}

function contarAluno(turma, sessoes, aluno) {
  const n = { p: 0, j: 0, f: 0 };
  sessoes.forEach(sess => {
    const cel = celulaChamada(chamadaDaSessao(turma.id, sess), aluno.id);
    if (cel.classe === "p") n.p++;
    else if (cel.classe === "j") n.j++;
    else if (cel.classe === "f") n.f++;
  });
  return n;
}

function htmlTabelaFolha(turma, sessoes, alunos, opcoes = {}) {
  const ids = new Set(alunos.map(a => a.id));
  // no PDF, a altura das linhas é calculada para a tabela ocupar o espaço reservado na folha
  const estilo = opcoes.rowH ? ` style="height:${opcoes.rowH.toFixed(2)}mm"` : "";

  const cab = sessoes.map(sess => {
    const [, mes, dia] = sess.data.split("-");
    return `<th><span>${dia}/${mes}</span><small>${DIAS_CURTOS[sess.dia]}<br>${esc(horaBonita(sess.inicio))}</small></th>`;
  }).join("");

  const linhas = alunos.map((a, i) => {
    const cel = sessoes.map(sess => {
      const c = celulaChamada(chamadaDaSessao(turma.id, sess), a.id);
      return `<td class="${c.classe}">${c.txt}</td>`;
    }).join("");
    const n = contarAluno(turma, sessoes, a);
    return `<tr${estilo}><td class="n">${i + 1}</td><td class="nome">${esc(a.nome)}</td>${cel}<td class="tot">${n.p}</td><td class="tot">${n.j}</td><td class="tot">${n.f}</td></tr>`;
  }).join("");

  // linhas em branco (só no PDF) para a tabela preencher a folha quando a turma é pequena
  const brancos = Array.from({ length: opcoes.brancos || 0 }, () =>
    `<tr${estilo}><td class="n"></td><td class="nome"></td>${sessoes.map(() => "<td></td>").join("")}<td class="tot"></td><td class="tot"></td><td class="tot"></td></tr>`
  ).join("");

  let totalGeral = 0;
  const rodape = sessoes.map(sess => {
    const c = chamadaDaSessao(turma.id, sess);
    if (!c) return "<td></td>";
    if (c.semAula) return '<td class="sa">S/A</td>';
    const n = (c.presentes || []).filter(id => ids.has(id)).length;
    totalGeral += n;
    return `<td>${n}</td>`;
  }).join("");

  return `
    <table class="folha-tabela${sessoes.length > 14 ? " muitas" : ""}">
      <thead><tr><th class="n">Nº</th><th class="nome">Aluno</th>${cab}<th class="tot">Pres.</th><th class="tot">Just.</th><th class="tot">Falt.</th></tr></thead>
      <tbody>${linhas}${brancos}</tbody>
      <tfoot><tr${estilo}><td class="n"></td><td class="nome">Presentes na aula</td>${rodape}<td class="tot">${totalGeral}</td><td class="tot"></td><td class="tot"></td></tr></tfoot>
    </table>`;
}

const HTML_LEGENDA = `
  <div class="papel-legenda">
    <span><b class="leg p">P</b> Presente</span>
    <span><b class="leg f">F</b> Falta</span>
    <span><b class="leg j">J</b> Falta justificada</span>
    <span><b class="leg sa">S/A</b> Sem aula</span>
  </div>`;

// itens das observações: dias sem aula (com motivo) e faltas justificadas (com motivo)
function listaObservacoes(turma, sessoes, alunos) {
  const nomes = new Map(alunos.map(a => [a.id, a.nome]));
  const itens = [];
  sessoes.forEach(sess => {
    const c = chamadaDaSessao(turma.id, sess);
    if (!c) return;
    const [, mes, dia] = sess.data.split("-");
    const quando = `${dia}/${mes} (${DIAS_CURTOS[sess.dia]} ${horaBonita(sess.inicio)})`;
    if (c.semAula) {
      itens.push(`<li><strong>${quando}</strong> — Sem aula: ${esc(c.motivo || "motivo não informado")}</li>`);
      return;
    }
    Object.entries(c.justificadas || {}).forEach(([id, motivo]) => {
      if (nomes.has(id)) itens.push(`<li><strong>${quando}</strong> — ${esc(nomes.get(id))}: ${esc(motivo || "justificada")}</li>`);
    });
  });
  return itens;
}

function htmlObservacoes(turma, sessoes, alunos) {
  const itens = listaObservacoes(turma, sessoes, alunos);
  return itens.length ? `<div class="papel-obs"><strong>Observações</strong><ul>${itens.join("")}</ul></div>` : "";
}

function nomeDoProfessorDa(modalidade) {
  if (modalidade.professor) return modalidade.professor;
  return est.conta && est.conta.perfil === "professor" ? est.conta.nome || "" : "";
}

// "folha de papel" na tela (a tabela rola para o lado quando há muitas aulas)
function htmlPapelFolha(turma, modalidade, sessoes, alunos) {
  const periodo = periodoAtual();
  return `
    <article class="papel">
      <header class="papel-topo">
        <img src="images/brasao.jpg" alt="">
        <div class="papel-orgao"><strong>Prefeitura de Regente Feijó</strong><span>Departamento de Esporte e Lazer</span></div>
      </header>
      <h4 class="papel-titulo">Folha de chamada — ${esc(rotuloPeriodo(periodo))}</h4>
      <dl class="papel-info">
        <div><dt>Modalidade</dt><dd>${esc(modalidade.nome)}</dd></div>
        <div><dt>Turma</dt><dd>${esc(turma.nome)}</dd></div>
        <div><dt>Professor(a)</dt><dd>${esc(nomeDoProfessorDa(modalidade) || "—")}</dd></div>
        <div><dt>Aulas</dt><dd>${esc(slotsDaTurma(turma).map(rotuloSlotCurto).join(" · ") || "—")}</dd></div>
      </dl>
      ${HTML_LEGENDA}
      <div class="papel-tabela"><div class="papel-rolagem">${htmlTabelaFolha(turma, sessoes, alunos)}</div></div>
      <p class="papel-dica">Deslize para o lado para ver todas as aulas →</p>
      ${htmlObservacoes(turma, sessoes, alunos)}
    </article>`;
}

// ----- aba Chamada (professor) -----
const ch = {
  turmaId: "", sessaoKey: "", data: "",
  status: new Map(),     // alunoId -> "P" | "F" | "J"
  motivos: new Map(),    // alunoId -> motivo da falta justificada
  semAula: false, razaoSem: "Feriado", detalheSem: "", aplicarTodas: false,
  salvoEm: null, sujo: false,
  det: { aulas: false, resumo: false, folha: false }   // blocos recolhíveis que estão abertos
};
const statusDe = id => ch.status.get(id) || "F";

const turmaAtual = () => est.turmas.find(t => t.id === ch.turmaId);
const sessoesAtuais = () => { const t = turmaAtual(); return t ? sessoesDaTurma(t) : []; };

function carregarEstadoChamada() {
  const t = turmaAtual();
  const sess = sessoesAtuais().find(x => chaveSessao(x) === ch.sessaoKey);
  const c = t && sess ? chamadaDaSessao(t.id, sess) : null;

  ch.data = sess ? sess.data : "";
  ch.status = new Map();
  ch.motivos = new Map();
  ch.semAula = Boolean(c && c.semAula);
  ch.razaoSem = "Feriado";
  ch.detalheSem = "";
  ch.aplicarTodas = false;

  if (c && !c.semAula) {
    (c.presentes || []).forEach(id => ch.status.set(id, "P"));
    Object.entries(c.justificadas || {}).forEach(([id, motivo]) => { ch.status.set(id, "J"); ch.motivos.set(id, motivo); });
  }
  if (c && c.semAula) {
    const [razao, ...resto] = String(c.motivo || "").split(" — ");
    if (RAZOES_SEM_AULA.includes(razao)) { ch.razaoSem = razao; ch.detalheSem = resto.join(" — "); }
    else { ch.razaoSem = "Outro motivo"; ch.detalheSem = c.motivo || ""; }
  }
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
  const alunos = alunosDaTurma(ch.turmaId);
  let p = 0, j = 0;
  alunos.forEach(a => { const st = statusDe(a.id); if (st === "P") p++; else if (st === "J") j++; });
  const f = alunos.length - p - j;
  const el = document.getElementById("chContador");
  if (el) el.textContent = `Presentes: ${p} de ${alunos.length} · ${j} justificada${j === 1 ? "" : "s"} · ${f} falta${f === 1 ? "" : "s"}`;
}

function htmlLinhaAluno(a) {
  const st = statusDe(a.id);
  const opcao = (valor, rotulo) => `
        <label><input type="radio" name="st-${esc(a.id)}" value="${valor}" ${st === valor ? "checked" : ""}><span>${rotulo}</span></label>`;
  return `
    <div class="ch-aluno st-${st}">
      <span class="ch-nome">${esc(a.nome)}</span>
      <div class="ch-seg" role="radiogroup" aria-label="Situação de ${esc(a.nome)}">
        ${opcao("P", "Presente")}${opcao("F", "Falta")}${opcao("J", "Justificada")}
      </div>
      <input type="text" class="ch-motivo" data-motivo="${esc(a.id)}" list="motivosJust" maxlength="80"
        placeholder="Motivo (ex.: doente, machucado)" value="${esc(ch.motivos.get(a.id) || "")}"
        aria-label="Motivo da falta justificada de ${esc(a.nome)}" ${st === "J" ? "" : "hidden"}>
    </div>`;
}

function htmlSemAula(sessao) {
  return `
    <div class="ch-sem">
      <div class="mcampo">
        <label for="chRazao">Motivo</label>
        <select id="chRazao">
          ${RAZOES_SEM_AULA.map(r => `<option value="${esc(r)}" ${r === ch.razaoSem ? "selected" : ""}>${esc(r)}</option>`).join("")}
        </select>
      </div>
      <div class="mcampo">
        <label for="chDetalhe">Detalhes ${ch.razaoSem === "Outro motivo" ? "(obrigatório)" : "(opcional)"}</label>
        <input type="text" id="chDetalhe" maxlength="100" value="${esc(ch.detalheSem)}" placeholder="Ex.: feriado municipal">
      </div>
      <label class="enc-confirma">
        <input type="checkbox" id="chAplicarTodas" ${ch.aplicarTodas ? "checked" : ""}>
        <span>Aplicar a todas as minhas aulas de ${esc(dataBR(sessao.data))}</span>
      </label>
    </div>`;
}

// guia para quem ainda não tem nada pronto para a chamada
function htmlPassos() {
  const turmas = turmasOrdenadas();
  if (turmas.some(t => slotsDaTurma(t).length && alunosDaTurma(t.id).length)) return "";   // já dá para fazer chamada

  const mods = modalidadesVisiveis();
  const passos = [
    { ok: mods.length > 0, texto: "Ter uma modalidade liberada pelo OED", acao: "", rotulo: "" },
    { ok: mods.some(m => slotsOrdenados(m).length), texto: "Cadastrar os dias e horários das aulas da modalidade", acao: "agenda", rotulo: "Cadastrar horários" },
    { ok: turmas.some(t => slotsDaTurma(t).length), texto: "Criar uma turma e escolher os horários dela", acao: "turma", rotulo: "Criar turma" },
    { ok: turmas.some(t => alunosDaTurma(t.id).length), texto: "Cadastrar os alunos da turma", acao: "alunos", rotulo: "Cadastrar alunos" }
  ];
  const proximo = passos.findIndex(p => !p.ok);
  return `
    <div class="ch-passos">
      <h3>Antes de fazer a chamada</h3>
      <ol>
        ${passos.map((p, i) => `
          <li class="${p.ok ? "ok" : i === proximo ? "agora" : ""}">
            <span class="marca">${p.ok ? "✓" : i + 1}</span>
            <span class="txt">${esc(p.texto)}</span>
            ${i === proximo && p.acao ? `<button type="button" class="mbtn" data-passo="${p.acao}">${esc(p.rotulo)}</button>` : ""}
          </li>`).join("")}
      </ol>
    </div>`;
}

function irParaPasso(acao) {
  const mods = modalidadesVisiveis();
  if (acao === "agenda") {
    const m = mods.find(x => !slotsOrdenados(x).length) || mods[0];
    if (m) abrirFormModalidade(m);
  } else if (acao === "turma") {
    const semHorario = turmasOrdenadas().find(t => !slotsDaTurma(t).length);
    if (semHorario) { abrirFormTurma(semHorario.modalidadeId, semHorario); return; }
    const m = mods.find(x => slotsOrdenados(x).length) || mods[0];
    if (m) abrirFormTurma(m.id, null);
  } else if (acao === "alunos") {
    const lista = turmasOrdenadas();
    const t = lista.find(x => !alunosDaTurma(x.id).length) || lista[0];
    if (t) abrirAlunos(t);
  }
}

// ‹ Terça-feira, 03/02 › + lista de todas as aulas (recolhida)
function htmlNavegadorAulas(sessoes, turma) {
  const hoje = dataISO();
  const sess = sessoes.find(x => chaveSessao(x) === ch.sessaoKey);
  const i = sessoes.indexOf(sess);
  const c = sess ? chamadaDaSessao(turma.id, sess) : null;
  const estado = !sess ? null
    : c ? (c.semAula ? ["semaula", "Sem aula"] : ["salva", "Chamada salva"])
    : ["pendente", "Chamada ainda não feita"];

  const chips = sessoes.map(x => {
    const [, mes, dia] = x.data.split("-");
    const cx = chamadaDaSessao(turma.id, x);
    const classes = ["ch-sessao"];
    if (cx) classes.push(cx.semAula ? "semaula" : "salva");
    if (chaveSessao(x) === ch.sessaoKey) classes.push("ativa");
    if (x.data === hoje) classes.push("hoje");
    return `<button type="button" class="${classes.join(" ")}" data-sessao="${esc(chaveSessao(x))}">
      <strong>${DIAS_CURTOS[x.dia]} ${dia}/${mes}</strong><small>${cx && cx.semAula ? "Sem aula" : esc(horaBonita(x.inicio))}</small>
    </button>`;
  }).join("");

  return `
    <div class="ch-aula-nav">
      <button type="button" class="ch-seta" data-ch="aula-ant" aria-label="Aula anterior" ${i <= 0 ? "disabled" : ""}>‹</button>
      <div class="ch-aula-atual">
        <strong>${sess ? esc(DIAS_EXTENSO[sess.dia]) + ", " + esc(dataBR(sess.data)) : "Escolha uma aula"}</strong>
        ${sess ? `<span>${esc(horaBonita(sess.inicio))} às ${esc(horaBonita(sess.fim))}</span>` : ""}
        ${estado ? `<em class="estado ${estado[0]}">${estado[1]}${c && !c.semAula && ch.salvoEm ? " em " + esc(formatarData(ch.salvoEm)) : ""}</em>` : ""}
      </div>
      <button type="button" class="ch-seta" data-ch="aula-prox" aria-label="Próxima aula" ${i >= sessoes.length - 1 ? "disabled" : ""}>›</button>
    </div>
    <details class="ch-todas" data-det="aulas" ${ch.det.aulas ? "open" : ""}>
      <summary>Ver todas as aulas do mês (${sessoes.length})</summary>
      <div class="ch-sessoes" role="group" aria-label="Aulas do mês">${chips}</div>
    </details>`;
}

function renderChamada() {
  if (ehOed()) return;
  garantirSelecaoChamada();

  const turmas = turmasOrdenadas();
  const sel = document.getElementById("chTurma");
  const controles = document.querySelector("#abaChamada .ch-controles");
  const elPassos = document.getElementById("chPassos");
  const caixaPeriodo = document.getElementById("chPeriodoBox");
  const elSessoes = document.getElementById("chSessoes");
  const corpo = document.getElementById("chCorpo");
  const resumo = document.getElementById("chResumo");
  const folha = document.getElementById("chFolha");

  elPassos.innerHTML = htmlPassos();

  if (!turmas.length) {
    controles.hidden = true;
    sel.innerHTML = "";
    caixaPeriodo.innerHTML = "";
    elSessoes.innerHTML = "";
    corpo.innerHTML = "";
    resumo.innerHTML = "";
    folha.innerHTML = "";
    return;
  }

  controles.hidden = false;
  sel.disabled = false;
  sel.innerHTML = turmas.map(t =>
    `<option value="${esc(t.id)}">${esc(nomeDaModalidade(t.modalidadeId))} — ${esc(t.nome)}</option>`).join("");
  sel.value = ch.turmaId;

  const turma = turmaAtual();
  const modalidade = modalidadePorId(turma.modalidadeId);
  const periodo = periodoAtual();
  const sessoes = sessoesDaTurma(turma);
  const alunos = alunosDaTurma(turma.id);

  // mês de trabalho (só o OED troca)
  caixaPeriodo.innerHTML = `
    <div class="ch-periodo">
      <div>
        <small>Mês de trabalho</small>
        <strong>${esc(rotuloPeriodo(periodo))}</strong>
      </div>
      <p class="ch-periodo-nota">O OED troca o mês quando ele terminar.</p>
    </div>`;

  // escolha da aula
  elSessoes.innerHTML = sessoes.length
    ? htmlNavegadorAulas(sessoes, turma)
    : `<p class="adm-vazio">Esta turma não tem aulas em ${esc(rotuloPeriodo(periodo))}. Confira os horários da turma na aba “Turmas e alunos”.</p>`;

  // chamada da aula escolhida
  const sessao = sessoes.find(x => chaveSessao(x) === ch.sessaoKey);
  if (!sessao) {
    corpo.innerHTML = "";
  } else if (!ch.semAula && !alunos.length) {
    corpo.innerHTML = '<p class="adm-vazio">Esta turma ainda não tem alunos. Cadastre-os na aba “Turmas e alunos”, no botão “Alunos”.</p>';
  } else {
    corpo.innerHTML = `
      <div class="ch-painel">
        <div class="ch-modo" role="group" aria-label="Situação da aula">
          <button type="button" class="${ch.semAula ? "" : "ativo"}" data-ch="aula-realizada">Aula realizada</button>
          <button type="button" class="${ch.semAula ? "ativo" : ""}" data-ch="sem-aula">Sem aula</button>
        </div>
        ${ch.semAula ? htmlSemAula(sessao) : `
          <div class="ch-topo">
            <div class="ch-botoes">
              <button type="button" class="mbtn sec" data-ch="todos">Todos presentes</button>
              <button type="button" class="mbtn sec" data-ch="nenhum">Limpar</button>
            </div>
          </div>
          <div class="ch-lista">${alunos.map(htmlLinhaAluno).join("")}</div>`}
        <div class="ch-barra">
          <p class="ch-contador" id="chContador">${ch.semAula ? "Aula marcada como sem aula" : ""}</p>
          <button type="button" class="mbtn ch-salvar" data-ch="salvar">Salvar chamada</button>
        </div>
      </div>`;
    if (!ch.semAula) atualizarContadorChamada();
  }

  // resumo do dia (todas as turmas do professor) — recolhido
  if (sessao) {
    const idsTurmas = new Set(turmas.map(t => t.id));
    const doDia = est.chamadas.filter(c => c.data === sessao.data && idsTurmas.has(c.turmaId));
    const totalDia = doDia.reduce((soma, c) => soma + (c.semAula ? 0 : c.presentes.length), 0);
    resumo.innerHTML = `
      <details class="ch-det" data-det="resumo" ${ch.det.resumo ? "open" : ""}>
        <summary>Resumo do dia ${esc(dataBR(sessao.data))} <span class="sum-info">${totalDia} ${totalDia === 1 ? "presente" : "presentes"}</span></summary>
        <div class="ch-det-corpo">
          ${doDia.length ? `
            <p class="ch-total">${totalDia} ${totalDia === 1 ? "aluno presente" : "alunos presentes"} no dia</p>
            ${doDia.map(c => {
              const t = est.turmas.find(x => x.id === c.turmaId);
              const sl = t && slotsOrdenados(modalidadePorId(t.modalidadeId)).find(x => x.id === c.slotId);
              const nome = esc(t ? nomeDaModalidade(t.modalidadeId) + " — " + t.nome : "Turma") + (sl ? " (" + esc(horaBonita(sl.inicio)) + ")" : "");
              return `<div class="ch-linha"><span>${nome}</span><strong>${c.semAula ? "Sem aula" : c.presentes.length + " de " + c.total}</strong></div>`;
            }).join("")}`
            : '<p class="adm-vazio">Nenhuma chamada salva neste dia.</p>'}
        </div>
      </details>`;
  } else {
    resumo.innerHTML = "";
  }

  // folha do mês — recolhida
  folha.innerHTML = sessoes.length && alunos.length
    ? `<details class="ch-det" data-det="folha" ${ch.det.folha ? "open" : ""}>
         <summary>Folha do mês — ${esc(rotuloPeriodo(periodo))}</summary>
         <div class="ch-det-corpo"><div class="ch-bloco-folha">${htmlPapelFolha(turma, modalidade, sessoes, alunos)}</div></div>
       </details>`
    : "";
}

// ----- salvar a chamada -----
async function salvarChamadaAtual() {
  const turma = turmaAtual();
  const sessao = sessoesAtuais().find(x => chaveSessao(x) === ch.sessaoKey);
  if (!turmaPermitida(turma) || !sessao) { mostrarAviso("Você não tem permissão para esta turma."); return; }

  try {
    if (ch.semAula) {
      const detalhe = ch.detalheSem.trim();
      if (ch.razaoSem === "Outro motivo" && !detalhe) { mostrarAviso("Descreva o motivo de não ter tido aula."); return; }
      const motivo = detalhe ? `${ch.razaoSem} — ${detalhe}` : ch.razaoSem;

      // alvos: só esta aula ou todas as aulas do professor naquele dia
      const alvos = [];
      if (ch.aplicarTodas) {
        turmasOrdenadas().forEach(t => sessoesDaTurma(t).filter(x => x.data === sessao.data).forEach(x => alvos.push({ t, x })));
      } else {
        alvos.push({ t: turma, x: sessao });
      }
      const substituidas = alvos.filter(({ t, x }) => {
        const c = chamadaDaSessao(t.id, x);
        return c && !c.semAula && !(t.id === turma.id && x.slotId === sessao.slotId);
      }).length;
      if (substituidas) {
        const ok = await confirmar({
          titulo: "Substituir chamadas salvas",
          texto: `${substituidas} ${substituidas === 1 ? "aula já tem" : "aulas já têm"} chamada salva neste dia e ${substituidas === 1 ? "será substituída" : "serão substituídas"} por “Sem aula”. Continuar?`,
          botao: "Continuar"
        });
        if (!ok) return;
      }
      for (const { t, x } of alvos) {
        await Dados.salvarChamada({
          turmaId: t.id, slotId: x.slotId, data: x.data, presentes: [], justificadas: {},
          semAula: true, motivo, total: alunosDaTurma(t.id).length
        });
      }
    } else {
      const alunos = alunosDaTurma(turma.id);
      const presentes = alunos.filter(a => statusDe(a.id) === "P").map(a => a.id);
      const justificadas = {};
      alunos.filter(a => statusDe(a.id) === "J").forEach(a => {
        justificadas[a.id] = (ch.motivos.get(a.id) || "").trim() || "Justificada";
      });
      await Dados.salvarChamada({
        turmaId: turma.id, slotId: sessao.slotId, data: sessao.data,
        presentes, justificadas, semAula: false, motivo: "", total: alunos.length
      });
    }

    est.chamadas = await Dados.listarChamadas();
    carregarEstadoChamada();
    renderChamada();
    mostrarAviso(ch.semAula ? "Aula marcada como “Sem aula”." : "Chamada salva.");
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

const chCorpo = document.getElementById("chCorpo");

chCorpo.addEventListener("change", e => {
  const radio = e.target.closest('input[type="radio"]');
  if (radio) {
    const id = radio.name.slice(3);   // "st-<id>"
    ch.status.set(id, radio.value);
    const linha = radio.closest(".ch-aluno");
    linha.className = "ch-aluno st-" + radio.value;
    const motivo = linha.querySelector(".ch-motivo");
    motivo.hidden = radio.value !== "J";
    if (radio.value === "J") motivo.focus();
    ch.sujo = true;
    atualizarContadorChamada();
    return;
  }
  if (e.target.id === "chRazao") {
    ch.razaoSem = e.target.value;
    ch.sujo = true;
    renderChamada();
    return;
  }
  if (e.target.id === "chAplicarTodas") { ch.aplicarTodas = e.target.checked; ch.sujo = true; }
});

chCorpo.addEventListener("input", e => {
  if (e.target.matches("[data-motivo]")) { ch.motivos.set(e.target.dataset.motivo, e.target.value); ch.sujo = true; }
  if (e.target.id === "chDetalhe") { ch.detalheSem = e.target.value; ch.sujo = true; }
});

// lembra quais blocos recolhíveis estão abertos (a tela é redesenhada a cada ação)
document.getElementById("abaChamada").addEventListener("toggle", e => {
  const d = e.target.closest ? e.target.closest("details[data-det]") : null;
  if (d) ch.det[d.dataset.det] = d.open;
}, true);

document.getElementById("abaChamada").addEventListener("click", async e => {
  const passo = e.target.closest("[data-passo]");
  if (passo) { irParaPasso(passo.dataset.passo); return; }

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
  if (!b || b.disabled) return;
  const acao = b.dataset.ch;

  if (acao === "aula-ant" || acao === "aula-prox") {
    const sessoes = sessoesAtuais();
    const i = sessoes.findIndex(x => chaveSessao(x) === ch.sessaoKey);
    const j = acao === "aula-ant" ? i - 1 : i + 1;
    if (j < 0 || j >= sessoes.length) return;
    if (!(await podeTrocarSelecao())) return;
    ch.sessaoKey = chaveSessao(sessoes[j]);
    carregarEstadoChamada();
    renderChamada();
    return;
  }

  if (acao === "salvar") { salvarChamadaAtual(); return; }
  if (acao === "aula-realizada" || acao === "sem-aula") {
    ch.semAula = acao === "sem-aula";
    ch.sujo = true;
    renderChamada();
    return;
  }

  // "todos" / "nenhum"
  const alunos = alunosDaTurma(ch.turmaId);
  alunos.forEach(a => ch.status.set(a.id, acao === "todos" ? "P" : "F"));
  ch.sujo = true;
  renderChamada();
});

// ----- PDF: várias modalidades por página, sempre ocupando a folha inteira -----
// Medidas em milímetros (A4 com margem de 10 mm). Cada modalidade recebe uma faixa da página
// e a tabela é desenhada para preencher essa faixa: as linhas esticam e, em turmas pequenas,
// entram linhas em branco. Assim a folha não fica com o rodapé vazio, qualquer que seja
// a quantidade de modalidades na página.
const PDF = {
  altura: { paisagem: 190, retrato: 277 },
  topo: 20, rodape: 10, folga: 5,
  tituloModalidade: 6.5, legendaTurma: 5.5, cabecalhoTabela: 9.5, espaco: 1.5,
  linhaMin: 4.9, linhaMax: 10, linhaBranco: 8, obsBase: 6, obsLinha: 3.6
};

function blocosParaPdf(modalidades) {
  return modalidades
    .map(m => ({
      m,
      turmas: est.turmas
        .filter(t => t.modalidadeId === m.id)
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        .map(t => ({ t, sessoes: sessoesDaTurma(t), alunos: alunosDaTurma(t.id) }))
        .filter(x => x.sessoes.length && x.alunos.length)
    }))
    .filter(b => b.turmas.length);
}

function alturaNaturalTurma(x) {
  const obs = listaObservacoes(x.t, x.sessoes, x.alunos).length;
  return PDF.legendaTurma + PDF.cabecalhoTabela + (x.alunos.length + 1) * PDF.linhaMin
    + (obs ? PDF.obsBase + obs * PDF.obsLinha * 1.3 : 0) + PDF.espaco;
}
const alturaNaturalBloco = b => PDF.tituloModalidade + b.turmas.reduce((soma, x) => soma + alturaNaturalTurma(x), 0);

// agrupa as modalidades em páginas: no máximo "porPagina" por página, e só o que cabe
function paginarBlocos(blocos, porPagina, orientacao) {
  const area = PDF.altura[orientacao] - PDF.topo - PDF.rodape - PDF.folga;
  const paginas = [];
  let atual = null;
  blocos.forEach(b => {
    const h = alturaNaturalBloco(b);
    if (!atual || atual.itens.length >= porPagina || atual.soma + h > area || atual.grande) {
      atual = { itens: [], soma: 0, area, grande: false };
      paginas.push(atual);
    }
    atual.itens.push({ b, h });
    atual.soma += h;
    if (h > area) atual.grande = true;   // nem sozinha cabe: a página continua na folha seguinte
  });
  return paginas;
}

// 2 ou mais por página: folha em pé (cabe mais na altura). 1 por página: deitada, a não ser que
// alguma modalidade só caiba em pé (turma grande)
function escolherOrientacao(blocos, porPagina) {
  if (porPagina > 1) return "retrato";
  const areaDeitada = PDF.altura.paisagem - PDF.topo - PDF.rodape - PDF.folga;
  const areaEmPe = PDF.altura.retrato - PDF.topo - PDF.rodape - PDF.folga;
  const precisaEmPe = blocos.some(b => alturaNaturalBloco(b) > areaDeitada && alturaNaturalBloco(b) <= areaEmPe);
  return precisaEmPe ? "retrato" : "paisagem";
}

// linhas da tabela: estica até um limite; se ainda sobrar espaço, completa com linhas em branco
function layoutLinhas(n, area) {
  const base = n + 1;                       // alunos + linha "Presentes na aula"
  const esticada = area / base;
  if (esticada <= PDF.linhaMax) return { rowH: Math.max(esticada, PDF.linhaMin), brancos: 0 };
  const total = Math.max(base, Math.floor(area / PDF.linhaBranco));
  return { rowH: area / total, brancos: total - base };
}

function htmlTurmaPdf(x, extra) {
  const n = x.alunos.length;
  const { rowH, brancos } = layoutLinhas(n, (n + 1) * PDF.linhaMin + extra);
  const obs = listaObservacoes(x.t, x.sessoes, x.alunos);
  return `
    <div class="slot-turma">
      <p class="turma-cap"><strong>Turma ${esc(x.t.nome)}</strong>&nbsp;— Aulas: ${esc(slotsDaTurma(x.t).map(rotuloSlotCurto).join(" · "))}</p>
      ${htmlTabelaFolha(x.t, x.sessoes, x.alunos, { rowH, brancos })}
      ${obs.length ? `<div class="papel-obs"><strong>Observações</strong><ul>${obs.join("")}</ul></div>` : ""}
    </div>`;
}

function htmlSlotPdf(item, altura) {
  const extra = Math.max(0, altura - item.h);
  const porTurma = extra / item.b.turmas.length;
  return `
    <article class="slot" style="height:${altura.toFixed(1)}mm">
      <div class="slot-titulo">
        <strong>${esc(item.b.m.nome)}</strong>
        <span>Professor(a): ${esc(nomeDoProfessorDa(item.b.m) || "—")}</span>
        <span class="assin">Assinatura: ______________________</span>
      </div>
      ${item.b.turmas.map(x => htmlTurmaPdf(x, porTurma)).join("")}
    </article>`;
}

// devolve o HTML das páginas (a orientação da folha é escolhida automaticamente)
function htmlPdfDoMes(modalidades, porPagina) {
  const blocos = blocosParaPdf(modalidades);
  const orientacao = escolherOrientacao(blocos, porPagina);
  if (!blocos.length) return { html: "", paginas: 0, orientacao };

  const paginas = paginarBlocos(blocos, porPagina, orientacao);
  const periodo = rotuloPeriodo(periodoAtual());
  const agora = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  const html = paginas.map((pg, i) => {
    const livre = pg.grande ? 0 : Math.max(0, pg.area - pg.soma);
    const slots = pg.itens.map(it => htmlSlotPdf(it, it.h + livre / pg.itens.length)).join("");
    return `
      <section class="pg ${orientacao}${pg.grande ? " grande" : ""}">
        <header class="pg-topo">
          <img src="images/brasao.jpg" alt="">
          <div class="pg-orgao"><strong>Prefeitura de Regente Feijó</strong><br>Departamento de Esporte e Lazer</div>
          <div class="pg-titulo">Folha de chamada — ${esc(periodo)}<small>Página ${i + 1} de ${paginas.length}</small></div>
        </header>
        <div class="pg-corpo">${slots}</div>
        <footer class="pg-rodape">
          <span>P = presente · F = falta · J = falta justificada · S/A = sem aula · em branco = chamada não registrada</span>
          <span>Gerado em ${esc(agora)}</span>
        </footer>
      </section>`;
  }).join("");
  return { html, paginas: paginas.length, orientacao };
}

// manda a folha para a janela de impressão do navegador ("Salvar como PDF" ou papel)
function imprimirFolha(html, nomeDoArquivo, orientacao = "paisagem") {
  const alvo = document.getElementById("folhaImpressao");
  const tituloAntes = document.title;

  let estilo = document.getElementById("estiloPagina");
  if (!estilo) {
    estilo = document.createElement("style");
    estilo.id = "estiloPagina";
    document.head.appendChild(estilo);
  }
  estilo.textContent = `@page { size: A4 ${orientacao === "retrato" ? "portrait" : "landscape"}; margin: 10mm; }`;

  alvo.innerHTML = html;
  document.title = nomeDoArquivo;            // o navegador usa o título como nome padrão do PDF
  document.body.classList.add("imprimindo");

  const terminar = () => {
    window.removeEventListener("afterprint", terminar);
    document.body.classList.remove("imprimindo");
    document.title = tituloAntes;
    alvo.innerHTML = "";
    estilo.textContent = "";
  };
  window.addEventListener("afterprint", terminar);
  window.print();
}

// ----- janela "Baixar PDF do mês" (só OED) -----
const modalPdf = document.getElementById("modalPdf");
const pdfLista = document.getElementById("pdfLista");
const pdfTodas = document.getElementById("pdfTodas");
const pdfDica = document.getElementById("pdfDica");
const pdfErro = document.getElementById("pdfErro");
let pdfAposGerar = null;

const modalidadesComFolha = () => est.modalidades
  .filter(m => blocosParaPdf([m]).length)
  .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
const pdfQtd = () => Number((document.querySelector("#pdfQtd input:checked") || {}).value || 1);

function pdfSelecionadas() {
  const ids = [...pdfLista.querySelectorAll("input:checked")].map(i => i.value);
  return modalidadesComFolha().filter(m => ids.includes(m.id));
}

function atualizarPdf() {
  const sel = pdfSelecionadas();
  const qtd = pdfQtd();
  pdfTodas.checked = sel.length > 0 && sel.length === modalidadesComFolha().length;
  pdfErro.textContent = "";
  document.getElementById("pdfGerar").disabled = sel.length === 0;

  if (!sel.length) { pdfDica.textContent = "Marque pelo menos uma modalidade."; return; }
  const blocosSel = blocosParaPdf(sel);
  const orientacao = escolherOrientacao(blocosSel, qtd);
  const paginas = paginarBlocos(blocosSel, qtd, orientacao);
  let texto = `${sel.length} ${sel.length === 1 ? "modalidade" : "modalidades"} em ${paginas.length} ${paginas.length === 1 ? "página" : "páginas"}, com a folha ${orientacao === "paisagem" ? "deitada (paisagem)" : "em pé (retrato)"}.`;
  if (paginas.slice(0, -1).some(p => p.itens.length < qtd)) {
    texto += " Algumas páginas terão menos modalidades porque as tabelas não cabem todas juntas.";
  }
  pdfDica.textContent = texto;
}

function abrirPdf(aoGerar, preSelecionada) {
  const mods = modalidadesComFolha();
  if (!mods.length) {
    mostrarAviso("Não há folhas para gerar neste mês. É preciso ter turmas com aulas e alunos.");
    return;
  }
  pdfAposGerar = aoGerar || null;
  document.getElementById("pdfSub").textContent = rotuloPeriodo(periodoAtual());
  pdfLista.innerHTML = mods.map(m => {
    const n = blocosParaPdf([m])[0].turmas.length;
    const marcada = !preSelecionada || preSelecionada === "todas" || preSelecionada === m.id;
    return `
      <label class="atrib-item">
        <input type="checkbox" value="${esc(m.id)}" ${marcada ? "checked" : ""}>
        <span><strong>${esc(m.nome)}</strong><small>${n} ${n === 1 ? "turma" : "turmas"}</small></span>
      </label>`;
  }).join("");
  document.querySelector('#pdfQtd input[value="1"]').checked = true;
  atualizarPdf();
  abrirModal(modalPdf);
}

pdfLista.addEventListener("change", atualizarPdf);
document.getElementById("pdfQtd").addEventListener("change", atualizarPdf);
pdfTodas.addEventListener("change", () => {
  pdfLista.querySelectorAll("input").forEach(i => { i.checked = pdfTodas.checked; });
  atualizarPdf();
});
document.getElementById("pdfFechar").addEventListener("click", () => fecharModal(modalPdf));
document.getElementById("pdfCancelar").addEventListener("click", () => fecharModal(modalPdf));

document.getElementById("pdfGerar").addEventListener("click", () => {
  if (!ehOed()) return;
  const sel = pdfSelecionadas();
  if (!sel.length) return;
  const { html, orientacao } = htmlPdfDoMes(sel, pdfQtd());
  if (!html) { pdfErro.textContent = "Não há folhas para gerar."; return; }

  const depois = pdfAposGerar;
  pdfAposGerar = null;
  fecharModal(modalPdf);
  imprimirFolha(html, `Chamada - ${sel.length === 1 ? sel[0].nome : sel.length + " modalidades"} - ${rotuloPeriodo(periodoAtual())}`, orientacao);
  if (depois) depois();
});

// ----- aba Chamadas (OED): histórico do mês, PDF e troca do mês -----
const hist = { modalidadeId: "todas", estado: new Map() };   // estado: quais modalidades estão abertas

function modalidadesComTurma() {
  return est.modalidades
    .filter(m => est.turmas.some(t => t.modalidadeId === m.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
function modalidadesDoHistorico() {
  const todas = modalidadesComTurma();
  return hist.modalidadeId === "todas" ? todas : todas.filter(m => m.id === hist.modalidadeId);
}

function renderHistorico() {
  if (!ehOed()) return;
  const caixa = document.getElementById("histPeriodoBox");
  const sel = document.getElementById("histModalidade");
  const corpo = document.getElementById("histCorpo");
  const periodo = periodoAtual();
  const comTurma = modalidadesComTurma();
  if (hist.modalidadeId !== "todas" && !comTurma.some(m => m.id === hist.modalidadeId)) hist.modalidadeId = "todas";

  caixa.innerHTML = `
    <div class="ch-periodo">
      <div>
        <small>Mês de trabalho</small>
        <strong>${esc(rotuloPeriodo(periodo))}</strong>
      </div>
      <div class="ch-periodo-acoes">
        <button type="button" class="mbtn sec" data-hist="pdf">Baixar PDF do mês</button>
        <button type="button" class="mbtn" data-hist="trocar">Trocar mês</button>
      </div>
    </div>`;

  sel.innerHTML = '<option value="todas">Todas as modalidades</option>' +
    comTurma.map(m => `<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join("");
  sel.value = hist.modalidadeId;

  const grupos = modalidadesDoHistorico()
    .map(m => ({ m, turmas: blocosParaPdf([m])[0] ? blocosParaPdf([m])[0].turmas : [] }))
    .filter(g => g.turmas.length);

  corpo.innerHTML = grupos.length
    ? grupos.map(({ m, turmas }) => {
        const aulas = turmas.reduce((soma, x) => soma + x.sessoes.length, 0);
        const aberta = hist.estado.has(m.id) ? hist.estado.get(m.id) : grupos.length === 1;
        return `
          <details class="hist-mod" data-hid="${esc(m.id)}" ${aberta ? "open" : ""}>
            <summary><strong>${esc(m.nome)}</strong><span>${turmas.length} ${turmas.length === 1 ? "turma" : "turmas"} · ${aulas} ${aulas === 1 ? "aula" : "aulas"}</span></summary>
            <div class="hist-corpo">${turmas.map(x => htmlPapelFolha(x.t, m, x.sessoes, x.alunos)).join("")}</div>
          </details>`;
      }).join("")
    : `<p class="adm-vazio">Nenhuma turma com aulas e alunos em ${esc(rotuloPeriodo(periodo))}.</p>`;
}

document.getElementById("histModalidade").addEventListener("change", e => {
  hist.modalidadeId = e.target.value;
  renderHistorico();
});

document.getElementById("abaHistorico").addEventListener("toggle", e => {
  const d = e.target.closest ? e.target.closest("details[data-hid]") : null;
  if (d) hist.estado.set(d.dataset.hid, d.open);
}, true);

document.getElementById("abaHistorico").addEventListener("click", e => {
  const b = e.target.closest("[data-hist]");
  if (!b || !ehOed()) return;
  if (b.dataset.hist === "trocar") abrirEncerrar();
  else abrirPdf(null, hist.modalidadeId);
});

// ----- trocar o mês de trabalho (só OED) -----
const modalEncerrar = document.getElementById("modalEncerrar");
const encMes = document.getElementById("encMes");
const encAno = document.getElementById("encAno");
const encConfirma = document.getElementById("encConfirma");
const encLimpar = document.getElementById("encLimpar");
const encApenas = document.getElementById("encApenas");
const encErro = document.getElementById("encErro");
const encDica = document.getElementById("encDica");
let enc = { temFolha: false, pdfFeito: false };

function resumoGeralDoMes() {
  const n = { turmas: est.turmas.length, aulas: 0, salvas: 0, semAula: 0 };
  est.turmas.forEach(t => sessoesDaTurma(t).forEach(sess => {
    n.aulas++;
    const c = chamadaDaSessao(t.id, sess);
    if (c) { n.salvas++; if (c.semAula) n.semAula++; }
  }));
  return n;
}

function lerNovoPeriodo() {
  const mes = Number(encMes.value);
  const ano = Number(encAno.value);
  if (!Number.isInteger(ano) || ano < ANO_MIN || ano > ANO_MAX) return null;
  return `${textoAno(ano)}-${String(mes).padStart(2, "0")}`;
}

function atualizarEncerrar() {
  const novo = lerNovoPeriodo();
  const atual = periodoAtual();
  let erro = "";
  const anoInvalido = !novo;   // ano vazio ou fora do calendário: sem mensagem, só desativa os botões
  if (!anoInvalido && novo === atual) erro = "Escolha um mês diferente do atual.";
  encErro.textContent = erro;

  encApenas.disabled = Boolean(erro) || anoInvalido;
  const posterior = Boolean(novo) && novo > atual;
  encDica.textContent = novo && !erro && !posterior
    ? "Para apagar as chamadas, o novo mês precisa ser posterior ao atual. Você pode apenas trocar o mês."
    : "";
  encLimpar.disabled = !(!erro && !anoInvalido && posterior && enc.pdfFeito && encConfirma.checked);
}

function abrirEncerrar() {
  if (!ehOed()) return;
  const atual = periodoAtual();
  const proximo = proximoPeriodo(atual);
  const r = resumoGeralDoMes();

  enc = { temFolha: modalidadesComFolha().length > 0, pdfFeito: false };
  enc.pdfFeito = !enc.temFolha;   // sem folha para gerar, não há o que guardar antes de apagar

  document.getElementById("encSub").textContent = `Mês atual: ${rotuloPeriodo(atual)}`;
  document.getElementById("encResumo").textContent = r.aulas
    ? `${r.turmas} ${r.turmas === 1 ? "turma" : "turmas"}, ${r.aulas} ${r.aulas === 1 ? "aula" : "aulas"} no mês: ${r.salvas - r.semAula} com chamada salva, ${r.semAula} sem aula e ${r.aulas - r.salvas} sem registro.`
    : "Ainda não há aulas com turmas cadastradas neste mês.";

  encMes.innerHTML = MESES.map((nome, i) => `<option value="${i + 1}">${nome}</option>`).join("");
  encMes.value = String(Number(proximo.split("-")[1]));
  encAno.value = String(Number(proximo.split("-")[0]));

  document.getElementById("encPassos").hidden = !enc.temFolha;
  document.getElementById("encPdf").hidden = !enc.temFolha;
  document.getElementById("encConfirmaTxt").textContent = enc.temFolha
    ? `Já salvei ou imprimi a folha e quero apagar as chamadas de ${rotuloPeriodo(atual)}.`
    : `Quero apagar as chamadas de ${rotuloPeriodo(atual)}.`;
  encConfirma.checked = false;
  encConfirma.disabled = !enc.pdfFeito;
  encLimpar.textContent = `Apagar chamadas de ${rotuloPeriodo(atual)} e trocar`;
  atualizarEncerrar();
  abrirModal(modalEncerrar);
}

encMes.addEventListener("change", atualizarEncerrar);
encAno.addEventListener("input", atualizarEncerrar);
encConfirma.addEventListener("change", atualizarEncerrar);
document.getElementById("encFechar").addEventListener("click", () => fecharModal(modalEncerrar));
document.getElementById("encCancelar").addEventListener("click", () => fecharModal(modalEncerrar));

document.getElementById("encPdf").addEventListener("click", () => {
  abrirPdf(() => {
    enc.pdfFeito = true;
    encConfirma.disabled = false;
    atualizarEncerrar();
  });
});

async function aplicarNovoPeriodo(apagar) {
  if (!ehOed()) return;
  const novo = lerNovoPeriodo();
  const atual = periodoAtual();
  if (!novo || novo === atual) return;
  if (apagar && !(novo > atual && enc.pdfFeito && encConfirma.checked)) return;

  encApenas.disabled = true;
  encLimpar.disabled = true;
  try {
    if (apagar) await Dados.encerrarMes(atual, novo);
    else await Dados.definirPeriodo(novo);
    [est.periodo, est.chamadas] = await Promise.all([Dados.obterPeriodo(), Dados.listarChamadas()]);
    fecharModal(modalEncerrar);
    renderTudo();
    mostrarAviso(apagar
      ? `Chamadas de ${rotuloPeriodo(atual)} apagadas. Agora o mês é ${rotuloPeriodo(novo)}.`
      : `Mês de trabalho alterado para ${rotuloPeriodo(novo)}.`);
  } catch {
    encErro.textContent = "Não foi possível trocar o mês agora. Tente novamente.";
    atualizarEncerrar();
  }
}

encApenas.addEventListener("click", () => aplicarNovoPeriodo(false));
encLimpar.addEventListener("click", () => aplicarNovoPeriodo(true));

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