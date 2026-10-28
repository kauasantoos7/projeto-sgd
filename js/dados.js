// =====================================================================
// CAMADA DE DADOS — compartilhada pelo site público e pela área admin
//
// Guarda modalidades, filtros, solicitações de vaga e contas no
// IndexedDB DO NAVEGADOR (comporta fotos sem estourar o limite).
//
// IMPORTANTE: como o site não tem servidor, esses dados existem só no
// navegador em que foram criados. Para que o que o CEO cadastra apareça
// para todos os visitantes, e para que as solicitações cheguem até o
// CEO, esta camada precisa ser trocada por um servidor/banco de dados
// (ex.: Firebase ou Supabase). Toda a API abaixo é assíncrona justamente
// para essa troca ser feita só neste arquivo.
// =====================================================================
const Dados = (() => {
  const NOME_BANCO = "del_portal";
  const LOJA = "dados";

  const memoria = {};            // plano B se o navegador bloquear o IndexedDB
  let bancoPromessa = null;
  let fila = Promise.resolve();  // garante uma gravação por vez
  let iniciando = null;

  const copia = v => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

  // ---------- IndexedDB básico ----------
  function abrirBanco() {
    if (!bancoPromessa) {
      bancoPromessa = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB indisponível"));
        const req = indexedDB.open(NOME_BANCO, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(LOJA);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return bancoPromessa;
  }

  async function ler(chave, padrao) {
    try {
      const db = await abrirBanco();
      return await new Promise((resolve, reject) => {
        const r = db.transaction(LOJA).objectStore(LOJA).get(chave);
        r.onsuccess = () => resolve(r.result === undefined ? padrao : r.result);
        r.onerror = () => reject(r.error);
      });
    } catch {
      return memoria[chave] !== undefined ? copia(memoria[chave]) : padrao;
    }
  }

  async function gravar(chave, valor) {
    try {
      const db = await abrirBanco();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOJA, "readwrite");
        tx.objectStore(LOJA).put(valor, chave);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Gravação cancelada"));
      });
    } catch (erro) {
      if (erro && (erro.name === "QuotaExceededError" || /quota/i.test(erro.message || ""))) throw erro;
      memoria[chave] = copia(valor);
    }
  }

  // lê a lista, deixa a função alterá-la e grava (uma operação por vez)
  function mutar(chave, fn) {
    const tarefa = fila.then(async () => {
      const lista = await ler(chave, []);
      const resultado = await fn(lista);
      await gravar(chave, lista);
      return resultado;
    });
    fila = tarefa.catch(() => {});
    return tarefa;
  }

  // ---------- utilidades ----------
  const novoId = prefixo => prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const normalizar = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const slug = t => normalizar(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  // ---------- dados de exemplo (primeiro acesso) ----------
  const CAF_ENDERECO = "Avenida José Bonifácio, nº 23, Centro, Regente Feijó - SP, CEP 19570-000";
  const CAF_LOCAL = "Centro de Atividade Física - Tênis Clube";

  const FILTROS_INICIAIS = [
    { id: "infantil", nome: "Infantil (06-11)" },
    { id: "sub15", nome: "Sub-15 (12-15)" },
    { id: "sub18", nome: "Sub-18 (16-18)" },
    { id: "adulto", nome: "Adulto (19-59)" },
    { id: "idade", nome: "Melhor Idade (60+)" },
    { id: "livre", nome: "Livre" }
  ];

  function modalidadesIniciais() {
    const agora = new Date().toISOString();
    const mod = (n, nome, cat, dias, local, extra = {}) => ({
      id: "m" + n, nome, cat, dias, local,
      endereco: "", descricao: "", horarios: "", professor: "", fotos: [],
      criadoEm: agora, ...extra
    });
    return [
      mod(1, "Vôlei - Sub 15", "sub15", "Terça-feira", "Ginásio de Esportes"),
      mod(2, "Karatê", "livre", "Segunda, Quarta e Sexta-feira", CAF_LOCAL, {
        endereco: CAF_ENDERECO,
        descricao: "Oferecida gratuitamente no Centro de Atividade Física (CAF), a modalidade de Karatê do Departamento de Esporte e Lazer de Regente Feijó combina desenvolvimento físico, cidadania e inclusão social para crianças, jovens e adultos. Além de cultivar disciplina, respeito e saúde na comunidade, o projeto conta com orientação técnica qualificada para preparar atletas locais que representam o município com destaque em campeonatos regionais, estaduais e nacionais.",
        horarios: "Terça-feira (Tarde)\n• 15h00 às 16h30: 09 a 13 anos\n• 17h00 às 18h00: 14 a 17 anos\n\nQuarta-feira (Manhã)\n• 09h30 às 11h00: 09 a 14 anos\n\nQuinta-feira (Tarde)\n• 15h30 às 17h00: 09 a 13 anos"
      }),
      mod(3, "Atletismo - Sub 18", "sub18", "Segunda, Quarta e Sexta-feira", CAF_LOCAL, { endereco: CAF_ENDERECO }),
      mod(4, "Vôlei - Sub 15", "sub15", "Segunda, Quarta e Sexta-feira", CAF_LOCAL, { endereco: CAF_ENDERECO }),
      mod(5, "Vôlei - Sub 15", "sub15", "Segunda, Quarta e Sexta-feira", CAF_LOCAL, { endereco: CAF_ENDERECO }),
      mod(6, "Vôlei - Sub 15", "sub15", "Segunda, Quarta e Sexta-feira", CAF_LOCAL, { endereco: CAF_ENDERECO }),
      mod(7, "Futsal - Infantil", "infantil", "Terça e Quinta-feira", "Ginásio de Esportes"),
      mod(8, "Hidroginástica", "idade", "Segunda e Quarta-feira", "Piscina Municipal"),
      mod(9, "Caminhada Orientada", "idade", "Terça e Quinta-feira", "Praça Central"),
      mod(10, "Basquete - Sub 18", "sub18", "Quarta e Sexta-feira", "Ginásio de Esportes"),
      mod(11, "Treino Funcional", "adulto", "Segunda, Quarta e Sexta-feira", CAF_LOCAL, { endereco: CAF_ENDERECO }),
      mod(12, "Natação - Infantil", "infantil", "Terça e Quinta-feira", "Piscina Municipal")
    ];
  }

  // ---------- inicialização ----------
  function iniciar() {
    if (!iniciando) {
      iniciando = (async () => {
        if (!(await ler("semeado", false))) {
          await gravar("filtros", FILTROS_INICIAIS);
          await gravar("modalidades", modalidadesIniciais());
          await gravar("semeado", true);
        }
        // traz contas criadas na versão anterior (que ficavam no localStorage)
        if ((await ler("contas", null)) === null) {
          let antigas = [];
          try { antigas = JSON.parse(localStorage.getItem("del_admin_contas")) || []; } catch { /* nada */ }
          await gravar("contas", antigas);
        }
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* nada */ }
      })();
    }
    return iniciando;
  }

  // ---------- API pública ----------
  return {
    iniciar,

    // modalidades
    async listarModalidades() { await iniciar(); return ler("modalidades", []); },
    async salvarModalidade(m) {
      await iniciar();
      return mutar("modalidades", lista => {
        const item = { ...m };
        if (!item.id) {
          item.id = novoId("m");
          item.criadoEm = new Date().toISOString();
          lista.unshift(item);                    // as novas aparecem primeiro
        } else {
          const i = lista.findIndex(x => x.id === item.id);
          if (i >= 0) lista[i] = item; else lista.unshift(item);
        }
        return item;
      });
    },
    async excluirModalidade(id) {
      await iniciar();
      return mutar("modalidades", lista => {
        const i = lista.findIndex(x => x.id === id);
        if (i >= 0) lista.splice(i, 1);
      });
    },

    // filtros (categorias), criados pelo admin
    async listarFiltros() { await iniciar(); return ler("filtros", []); },
    async criarFiltro(nome) {
      await iniciar();
      return mutar("filtros", lista => {
        const existente = lista.find(f => normalizar(f.nome) === normalizar(nome));
        if (existente) return existente;
        const base = slug(nome) || "filtro";
        let id = base, n = 2;
        while (lista.some(f => f.id === id)) id = base + "-" + n++;
        const filtro = { id, nome: String(nome).trim() };
        lista.push(filtro);
        return filtro;
      });
    },

    // solicitações de vaga
    async listarSolicitacoes() { await iniciar(); return ler("solicitacoes", []); },
    async criarSolicitacao(dados) {
      await iniciar();
      return mutar("solicitacoes", lista => {
        const item = { ...dados, id: novoId("s"), criadoEm: new Date().toISOString() };
        lista.unshift(item);
        return item;
      });
    },
    async excluirSolicitacao(id) {
      await iniciar();
      return mutar("solicitacoes", lista => {
        const i = lista.findIndex(x => x.id === id);
        if (i >= 0) lista.splice(i, 1);
      });
    },

    // contas (professores e CEO)
    async listarContas() { await iniciar(); return ler("contas", []); },
    async buscarConta(cpf) {
      const contas = await this.listarContas();
      return contas.find(c => c.cpf === cpf) || null;
    },
    async criarConta(conta) {
      await iniciar();
      return mutar("contas", lista => {
        if (lista.some(c => c.cpf === conta.cpf)) return false;
        lista.push({ cpf: conta.cpf, perfil: conta.perfil, criadoEm: conta.criadoEm || new Date().toISOString() });
        return true;
      });
    },
    async excluirConta(cpf) {
      await iniciar();
      return mutar("contas", lista => {
        const i = lista.findIndex(c => c.cpf === cpf);
        if (i >= 0) lista.splice(i, 1);
      });
    }
  };
})();