// =====================================================================
// SUPABASE — camada de dados e de acesso (substitui o js/dados.js)
//
// Mantém EXATAMENTE a mesma API do dados.js (Dados.listarModalidades(),
// Dados.salvarTurma()...), então script.js e a maior parte do admin.js
// continuam iguais. A diferença é que agora tudo fica no banco e quem
// decide quem pode ler ou gravar o quê é o BANCO (regras RLS do setup.sql),
// e não este JavaScript.
//
// SEGURANÇA — o que vale a pena saber:
//   * A chave abaixo é a chave PUBLICÁVEL: ela foi feita para ficar no
//     site e, sozinha, não dá acesso a nada além do que o setup.sql libera.
//   * NUNCA coloque aqui a chave "secret" / "service_role". Quem tiver
//     essa chave ignora todas as regras de segurança.
//   * Senhas não passam por aqui: vão direto ao Supabase Auth (hash bcrypt).
//   * O login é por CPF: o CPF vira um e-mail técnico "CPF@DOMINIO_LOGIN".
//   * A sessão fica no sessionStorage: fechar a aba/navegador encerra o acesso.
// =====================================================================
const Dados = (() => {
  "use strict";

  const SUPABASE_URL = "https://vmvvhskgukgqnmqtgjuv.supabase.co";
  const SUPABASE_CHAVE_PUBLICA = "sb_publishable_WPvHiOpSJAoaYvJxU-2uyg_kKDmCfw7";

  // Precisa ser igual ao privado.dominio_login() do setup.sql.
  const DOMINIO_LOGIN = "regentefeijo.sp.gov.br";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("A biblioteca do Supabase não carregou. Confira o <script> do supabase-js nesta página.");
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.sessionStorage,
      storageKey: "del-rf-auth"
    }
  });

  // ---------- utilitários ----------
  const normalizar = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const slug = t => normalizar(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const texto = (v, max) => String(v == null ? "" : v).slice(0, max);
  const idValido = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  // a mensagem técnica fica só no console; quem usa o site vê as mensagens da própria tela
  function falha(error) {
    console.error("[Supabase]", error);
    const e = new Error(error && error.message ? error.message : "Erro ao falar com o banco de dados.");
    e.code = error && error.code;
    e.status = error && error.status;
    return e;
  }

  // lê tudo de uma tabela em páginas de 1000 linhas (limite padrão da API)
  async function lerTudo(montar) {
    const TAM = 1000;
    const todas = [];
    for (let de = 0; ; de += TAM) {
      const { data, error } = await montar().range(de, de + TAM - 1);
      if (error) throw falha(error);
      todas.push(...data);
      if (data.length < TAM) break;
    }
    return todas;
  }

  // ---------- conversão banco <-> site ----------
  const deModalidade = r => ({
    id: r.id, nome: r.nome, cat: r.cat || "", dias: r.dias, local: r.local, endereco: r.endereco,
    descricao: r.descricao, horarios: r.horarios, professor: r.professor,
    fotos: Array.isArray(r.fotos) ? r.fotos : [], agenda: Array.isArray(r.agenda) ? r.agenda : [],
    criadoEm: r.criado_em
  });
  const paraModalidade = m => ({
    nome: texto(m.nome, 120).trim(),
    cat: m.cat || null,
    dias: texto(m.dias, 200),
    local: texto(m.local, 200),
    endereco: texto(m.endereco, 250),
    descricao: texto(m.descricao, 3000),
    horarios: texto(m.horarios, 500),
    professor: texto(m.professor, 120),
    fotos: Array.isArray(m.fotos) ? m.fotos : [],
    agenda: Array.isArray(m.agenda) ? m.agenda : []
  });

  const deTurma = r => ({ id: r.id, modalidadeId: r.modalidade_id, nome: r.nome, slotIds: r.slot_ids || [], criadoEm: r.criado_em });
  const deAluno = r => ({ id: r.id, turmaId: r.turma_id, nome: r.nome, criadoEm: r.criado_em });
  const deChamada = r => ({
    id: r.id, turmaId: r.turma_id, slotId: r.slot_id, data: r.data, presentes: r.presentes || [],
    justificadas: r.justificadas || {}, semAula: r.sem_aula, motivo: r.motivo, total: r.total,
    atualizadoEm: r.atualizado_em
  });
  const deSolicitacao = r => ({
    id: r.id, modalidadeId: r.modalidade_id || "", modalidadeNome: r.modalidade_nome, nome: r.nome,
    idade: r.idade, telefone: r.telefone, disponibilidade: r.disponibilidade, criadoEm: r.criado_em
  });
  const deConta = r => ({
    cpf: r.cpf, perfil: r.perfil, nome: r.nome || "", modalidadesIds: r.modalidades_ids || [], criadoEm: r.criado_em
  });

  // ---------- acesso (login e cadastro) ----------
  const emailDoCpf = cpf => `${String(cpf).replace(/\D/g, "")}@${DOMINIO_LOGIN}`;

  const MENSAGENS_CADASTRO = {
    codigo_invalido: "Código de acesso inválido.",
    bloqueado: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
    ja_cadastrado: "Este CPF já está cadastrado. Volte e acesse a sua conta.",
    nome_invalido: "Informe o nome completo.",
    cpf_invalido: "CPF inválido.",
    nao_autenticado: "Não foi possível concluir o cadastro. Tente novamente."
  };

  async function perfilDe(userId) {
    const { data, error } = await sb.from("perfis").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw falha(error);
    return data ? deConta(data) : null;
  }

  const auth = {
    // cria o login e, em seguida, o perfil (só nasce se o código de acesso estiver certo)
    async cadastrar({ nome, cpf, senha, codigo }) {
      const email = emailDoCpf(cpf);
      let sessao = null;

      const criado = await sb.auth.signUp({ email, password: senha });
      if (criado.error) {
        const jaExiste = criado.error.code === "user_already_exists" || /already|registered/i.test(criado.error.message || "");
        if (!jaExiste) {
          console.error("[Supabase]", criado.error);
          if (criado.error.status === 429) return { ok: false, erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." };
          if (criado.error.code === "weak_password") return { ok: false, erro: "Senha fraca. Use pelo menos 10 caracteres, com letras e números." };
          return { ok: false, erro: "Não foi possível criar o acesso agora. Tente novamente." };
        }
        // o login já existia (ex.: cadastro anterior sem o código certo): continua se a senha for a mesma
        const entrou = await sb.auth.signInWithPassword({ email, password: senha });
        if (entrou.error) return { ok: false, erro: "Este CPF já possui acesso. Use a senha cadastrada ou peça ajuda ao OED." };
        sessao = entrou.data.session;
      } else {
        sessao = criado.data.session;
      }

      if (!sessao) {
        // com a confirmação por e-mail ligada o Supabase não devolve a sessão
        return { ok: false, erro: "Cadastro indisponível no momento. Avise o administrador do site." };
      }

      const { data: status, error } = await sb.rpc("registrar_perfil", {
        p_codigo: String(codigo || ""), p_nome: String(nome || ""), p_cpf: String(cpf).replace(/\D/g, "")
      });
      await sb.auth.signOut();   // o site volta para a tela de login, como antes
      if (error) { console.error("[Supabase]", error); return { ok: false, erro: "Não foi possível concluir o cadastro agora." }; }
      if (status !== "ok") return { ok: false, erro: MENSAGENS_CADASTRO[status] || "Não foi possível concluir o cadastro." };
      return { ok: true };
    },

    async entrar(cpf, senha) {
      const { data, error } = await sb.auth.signInWithPassword({ email: emailDoCpf(cpf), password: senha });
      if (error) {
        if (error.status === 429) return { ok: false, erro: "Muitas tentativas. Aguarde alguns minutos e tente de novo." };
        // mesma resposta para "CPF não existe" e "senha errada": não revela quais CPFs têm conta
        return { ok: false, erro: "CPF ou senha incorretos." };
      }
      const conta = await perfilDe(data.user.id);
      if (!conta) {
        await sb.auth.signOut();
        return { ok: false, erro: "Este acesso ainda não tem permissão. Faça o cadastro com o código de acesso." };
      }
      return { ok: true, conta };
    },

    // confirma a sessão NO SERVIDOR (não confia só no que está guardado no navegador)
    async contaAtual() {
      const { data, error } = await sb.auth.getUser();
      if (error || !data || !data.user) return null;
      return perfilDe(data.user.id);
    },

    async sair() {
      try { await sb.auth.signOut(); } catch { /* sem rede: a sessão local é apagada mesmo assim */ }
    },

    aoSair(funcao) {
      sb.auth.onAuthStateChange(evento => { if (evento === "SIGNED_OUT") funcao(); });
    }
  };

  // ---------- API de dados (mesmos nomes do antigo dados.js) ----------
  return {
    auth,
    async iniciar() { /* nada a preparar: o banco já existe */ },

    // ----- modalidades -----
    async listarModalidades() {
      const linhas = await lerTudo(() => sb.from("modalidades").select("*").order("criado_em", { ascending: false }));
      return linhas.map(deModalidade);
    },
    async salvarModalidade(m) {
      const linha = paraModalidade(m);
      const consulta = m.id
        ? sb.from("modalidades").update(linha).eq("id", m.id)
        : sb.from("modalidades").insert(linha);
      const { data, error } = await consulta.select().single();
      if (error) throw falha(error);
      return deModalidade(data);
    },
    async excluirModalidade(id) {
      const { error } = await sb.from("modalidades").delete().eq("id", id);
      if (error) throw falha(error);
    },

    // ----- filtros -----
    async listarFiltros() {
      const { data, error } = await sb.from("filtros").select("id, nome").order("ordem", { ascending: true });
      if (error) throw falha(error);
      return data;
    },
    async criarFiltro(nome) {
      const limpo = texto(nome, 60).trim();
      const lista = await this.listarFiltros();
      const existente = lista.find(f => normalizar(f.nome) === normalizar(limpo));
      if (existente) return existente;
      const base = slug(limpo).slice(0, 50) || "filtro";
      let id = base, n = 2;
      while (lista.some(f => f.id === id)) id = base + "-" + n++;
      const { data, error } = await sb.from("filtros").insert({ id, nome: limpo }).select("id, nome").single();
      if (error) throw falha(error);
      return data;
    },
    async renomearFiltro(id, nome) {
      const limpo = texto(nome, 60).trim();
      const lista = await this.listarFiltros();
      if (!lista.some(f => f.id === id)) return { ok: false, erro: "Filtro não encontrado." };
      if (lista.some(f => f.id !== id && normalizar(f.nome) === normalizar(limpo))) {
        return { ok: false, erro: "Já existe um filtro com esse nome." };
      }
      const { error } = await sb.from("filtros").update({ nome: limpo }).eq("id", id);
      if (error) throw falha(error);
      return { ok: true };
    },
    async excluirFiltro(id) {
      const { error } = await sb.from("filtros").delete().eq("id", id);   // modalidades ligadas ficam sem categoria
      if (error) throw falha(error);
    },

    // ----- solicitações de vaga (visitante só envia; só o OED lê) -----
    async listarSolicitacoes() {
      const linhas = await lerTudo(() => sb.from("solicitacoes").select("*").order("criado_em", { ascending: false }));
      return linhas.map(deSolicitacao);
    },
    async criarSolicitacao(d) {
      const linha = {
        modalidade_id: idValido(d.modalidadeId) ? d.modalidadeId : null,
        modalidade_nome: texto(d.modalidadeNome, 120),
        nome: texto(d.nome, 120).trim(),
        idade: Number(d.idade),
        telefone: texto(d.telefone, 20).trim(),
        disponibilidade: texto(d.disponibilidade, 500).trim()
      };
      // sem .select(): o visitante não tem (e não deve ter) permissão para ler solicitações
      const { error } = await sb.from("solicitacoes").insert(linha);
      if (error) throw falha(error);
      return { ...d, criadoEm: new Date().toISOString() };
    },
    async excluirSolicitacao(id) {
      const { error } = await sb.from("solicitacoes").delete().eq("id", id);
      if (error) throw falha(error);
    },

    // ----- contas (perfis) -----
    async listarContas() {
      const { data, error } = await sb.from("perfis").select("*").order("criado_em", { ascending: true });
      if (error) throw falha(error);
      return data.map(deConta);
    },
    async buscarConta(cpf) {
      const { data, error } = await sb.from("perfis").select("*").eq("cpf", String(cpf).replace(/\D/g, "")).maybeSingle();
      if (error) throw falha(error);
      return data ? deConta(data) : null;
    },
    async atualizarConta(cpf, campos) {
      if (Object.prototype.hasOwnProperty.call(campos, "modalidadesIds")) {
        const ids = (campos.modalidadesIds || []).filter(idValido);
        const { data, error } = await sb.from("perfis").update({ modalidades_ids: ids })
          .eq("cpf", String(cpf).replace(/\D/g, "")).select("cpf");
        if (error) throw falha(error);
        if (!data.length) throw falha({ message: "Sem permissão para alterar esta conta." });
      }
      if (Object.prototype.hasOwnProperty.call(campos, "nome")) {
        const { error } = await sb.rpc("atualizar_meu_nome", { p_nome: String(campos.nome || "") });
        if (error) throw falha(error);
      }
      return true;
    },
    async excluirConta(cpf) {
      const { error } = await sb.rpc("excluir_usuario", { p_cpf: String(cpf).replace(/\D/g, "") });
      if (error) throw falha(error);
    },

    // ----- turmas, alunos e chamadas -----
    async listarTurmas() {
      const linhas = await lerTudo(() => sb.from("turmas").select("*").order("criado_em", { ascending: true }));
      return linhas.map(deTurma);
    },
    async salvarTurma(t) {
      const linha = {
        modalidade_id: t.modalidadeId,
        nome: texto(t.nome, 80).trim(),
        slot_ids: Array.isArray(t.slotIds) ? t.slotIds.map(String) : []
      };
      const consulta = t.id
        ? sb.from("turmas").update(linha).eq("id", t.id)
        : sb.from("turmas").insert(linha);
      const { data, error } = await consulta.select().single();
      if (error) throw falha(error);
      return deTurma(data);
    },
    async excluirTurma(id) {
      const { error } = await sb.from("turmas").delete().eq("id", id);   // alunos e chamadas saem junto
      if (error) throw falha(error);
    },

    async listarAlunos() {
      const linhas = await lerTudo(() => sb.from("alunos").select("*").order("criado_em", { ascending: true }));
      return linhas.map(deAluno);
    },
    async salvarAluno(a) {
      const linha = { turma_id: a.turmaId, nome: texto(a.nome, 120).trim() };
      const consulta = a.id
        ? sb.from("alunos").update(linha).eq("id", a.id)
        : sb.from("alunos").insert(linha);
      const { data, error } = await consulta.select().single();
      if (error) throw falha(error);
      return deAluno(data);
    },
    async excluirAluno(id) {
      const { error } = await sb.from("alunos").delete().eq("id", id);
      if (error) throw falha(error);
    },

    async listarChamadas() {
      const linhas = await lerTudo(() => sb.from("chamadas").select("*").order("data", { ascending: true }));
      return linhas.map(deChamada);
    },
    // uma chamada por turma, horário (slotId) e dia: salvar de novo atualiza a anterior
    async salvarChamada(c) {
      const linha = {
        turma_id: c.turmaId,
        slot_id: String(c.slotId),
        data: c.data,
        presentes: Array.isArray(c.presentes) ? c.presentes : [],
        justificadas: c.justificadas && typeof c.justificadas === "object" ? c.justificadas : {},
        sem_aula: Boolean(c.semAula),
        motivo: texto(c.motivo, 300),
        total: Math.max(0, Math.min(500, Number(c.total) || 0))
      };
      const { data, error } = await sb.from("chamadas")
        .upsert(linha, { onConflict: "turma_id,slot_id,data" }).select().single();
      if (error) throw falha(error);
      return deChamada(data);
    },

    // ----- mês de trabalho -----
    async obterPeriodo() {
      const { data, error } = await sb.from("config").select("periodo").eq("id", true).single();
      if (error) throw falha(error);
      return data.periodo;
    },
    async definirPeriodo(periodo) {
      const { error } = await sb.rpc("definir_periodo", { p_periodo: periodo });
      if (error) throw falha(error);
    },
    async encerrarMes(periodoAtual, novoPeriodo) {
      const { error } = await sb.rpc("encerrar_mes", { p_atual: periodoAtual, p_novo: novoPeriodo });
      if (error) throw falha(error);
    }
  };
})();