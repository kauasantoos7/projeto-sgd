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

  const memoria = {};            // usado só se o navegador não tiver IndexedDB
  const temIndexedDB = typeof indexedDB !== "undefined";
  let bancoPromessa = null;
  let fila = Promise.resolve();  // garante uma gravação por vez
  let iniciando = null;

  const copia = v => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

  // ---------- IndexedDB básico ----------
  function abrirBanco() {
    if (!bancoPromessa) {
      bancoPromessa = new Promise((resolve, reject) => {
        const req = indexedDB.open(NOME_BANCO, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(LOJA);
        req.onsuccess = () => {
          const db = req.result;
          // se outra aba fechar/atualizar o banco, esta reabre na próxima operação
          db.onversionchange = () => { db.close(); bancoPromessa = null; };
          db.onclose = () => { bancoPromessa = null; };
          resolve(db);
        };
        req.onerror = () => reject(req.error);
      });
      bancoPromessa.catch(() => { bancoPromessa = null; });   // permite tentar de novo
    }
    return bancoPromessa;
  }

  // Se o banco responder com erro, o erro sobe até a tela (que avisa a pessoa).
  // Nada de "plano B" silencioso: ele deixava leitura e gravação em lugares diferentes.
  async function ler(chave, padrao) {
    if (!temIndexedDB) return memoria[chave] !== undefined ? copia(memoria[chave]) : padrao;
    const db = await abrirBanco();
    return new Promise((resolve, reject) => {
      const r = db.transaction(LOJA).objectStore(LOJA).get(chave);
      r.onsuccess = () => resolve(r.result === undefined ? padrao : r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function gravar(chave, valor) {
    if (!temIndexedDB) { memoria[chave] = copia(valor); return; }
    const db = await abrirBanco();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOJA, "readwrite");
      tx.objectStore(LOJA).put(valor, chave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Gravação cancelada"));
    });
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

  // apaga turmas (e, junto, os alunos e as chamadas delas)
  async function removerTurmas(deveRemover) {
    const ids = [];
    await mutar("turmas", lista => {
      for (let i = lista.length - 1; i >= 0; i--) {
        if (deveRemover(lista[i])) { ids.push(lista[i].id); lista.splice(i, 1); }
      }
    });
    if (!ids.length) return;
    await mutar("alunos", lista => {
      for (let i = lista.length - 1; i >= 0; i--) if (ids.includes(lista[i].turmaId)) lista.splice(i, 1);
    });
    await mutar("chamadas", lista => {
      for (let i = lista.length - 1; i >= 0; i--) if (ids.includes(lista[i].turmaId)) lista.splice(i, 1);
    });
  }

  // Versão anterior: a turma tinha dias + horário próprios. Agora a modalidade tem a
  // agenda (dias e horários das aulas) e a turma escolhe os horários dela (slotIds).
  async function migrarTurmas() {
    const turmas = await ler("turmas", []);
    const antigas = turmas.filter(t => !Array.isArray(t.slotIds));
    if (!antigas.length) return;

    const modalidades = await ler("modalidades", []);
    for (const t of antigas) {
      const m = modalidades.find(x => x.id === t.modalidadeId);
      t.slotIds = [];
      if (m && Array.isArray(t.dias) && t.inicio && t.fim) {
        m.agenda = Array.isArray(m.agenda) ? m.agenda : [];
        for (const dia of t.dias) {
          let slot = m.agenda.find(s => s.dia === dia && s.inicio === t.inicio && s.fim === t.fim);
          if (!slot) { slot = { id: novoId("h"), dia, inicio: t.inicio, fim: t.fim }; m.agenda.push(slot); }
          t.slotIds.push(slot.id);
        }
      }
      delete t.dias; delete t.inicio; delete t.fim;
    }

    // chamadas antigas (sem horário) passam a apontar para o horário da turma naquele dia da semana
    const chamadas = await ler("chamadas", []);
    chamadas.forEach(c => {
      if (c.slotId !== undefined) return;
      const t = turmas.find(x => x.id === c.turmaId);
      const m = t && modalidades.find(x => x.id === t.modalidadeId);
      const [a, mes, d] = String(c.data).split("-").map(Number);
      const dow = new Date(a, mes - 1, d).getDay();
      const slot = m && (m.agenda || []).find(s => t.slotIds.includes(s.id) && s.dia === dow);
      c.slotId = slot ? slot.id : "";
    });

    await gravar("modalidades", modalidades);
    await gravar("turmas", turmas);
    await gravar("chamadas", chamadas);
  }

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
      endereco: "", descricao: "", horarios: "", professor: "", fotos: [], agenda: [],
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
        // traz UMA vez as contas da versão antiga (que ficavam no localStorage) e apaga essa cópia,
        // para que contas já excluídas nunca voltem a ser importadas
        if ((await ler("contas", undefined)) === undefined) {
          let antigas = [];
          try { antigas = JSON.parse(localStorage.getItem("del_admin_contas")) || []; } catch { /* nada */ }
          await gravar("contas", antigas);
        }
        try { localStorage.removeItem("del_admin_contas"); } catch { /* nada */ }
        try { await migrarTurmas(); } catch { /* segue sem migrar */ }
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* nada */ }
      })();
      iniciando.catch(() => { iniciando = null; });   // se falhar, a próxima chamada tenta de novo
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
      await mutar("modalidades", lista => {
        const i = lista.findIndex(x => x.id === id);
        if (i >= 0) lista.splice(i, 1);
      });
      // tira a modalidade da lista dos professores que podiam editá-la
      await mutar("contas", lista => {
        lista.forEach(c => {
          if (Array.isArray(c.modalidadesIds)) c.modalidadesIds = c.modalidadesIds.filter(x => x !== id);
        });
      });
      await removerTurmas(t => t.modalidadeId === id);
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

    async renomearFiltro(id, nome) {
      await iniciar();
      return mutar("filtros", lista => {
        const filtro = lista.find(f => f.id === id);
        if (!filtro) return { ok: false, erro: "Filtro não encontrado." };
        if (lista.some(f => f.id !== id && normalizar(f.nome) === normalizar(nome))) {
          return { ok: false, erro: "Já existe um filtro com esse nome." };
        }
        filtro.nome = String(nome).trim();   // o id continua o mesmo, então as modalidades seguem ligadas
        return { ok: true };
      });
    },
    async excluirFiltro(id) {
      await iniciar();
      await mutar("filtros", lista => {
        const i = lista.findIndex(f => f.id === id);
        if (i >= 0) lista.splice(i, 1);
      });
      // as modalidades que usavam o filtro ficam sem categoria
      await mutar("modalidades", lista => {
        lista.forEach(m => { if (m.cat === id) m.cat = ""; });
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

    // turmas, alunos e chamadas (área do professor)
    async listarTurmas() { await iniciar(); return ler("turmas", []); },
    async salvarTurma(t) {
      await iniciar();
      return mutar("turmas", lista => {
        const item = { ...t };
        if (!item.id) { item.id = novoId("t"); item.criadoEm = new Date().toISOString(); lista.push(item); }
        else {
          const i = lista.findIndex(x => x.id === item.id);
          if (i >= 0) lista[i] = item; else lista.push(item);
        }
        return item;
      });
    },
    async excluirTurma(id) {
      await iniciar();
      await removerTurmas(t => t.id === id);
    },

    async listarAlunos() { await iniciar(); return ler("alunos", []); },
    async salvarAluno(a) {
      await iniciar();
      return mutar("alunos", lista => {
        const item = { ...a };
        if (!item.id) { item.id = novoId("a"); item.criadoEm = new Date().toISOString(); lista.push(item); }
        else {
          const i = lista.findIndex(x => x.id === item.id);
          if (i >= 0) lista[i] = item; else lista.push(item);
        }
        return item;
      });
    },
    async excluirAluno(id) {
      await iniciar();
      return mutar("alunos", lista => {
        const i = lista.findIndex(x => x.id === id);
        if (i >= 0) lista.splice(i, 1);
      });
    },

    async listarChamadas() { await iniciar(); return ler("chamadas", []); },
    // uma chamada por turma, horário (slotId) e dia: salvar de novo atualiza a anterior
    async salvarChamada(c) {
      await iniciar();
      return mutar("chamadas", lista => {
        const agora = new Date().toISOString();
        const dados = { turmaId: c.turmaId, slotId: c.slotId, data: c.data, presentes: [...c.presentes], total: c.total, atualizadoEm: agora };
        const i = lista.findIndex(x => x.turmaId === c.turmaId && x.slotId === c.slotId && x.data === c.data);
        if (i >= 0) { lista[i] = { ...lista[i], ...dados }; return lista[i]; }
        const novo = { id: novoId("c"), criadoEm: agora, ...dados };
        lista.push(novo);
        return novo;
      });
    },

    // Encerra o mês de uma modalidade: apaga as chamadas das turmas dela (do período e
    // de meses anteriores) e passa a modalidade para o mês seguinte.
    async encerrarMes(modalidadeId, periodo) {
      await iniciar();
      const turmaIds = (await ler("turmas", [])).filter(t => t.modalidadeId === modalidadeId).map(t => t.id);
      await mutar("chamadas", lista => {
        for (let i = lista.length - 1; i >= 0; i--) {
          if (turmaIds.includes(lista[i].turmaId) && String(lista[i].data).slice(0, 7) <= periodo) lista.splice(i, 1);
        }
      });
      await mutar("modalidades", lista => {
        const m = lista.find(x => x.id === modalidadeId);
        if (!m) return;
        let [ano, mes] = periodo.split("-").map(Number);
        mes++;
        if (mes > 12) { mes = 1; ano++; }
        m.periodo = `${ano}-${String(mes).padStart(2, "0")}`;
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
        lista.push({ cpf: conta.cpf, perfil: conta.perfil, nome: conta.nome || "", modalidadesIds: [], criadoEm: conta.criadoEm || new Date().toISOString() });
        return true;
      });
    },
    async atualizarConta(cpf, campos) {
      await iniciar();
      return mutar("contas", lista => {
        const conta = lista.find(c => c.cpf === cpf);
        if (!conta) return false;
        Object.assign(conta, campos);
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