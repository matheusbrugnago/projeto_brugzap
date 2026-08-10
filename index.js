require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const mime = require('mime-types');
const fs = require('fs');
const multer = require('multer'); 

// 1. O servidor deve escutar a porta do ambiente
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // Mantém o nome original com a extensão (ex: 1680000000000-foto.png)
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
});

const upload = multer({ storage: storage });
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const app = express();
app.use(express.json());

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do PostgreSQL
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

let whatsappPronto = false;

// Inicialização do WhatsApp Web
// 2. O Client do WhatsApp precisa das flags headless para conteineres
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('⚡ [WHATSAPP] Escaneie o QR Code abaixo para conectar:');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ [WHATSAPP] Conectado e pronto para uso!');
  whatsappPronto = true;
});

client.initialize();

// ==================== ROTAS DE CONTATOS ====================
app.get('/contatos', async (req, res) => {
  try {
    const query = `
      SELECT c.*, g.nome AS grupo_nome 
      FROM contatos c 
      LEFT JOIN grupos g ON c.grupo_id = g.id 
      ORDER BY c.nome ASC`;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error('❌ Erro no GET /contatos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/contatos', async (req, res) => {
  const { nome, telefone, grupo_id } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO contatos (nome, telefone, grupo_id) VALUES ($1, $2, $3) RETURNING *', 
      [nome, telefone, grupo_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Erro no POST /contatos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/contatos/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, telefone, grupo_id } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE contatos SET nome = $1, telefone = $2, grupo_id = $3 WHERE id = $4 RETURNING *', 
      [nome, telefone, grupo_id || null, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Erro no PUT /contatos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/contatos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM contatos WHERE id = $1', [id]);
    res.json({ message: 'Contato excluído com sucesso!' });
  } catch (err) {
    console.error('❌ Erro no DELETE /contatos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS DE GRUPOS ====================
app.get('/grupos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM grupos ORDER BY nome ASC');
    res.json(rows);
  } catch (err) {
    console.error('❌ Erro no GET /grupos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/grupos', async (req, res) => {
  const { nome } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO grupos (nome) VALUES ($1) RETURNING *', 
      [nome]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Erro no POST /grupos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/grupos/:id', async (req, res) => {
  const { id } = req.params;
  const { nome } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE grupos SET nome = $1 WHERE id = $2 RETURNING *', 
      [nome, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Erro no PUT /grupos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/grupos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM grupos WHERE id = $1', [id]);
    res.json({ message: 'Grupo excluído com sucesso!' });
  } catch (err) {
    console.error('❌ Erro no DELETE /grupos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS DE TEMPLATES ====================
app.get('/templates', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM templates ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    console.error('❌ Erro no GET /templates:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST: Criar novo template (com anexo opcional)
app.post('/templates', upload.single('anexo'), async (req, res) => {
  const { nome, conteudo } = req.body;
  const arquivo_url = req.file ? req.file.path : null;

  try {
    const { rows } = await pool.query(
      'INSERT INTO templates (nome, conteudo, arquivo_url) VALUES ($1, $2, $3) RETURNING *',
      [nome, conteudo, arquivo_url]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Erro no POST /templates:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT: Atualizar template existente (com anexo opcional)
app.put('/templates/:id', upload.single('anexo'), async (req, res) => {
  const { id } = req.params;
  const { nome, conteudo } = req.body;
  const novoArquivo = req.file ? req.file.path : null;

  try {
    let query = '';
    let params = [];

    // Se o usuário selecionou uma nova imagem ao editar, atualiza o arquivo_url
    if (novoArquivo) {
      query = 'UPDATE templates SET nome = $1, conteudo = $2, arquivo_url = $3 WHERE id = $4 RETURNING *';
      params = [nome, conteudo, novoArquivo, id];
    } else {
      // Se não enviou novo arquivo, mantém o arquivo antigo que já estava gravado
      query = 'UPDATE templates SET nome = $1, conteudo = $2 WHERE id = $3 RETURNING *';
      params = [nome, conteudo, id];
    }

    const { rows } = await pool.query(query, params);
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Erro no PUT /templates:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/templates/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM templates WHERE id = $1', [id]);
    res.json({ message: 'Template excluído com sucesso!' });
  } catch (err) {
    console.error('❌ Erro no DELETE /templates:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==================== ROTAS DE AGENDAMENTOS ====================
app.get('/agendamentos', async (req, res) => {
  try {
    const query = `
      SELECT a.*, 
             COALESCE(c.nome, 'Nenhum') AS contato_nome,
             COALESCE(g.nome, 'Nenhum') AS grupo_nome,
             COALESCE(t.nome, 'Template removido') AS template_nome
      FROM agendamentos a
      LEFT JOIN contatos c ON a.contato_id = c.id
      LEFT JOIN grupos g ON a.grupo_id = g.id
      LEFT JOIN templates t ON a.template_id = t.id
      ORDER BY a.id DESC
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/agendamentos', async (req, res) => {
  const { nome, contato_id, grupo_id, template_id, tipo_agendamento, datas_fixas, dias_semana, horarios, ativo } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO agendamentos 
       (nome, contato_id, grupo_id, template_id, tipo_agendamento, datas_fixas, dias_semana, horarios, ativo, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendente') RETURNING *`,
      [
        nome, 
        contato_id || null, 
        grupo_id || null, 
        template_id, 
        tipo_agendamento, 
        JSON.stringify(datas_fixas || []), 
        JSON.stringify(dias_semana || []), 
        JSON.stringify(horarios || []), 
        ativo
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Erro no POST /agendamentos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/agendamentos/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, contato_id, grupo_id, template_id, tipo_agendamento, datas_fixas, dias_semana, horarios, ativo } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE agendamentos 
       SET nome = $1, 
           contato_id = $2, 
           grupo_id = $3, 
           template_id = $4, 
           tipo_agendamento = $5, 
           datas_fixas = $6, 
           dias_semana = $7, 
           horarios = $8, 
           ativo = $9
       WHERE id = $10 
       RETURNING *`,
      [
        nome,
        contato_id || null,
        grupo_id || null,
        template_id,
        tipo_agendamento,
        JSON.stringify(datas_fixas || []),
        JSON.stringify(dias_semana || []),
        JSON.stringify(horarios || []),
        ativo,
        id
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Agendamento não encontrado' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Erro no PUT /agendamentos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/agendamentos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM agendamentos WHERE id = $1', [id]);
    res.json({ message: 'Agendamento excluído com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== AUXILIARES DE ENVIO E CRON ====================

// Função para enviar mensagem individual com suporte a imagem/anexo
async function enviarMensagemWhatsApp(telefone, mensagem, caminhoArquivo = null) {
  let apenasNumeros = telefone.replace(/\D/g, '');

  if (!apenasNumeros.startsWith('55')) {
    apenasNumeros = `55${apenasNumeros}`;
  }

  let numberDetails = await client.getNumberId(apenasNumeros);

  if (!numberDetails && apenasNumeros.length === 13) {
    const semNonoDigito = apenasNumeros.slice(0, 4) + apenasNumeros.slice(5);
    numberDetails = await client.getNumberId(semNonoDigito);
  }

  if (numberDetails) {
    const chatId = numberDetails._serialized;
    const caminhoAbsoluto = caminhoArquivo ? path.resolve(caminhoArquivo) : null;

    if (caminhoAbsoluto && fs.existsSync(caminhoAbsoluto)) {
      console.log(`📎 Enviando anexo: ${caminhoAbsoluto}`);
      try {
        const media = MessageMedia.fromFilePath(caminhoAbsoluto);
        await client.sendMessage(chatId, media, { caption: mensagem });
        return true;
      } catch (errFrame) {
        console.warn(`⚠️ Falha ao anexar mídia (${errFrame.message}). Tentando reenviar apenas o texto...`);
        // Aguarda 2 segundos para o frame do Puppeteer estabilizar antes do fallback de texto
        await delay(2000); 
        await client.sendMessage(chatId, mensagem);
        return true;
      }
    } else {
      await client.sendMessage(chatId, mensagem);
      return true;
    }
  }
  return false;
}

// Tarefa executada a cada 1 minuto para checar agendamentos pendentes
cron.schedule('* * * * *', async () => {
  if (!whatsappPronto) return;

  const agora = new Date();
  const dataHojeStr = agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const horaMinutoStr = agora.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const diaSemanaHoje = agora.getDay();

  try {
    const { rows: agendamentos } = await pool.query(`
      SELECT a.*, t.conteudo AS template_conteudo, t.arquivo_url AS template_arquivo
      FROM agendamentos a
      JOIN templates t ON a.template_id = t.id
      WHERE a.ativo = TRUE AND a.status != 'finalizado'
    `);

    for (const agenda of agendamentos) {
      const horarios = typeof agenda.horarios === 'string' ? JSON.parse(agenda.horarios) : (agenda.horarios || []);
      const datasFixas = typeof agenda.datas_fixas === 'string' ? JSON.parse(agenda.datas_fixas) : (agenda.datas_fixas || []);
      const diasSemana = typeof agenda.dias_semana === 'string' ? JSON.parse(agenda.dias_semana) : (agenda.dias_semana || []);

      let deveDispararHoje = false;
      if (agenda.tipo_agendamento === 'fixo') {
        deveDispararHoje = datasFixas.includes(dataHojeStr);
      } else if (agenda.tipo_agendamento === 'recorrente') {
        deveDispararHoje = diasSemana.includes(diaSemanaHoje);
      }

      if (!deveDispararHoje) continue;

      const horarioExato = horarios.includes(horaMinutoStr);
      const pendenteAtrasado = agenda.status === 'pendente' && horarios.some(h => h <= horaMinutoStr);

      if (!horarioExato && !pendenteAtrasado) continue;

      const chaveExecucao = `${dataHojeStr} ${horaMinutoStr}`;
      const { rows: jaExecutado } = await pool.query(
        `SELECT id FROM agendamento_execucoes 
         WHERE agendamento_id = $1 AND TO_CHAR(data_hora_envio, 'YYYY-MM-DD HH24:MI') = $2`,
        [agenda.id, chaveExecucao]
      );

      if (jaExecutado.length > 0) continue;

      console.log(`🚀 [ROBÔ] Executando disparo ID ${agenda.id}: "${agenda.nome}" em ${horaMinutoStr}`);

      await pool.query('INSERT INTO agendamento_execucoes (agendamento_id) VALUES ($1)', [agenda.id]);

      if (agenda.status === 'pendente') {
        await pool.query("UPDATE agendamentos SET status = 'execucao' WHERE id = $1", [agenda.id]);
        agenda.status = 'execucao';
      }

      let contatos = [];
      if (agenda.contato_id) {
        const { rows } = await pool.query('SELECT * FROM contatos WHERE id = $1', [agenda.contato_id]);
        contatos = rows;
      } else if (agenda.grupo_id) {
        const { rows } = await pool.query('SELECT * FROM contatos WHERE grupo_id = $1', [agenda.grupo_id]);
        contatos = rows;
      }

      for (const contato of contatos) {
        try {
          const msg = agenda.template_conteudo.replace(/{nome}/gi, contato.nome);
          await enviarMensagemWhatsApp(contato.telefone, msg, agenda.template_arquivo);
          await delay(8000);
        } catch (e) {
          console.error(`❌ Erro no envio para ${contato.nome}:`, e.message);
        }
      }

      if (agenda.tipo_agendamento === 'fixo') {
        const datasFuturas = datasFixas.filter(d => d > dataHojeStr);
        if (datasFuturas.length === 0) {
          await pool.query("UPDATE agendamentos SET status = 'finalizado', ativo = FALSE WHERE id = $1", [agenda.id]);
        }
      }
    }
  } catch (err) {
    console.error('❌ Erro no Cron do Robô:', err.message);
  }
});

// Iniciar Servidor na Porta 3000
app.listen(3000, () => {
  console.log('🚀 Servidor rodando na porta 3000');
});