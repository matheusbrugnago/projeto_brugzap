require('dotenv').config();
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
let ultimoQrCode = null;
const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js'); // Importado apenas 1 vez aqui
const path = require('path');
const mime = require('mime-types');
const fs = require('fs');
const multer = require('multer'); 

const app = express();
const PORT = process.env.PORT || 3000;
const sessionPath = path.join(__dirname, '.wwebjs_auth');

// Detecta o caminho do Chromium instalado no Docker/Railway
const getChromiumPath = () => {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fs.existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  if (fs.existsSync('/usr/bin/chromium-browser')) return '/usr/bin/chromium-browser';
  return undefined;
};

// Configuração do Multer para uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
});

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const upload = multer({ storage: storage });
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Conexão PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

let whatsappPronto = false;

// Função para remover arquivos de trava do Chromium (evita erro de perfil bloqueado)
function removeChromiumLocks(dir) {
  if (!fs.existsSync(dir)) return;
  
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        removeChromiumLocks(fullPath);
      } else if (file === 'SingletonLock' || file === 'SingletonCookie' || file === 'SingletonSocket') {
        try {
          fs.unlinkSync(fullPath);
          console.log(`🔒 Arquivo de trava removido: ${fullPath}`);
        } catch (err) {
          console.error(`Erro ao remover arquivo de trava: ${err.message}`);
        }
      }
    }
  } catch (err) {
    console.error(`Erro na leitura do diretório de sessão: ${err.message}`);
  }
}

// 1. Limpa travas de execuções anteriores
removeChromiumLocks(sessionPath);

// 2. Inicialização do WhatsApp Web com caminho correto do Chromium
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: sessionPath
  }),
  puppeteer: {
    headless: true,
    executablePath: getChromiumPath(), // Atribui o executável correto
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('⚡ [WHATSAPP] Novo QR Code gerado!');
  ultimoQrCode = qr;
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ [WHATSAPP] Conectado e pronto para uso!');
  whatsappPronto = true;
  ultimoQrCode = null;
});

client.on('disconnected', (reason) => {
  console.warn('⚠️ [WHATSAPP] Desconectado:', reason);
  whatsappPronto = false;
});

// Aguarda 1 segundo antes de disparar o WhatsApp para dar tempo do sistema liberar as pastas
setTimeout(() => {
  client.initialize();
}, 1000);

// ==================== ROTA QR CODE ====================
app.get('/qr', async (req, res) => {
  if (whatsappPronto) {
    return res.send('<h3>WhatsApp já está conectado!</h3>');
  }
  if (!ultimoQrCode) {
    return res.send('<h3>Aguardando geração do QR Code... Atualize a página em instantes.</h3>');
  }

  try {
    const qrImage = await QRCode.toDataURL(ultimoQrCode);
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Conectar WhatsApp</title>
          <meta http-equiv="refresh" content="15">
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; background: #0b141a; color: #fff; }
            img { background: white; padding: 15px; border-radius: 8px; }
          </style>
        </head>
        <body>
          <h2>Escaneie o QR Code para conectar</h2>
          <img src="${qrImage}" alt="QR Code WhatsApp" />
          <p>Esta página é atualizada automaticamente.</p>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Erro ao gerar QR Code: ' + err.message);
  }
});

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

app.put('/templates/:id', upload.single('anexo'), async (req, res) => {
  const { id } = req.params;
  const { nome, conteudo } = req.body;
  const novoArquivo = req.file ? req.file.path : null;

  try {
    let query = '';
    let params = [];

    if (novoArquivo) {
      query = 'UPDATE templates SET nome = $1, conteudo = $2, arquivo_url = $3 WHERE id = $4 RETURNING *';
      params = [nome, conteudo, novoArquivo, id];
    } else {
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

async function enviarMensagemWhatsApp(telefone, mensagem, caminhoArquivo = null) {
  try {
    let apenasNumeros = telefone.replace(/\D/g, '');

    if (!apenasNumeros.startsWith('55')) {
      apenasNumeros = `55${apenasNumeros}`;
    }

    let numberDetails = await client.getNumberId(apenasNumeros);

    if (!numberDetails && apenasNumeros.length === 13) {
      const semNonoDigito = apenasNumeros.slice(0, 4) + apenasNumeros.slice(5);
      numberDetails = await client.getNumberId(semNonoDigito);
    }

    if (!numberDetails) {
      console.warn(`⚠️ Número não encontrado no WhatsApp: ${telefone}`);
      return false;
    }

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
        await delay(2000); 
        await client.sendMessage(chatId, mensagem);
        return true;
      }
    } else {
      await client.sendMessage(chatId, mensagem);
      return true;
    }
  } catch (err) {
    console.error(`❌ Erro crítico ao processar envio para ${telefone}:`, err.message);
    return false;
  }
}

cron.schedule('* * * * *', async () => {
  console.log(`⏱️ [CRON] Checagem do minuto iniciada... WhatsApp Pronto? ${whatsappPronto}`);
  
  if (!whatsappPronto) {
    console.log('⚠️ [CRON] Abortado: WhatsApp ainda não está pronto.');
    return;
  }

  const agora = new Date();
  const dataIsoHoje = agora.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); 
  const dataBrHoje = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }); 
  const horaMinutoStr = agora.toLocaleTimeString('pt-BR', { 
    timeZone: 'America/Sao_Paulo', 
    hour: '2-digit', 
    minute: '2-digit' 
  }).slice(0, 5);

  const diaSemanaHoje = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getDay();

  try {
    const { rows: agendamentos } = await pool.query(`
      SELECT a.*, t.conteudo AS template_conteudo, t.arquivo_url AS template_arquivo
      FROM agendamentos a
      JOIN templates t ON a.template_id = t.id
      WHERE a.ativo = TRUE AND a.status != 'finalizado'
    `);

    console.log(`📋 [CRON] Agendamentos ativos encontrados no banco: ${agendamentos.length}`);

    for (const agenda of agendamentos) {
      let horarios = typeof agenda.horarios === 'string' ? JSON.parse(agenda.horarios) : (agenda.horarios || []);
      let datasFixas = typeof agenda.datas_fixas === 'string' ? JSON.parse(agenda.datas_fixas) : (agenda.datas_fixas || []);
      let diasSemana = typeof agenda.dias_semana === 'string' ? JSON.parse(agenda.dias_semana) : (agenda.dias_semana || []);

      horarios = horarios.map(h => String(h).trim());
      datasFixas = datasFixas.map(d => String(d).trim());

      console.log(`🔍 Analisando Agendamento ID ${agenda.id} ("${agenda.nome}"):`);
      console.log(`   - Data Hoje: ${dataIsoHoje} / ${dataBrHoje} | Datas Banco:`, datasFixas);
      console.log(`   - Hora Hoje: ${horaMinutoStr} | Horarios Banco:`, horarios);

      let deveDispararHoje = false;
      if (agenda.tipo_agendamento === 'fixo') {
        deveDispararHoje = datasFixas.some(d => d === dataIsoHoje || d === dataBrHoje);
      } else if (agenda.tipo_agendamento === 'recorrente') {
        deveDispararHoje = diasSemana.some(d => String(d) === String(diaSemanaHoje));
      }

      if (!deveDispararHoje) {
        console.log(`   ❌ Pulado: Data de hoje não corresponde.`);
        continue;
      }

      const horarioExato = horarios.includes(horaMinutoStr);
      const pendenteAtrasado = agenda.status === 'pendente' && horarios.some(h => h <= horaMinutoStr);

      if (!horarioExato && !pendenteAtrasado) {
        console.log(`   ❌ Pulado: Horário não corresponde.`);
        continue;
      }

      const chaveExecucao = `${dataIsoHoje} ${horaMinutoStr}`;
      
      const { rows: jaExecutado } = await pool.query(
        `SELECT id FROM agendamento_execucoes 
         WHERE agendamento_id = $1 
         AND TO_CHAR(data_hora_envio AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') = $2`,
        [agenda.id, chaveExecucao]
      );

      if (jaExecutado.length > 0) {
        console.log(`   ❌ Pulado: Já foi executado neste minuto.`);
        continue;
      }

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

      console.log(`   👥 Contatos encontrados para envio: ${contatos.length}`);

      for (const contato of contatos) {
        try {
          const msg = agenda.template_conteudo.replace(/{nome}/gi, contato.nome);
          await enviarMensagemWhatsApp(contato.telefone, msg, agenda.template_arquivo);
          console.log(`   ✅ Mensagem enviada com sucesso para ${contato.nome} (${contato.telefone})`);
          await delay(8000);
        } catch (e) {
          console.error(`   ❌ Erro no envio para ${contato.nome}:`, e.message);
        }
      }

      if (agenda.tipo_agendamento === 'fixo') {
        const datasFuturas = datasFixas.filter(d => d > dataIsoHoje && d > dataBrHoje);
        if (datasFuturas.length === 0) {
          await pool.query("UPDATE agendamentos SET status = 'finalizado', ativo = FALSE WHERE id = $1", [agenda.id]);
        }
      }
    }
  } catch (err) {
    console.error('❌ Erro no Cron do Robô:', err.message);
  }
}, {
  scheduled: true,
  timezone: "America/Sao_Paulo"
});