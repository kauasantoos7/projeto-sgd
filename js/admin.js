// =====================================================================
// ÁREA ADMINISTRATIVA — login, cadastro e painel do CEO
//
// SENHAS DE CADASTRO: só existem 2. A senha define o perfil da conta:
//   professor -> edita apenas a sua modalidade
//   ceo       -> edita e exclui qualquer coisa em qualquer modalidade
// Qualquer outra senha é recusada no cadastro.
//
// ATENÇÃO: este arquivo roda no navegador, então tudo aqui (inclusive as
// senhas) pode ser visto por quem abrir o site. Serve para montar e
// testar as telas. Para proteger de verdade, a validação precisa ir para
// um servidor. Os dados (contas, modalidades, solicitações) ficam em
// js/dados.js, isolados para facilitar essa troca.
// =====================================================================
const SENHAS = {
  professor: "profdelprefeiturarf00",
  ceo: "ceodelprefeiturarf00"
};

const NOME_PERFIL = { professor: "Professor", ceo: "CEO" };
const PERMISSAO = {
  professor: "Você pode editar apenas a sua modalidade.",
  ceo: "Você pode editar e excluir qualquer modalidade."
};

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

function cpfParcial(cpf) {
  return `${cpf.slice(0, 3)}.***.***-${cpf.slice(9)}`;
}

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

async function cadastrar(cpf, senha) {
  if (!cpfValido(cpf)) return { ok: false, erro: "CPF inválido. Confira os números." };
  if (!senha) return { ok: false, erro: "Informe a senha." };

  const perfil = perfilPelaSenha(senha);
  if (!perfil) return { ok: false, erro: "Senha não reconhecida." };

  try {
    const criou = await Dados.criarConta({ cpf, perfil });
    if (!criou) return { ok: false, erro: "Este CPF já está cadastrado. Acesse a sua conta." };
    return { ok: true };
  } catch {
    return { ok: false, erro: "Não foi possível salvar o cadastro neste navegador." };
  }
}

async function autenticar(cpf, senha) {
  const erroGenerico = { ok: false, erro: "CPF ou senha incorretos." };
  if (!cpfValido(cpf) || !senha) return erroGenerico;

  try {
    const conta = await Dados.buscarConta(cpf);
    const perfilDigitado = perfilPelaSenha(senha);
    if (!conta || !perfilDigitado || conta.perfil !== perfilDigitado) return erroGenerico;
    return { ok: true, conta: { cpf: conta.cpf, perfil: conta.perfil } };
  } catch {
    return { ok: false, erro: "Não foi possível acessar os dados neste navegador." };
  }
}

// ===== SESSÃO =====
function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO)); }
  catch { return null; }
}
function salvarSessao(conta) {
  try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(conta)); } catch { /* ignora */ }
}
function limparSessao() {
  try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* ignora */ }
}

// ===== ELEMENTOS =====
const telaAcesso = document.getElementById("telaAcesso");
const telaPainel = document.getElementById("telaPainel");
const telaCeo = document.getElementById("telaCeo");
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
  telaPainel.hidden = qual !== "professor";
  telaCeo.hidden = qual !== "ceo";
  document.body.classList.toggle("acesso", qual !== "ceo");
  window.scrollTo(0, 0);
}

function mostrarAcesso(qual, focar) {
  trocarTela("acesso");
  formLogin.hidden = qual !== "login";
  formCadastro.hidden = qual !== "cadastro";
  mostrarMsg(msgLogin, "");
  mostrarMsg(msgCadastro, "");
  marcarErro(formLogin, false);
  marcarErro(formCadastro, false);
  document.title = (qual === "login" ? "Login" : "Cadastro") + " — Acesso Administrativo DEL";
  // no celular não foca sozinho, para o teclado não abrir sem a pessoa tocar no campo
  if (focar && !window.matchMedia("(pointer: coarse)").matches) {
    document.getElementById(qual === "login" ? "loginCpf" : "cadCpf").focus();
  }
}

function mostrarPainelProfessor(conta) {
  trocarTela("professor");
  document.title = "Painel do Professor — DEL";
  document.getElementById("painelOla").textContent =
    `Bem-vindo(a)! Você entrou como ${NOME_PERFIL[conta.perfil]} (CPF ${cpfParcial(conta.cpf)}).`;
  document.getElementById("painelPermissao").textContent = PERMISSAO[conta.perfil];
}

async function entrarNaArea(conta) {
  if (conta.perfil === "ceo") await iniciarCeo(conta);
  else mostrarPainelProfessor(conta);
}

async function rotear(focar) {
  const sessao = lerSessao();
  if (sessao) {
    let conta = null;
    try { conta = await Dados.buscarConta(sessao.cpf); } catch { /* segue para o login */ }
    if (conta && conta.perfil === sessao.perfil) {
      await entrarNaArea({ cpf: conta.cpf, perfil: conta.perfil });
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
  const cpf = soDigitos(document.getElementById("cadCpf").value);
  const senha = document.getElementById("cadSenha").value.trim();
  const botao = formCadastro.querySelector(".btn");

  botao.disabled = true;
  try {
    const r = await cadastrar(cpf, senha);
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

// ===== SAIR =====
function sair() {
  limparSessao();
  location.hash = "#login";
  mostrarAcesso("login", false);
}
document.getElementById("btnSair").addEventListener("click", sair);
document.getElementById("btnSairCeo").addEventListener("click", sair);

// =====================================================================
// PAINEL DO CEO
// =====================================================================
const est = {
  conta: null,
  aba: "modalidades",
  pag: { modalidades: 1, solicitacoes: 1, usuarios: 1 },
  modalidades: [],
  filtros: [],
  solicitacoes: [],
  contas: []
};

async function carregarDados() {
  const [m, f, s, c] = await Promise.all([
    Dados.listarModalidades(),
    Dados.listarFiltros(),
    Dados.listarSolicitacoes(),
    Dados.listarContas()
  ]);
  est.modalidades = m;
  est.filtros = f;
  est.solicitacoes = s;
  est.contas = c;
}

async function iniciarCeo(conta) {
  est.conta = conta;
  est.aba = "modalidades";
  est.pag = { modalidades: 1, solicitacoes: 1, usuarios: 1 };
  trocarTela("ceo");
  document.title = "Painel do CEO — DEL";
  try {
    await carregarDados();
  } catch {
    mostrarAviso("Não foi possível carregar os dados neste navegador.");
  }
  renderTudo();
}

const ICONE_EDITAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
const ICONE_EXCLUIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>';

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

function renderAbas() {
  document.querySelectorAll(".adm-aba").forEach(b => {
    const ativa = b.dataset.aba === est.aba;
    b.classList.toggle("ativa", ativa);
    b.setAttribute("aria-selected", ativa);
  });
  document.getElementById("abaModalidades").hidden = est.aba !== "modalidades";
  document.getElementById("abaSolicitacoes").hidden = est.aba !== "solicitacoes";
  document.getElementById("abaUsuarios").hidden = est.aba !== "usuarios";

  const badge = document.getElementById("badgeSolic");
  badge.hidden = est.solicitacoes.length === 0;
  badge.textContent = est.solicitacoes.length;
}

function renderModalidades() {
  const el = document.getElementById("admCards");
  const pagina = paginar(est.modalidades, "modalidades", document.getElementById("pagModalidades"));

  if (pagina.length === 0) {
    el.innerHTML = '<p class="vazio">Nenhuma modalidade cadastrada. Clique em “Nova Modalidade” para começar.</p>';
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
      <div class="adm-card-acoes">
        <button type="button" class="adm-btn-card" data-acao="editar" data-id="${esc(m.id)}">${ICONE_EDITAR} Editar</button>
        <button type="button" class="adm-btn-card" data-acao="excluir-mod" data-id="${esc(m.id)}">${ICONE_EXCLUIR} Excluir</button>
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
    return `
    <article class="adm-item">
      <div class="adm-item-topo">
        <h3>CPF ${esc(mascaraCPF(c.cpf))}</h3>
        <span class="adm-tag">${esc(NOME_PERFIL[c.perfil] || c.perfil)}</span>
      </div>
      <p class="adm-data">Cadastrado em ${esc(formatarData(c.criadoEm))}</p>
      <div class="adm-item-acoes">
        <button type="button" class="adm-btn-card" data-acao="excluir-conta" data-cpf="${esc(c.cpf)}" ${propria ? "disabled" : ""}>
          ${propria ? "Conta atual" : ICONE_EXCLUIR + " Excluir"}
        </button>
      </div>
    </article>`;
  }).join("");
}

function renderTudo() {
  renderAbas();
  renderModalidades();
  renderSolicitacoes();
  renderUsuarios();
}

// ===== MODAIS (abrir / fechar) =====
const modalForm = document.getElementById("modalModalidade");
const modalConfirmar = document.getElementById("modalConfirmar");

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
  else if (modalForm.classList.contains("aberto")) fecharModal(modalForm);
});

// ===== FORMULÁRIO: NOVA / EDITAR MODALIDADE =====
const formMod = document.getElementById("formModalidade");
const fCat = document.getElementById("fCat");
const boxNovoFiltro = document.getElementById("boxNovoFiltro");
const fErro = document.getElementById("fErro");
const fArquivos = document.getElementById("fArquivos");
const btnFotos = document.getElementById("btnFotos");
let editandoId = null;
let fotosForm = [];

function montarSelectCategorias(selecionado) {
  const opcoes = ['<option value="">Selecione…</option>']
    .concat(est.filtros.map(f => `<option value="${esc(f.id)}">${esc(f.nome)}</option>`))
    .concat(['<option value="__novo__">➕ Criar novo filtro…</option>']);
  fCat.innerHTML = opcoes.join("");
  fCat.value = selecionado || (est.filtros.length ? "" : "__novo__");
  boxNovoFiltro.hidden = fCat.value !== "__novo__";
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
  document.getElementById("fNovoFiltro").value = "";

  montarSelectCategorias(m ? m.cat : "");
  fotosForm = m ? (m.fotos || []).slice(0, MAX_FOTOS) : [];
  renderFotosForm();

  abrirModal(modalForm);
  modalForm.scrollTop = 0;
  setTimeout(() => document.getElementById("fNome").focus(), 50);
}

fCat.addEventListener("change", () => {
  boxNovoFiltro.hidden = fCat.value !== "__novo__";
  if (!boxNovoFiltro.hidden) document.getElementById("fNovoFiltro").focus();
});

formMod.addEventListener("input", () => { fErro.textContent = ""; });

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

  const faltando = Object.keys(rotulos).filter(k => !campos[k]).map(k => rotulos[k]);
  let catId = fCat.value;
  const nomeNovoFiltro = v("fNovoFiltro");

  if (catId === "__novo__") { if (!nomeNovoFiltro) faltando.push("Nome do novo filtro"); }
  else if (!catId) faltando.push("Categoria (filtro)");

  if (faltando.length) {
    fErro.textContent = "Preencha: " + faltando.join(", ") + ".";
    return;
  }

  const botao = document.getElementById("formSalvar");
  botao.disabled = true;
  try {
    if (catId === "__novo__") {
      const filtro = await Dados.criarFiltro(nomeNovoFiltro);
      catId = filtro.id;
    }
    const base = editandoId ? est.modalidades.find(x => x.id === editandoId) || {} : {};
    await Dados.salvarModalidade({ ...base, ...campos, cat: catId, fotos: fotosForm.slice(0, MAX_FOTOS) });

    [est.modalidades, est.filtros] = await Promise.all([Dados.listarModalidades(), Dados.listarFiltros()]);
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
telaCeo.addEventListener("click", async e => {
  // abas
  const aba = e.target.closest("[data-aba]");
  if (aba) {
    est.aba = aba.dataset.aba;
    renderAbas();
    return;
  }

  // paginação
  const pag = e.target.closest(".paginacao button");
  if (pag && !pag.disabled) {
    est.pag[pag.parentElement.dataset.chave] = Number(pag.dataset.p);
    renderTudo();
    document.querySelector(".adm-abas").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  // nova modalidade
  if (e.target.closest("#btnNova")) { abrirFormModalidade(null); return; }

  // ações dos botões
  const btn = e.target.closest("[data-acao]");
  if (!btn || btn.disabled) return;
  const acao = btn.dataset.acao;

  try {
    if (acao === "editar") {
      const m = est.modalidades.find(x => x.id === btn.dataset.id);
      if (m) abrirFormModalidade(m);

    } else if (acao === "excluir-mod") {
      const m = est.modalidades.find(x => x.id === btn.dataset.id);
      if (!m) return;
      const ok = await confirmar({
        titulo: "Excluir modalidade",
        texto: `Tem certeza que deseja excluir “${m.nome}”? Esta ação não pode ser desfeita.`
      });
      if (!ok) return;
      await Dados.excluirModalidade(m.id);
      est.modalidades = await Dados.listarModalidades();
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

    } else if (acao === "excluir-conta") {
      const c = est.contas.find(x => x.cpf === btn.dataset.cpf);
      if (!c) return;
      if (est.conta && c.cpf === est.conta.cpf) {
        mostrarAviso("Você não pode excluir a conta com a qual está logado.");
        return;
      }
      const ok = await confirmar({
        titulo: "Excluir conta",
        texto: `Excluir a conta de ${NOME_PERFIL[c.perfil] || c.perfil} com CPF ${mascaraCPF(c.cpf)}? Essa pessoa não conseguirá mais entrar.`
      });
      if (!ok) return;
      await Dados.excluirConta(c.cpf);
      est.contas = await Dados.listarContas();
      renderTudo();
      mostrarAviso("Conta excluída.");
    }
  } catch {
    mostrarAviso("Não foi possível concluir a ação. Tente novamente.");
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