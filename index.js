require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cron = require('node-cron');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

// 1. CONEXÃO BANCO DE DADOS
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// 2. INICIALIZAÇÃO DO WHATSAPP
const client = new Client({
  authStrategy: new LocalAuth(), // Salva a sessão localmente para não precisar ler o QR Code toda vez
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }
});

let whatsappPronto = false;

// Evento que gera o QR Code no terminal
client.on('qr', (qr) => {
  console.log('⚡ ESCANEE O QR CODE ABAIXO COM O SEU WHATSAPP:');
  qrcode.generate(qr, { small: true });
});

// Evento quando a conexão é estabelecida
client.on('ready', () => {
  console.log('✅ [WHATSAPP] Cliente do WhatsApp conectado com sucesso!');
  whatsappPronto = true;
});

client.initialize();

// --- ROTAS DA API ---
app.get('/testar-conexao', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT NOW()');
    res.json({ sucesso: true, hora_no_banco: resultado.rows[0].now, whatsapp_status: whatsappPronto ? 'Conectado' : 'Aguardando QR Code' });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.post('/contatos', async (req, res) => {
  try {
    const { nome, telefone } = req.body;
    const query = 'INSERT INTO contatos (nome, telefone) VALUES ($1, $2) RETURNING *';
    const resultado = await pool.query(query, [nome, telefone]);
    res.status(201).json({ sucesso: true, dados: resultado.rows[0] });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.get('/contatos', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM contatos ORDER BY id DESC');
    res.json({ sucesso: true, dados: resultado.rows });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.post('/templates', async (req, res) => {
  try {
    const { titulo, conteudo } = req.body;
    const query = 'INSERT INTO templates (titulo, conteudo) VALUES ($1, $2) RETURNING *';
    const resultado = await pool.query(query, [titulo, conteudo]);
    res.status(201).json({ sucesso: true, dados: resultado.rows[0] });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.post('/agendamentos', async (req, res) => {
  try {
    const { contato_id, template_id, data_hora } = req.body;
    const query = 'INSERT INTO agendamentos (contato_id, template_id, data_hora) VALUES ($1, $2, $3) RETURNING *';
    const resultado = await pool.query(query, [contato_id, template_id, data_hora]);
    res.status(201).json({ sucesso: true, dados: resultado.rows[0] });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

app.get('/agendamentos', async (req, res) => {
  try {
    const query = `
      SELECT a.id, c.nome AS contato, c.telefone, t.titulo AS template, t.conteudo, a.data_hora, a.status 
      FROM agendamentos a
      JOIN contatos c ON a.contato_id = c.id
      JOIN templates t ON a.template_id = t.id
      ORDER BY a.data_hora ASC
    `;
    const resultado = await pool.query(query);
    res.json({ sucesso: true, dados: resultado.rows });
  } catch (erro) {
    res.status(500).json({ sucesso: false, erro: erro.message });
  }
});

// 3. MOTOR DE DISPARO AUTOMÁTICO COM TRATAMENTO DE LID / NÚMERO
cron.schedule('* * * * *', async () => {
  if (!whatsappPronto) {
    console.log('⏳ [ROBÔ] Aguardando conexão do WhatsApp para verificar disparos...');
    return;
  }

  console.log('⏰ [ROBÔ] Verificando agendamentos pendentes...');

  try {
    const query = `
      SELECT a.id, c.nome, c.telefone, t.conteudo 
      FROM agendamentos a
      JOIN contatos c ON a.contato_id = c.id
      JOIN templates t ON a.template_id = t.id
      WHERE a.status = 'pendente' AND a.data_hora <= NOW()
    `;

    const { rows } = await pool.query(query);

    if (rows.length === 0) return;

    for (let item of rows) {
      const mensagemFormatada = item.conteudo.replace('{nome}', item.nome);
      
      // Limpa caracteres especiais deixando apenas os dígitos
      let apenasNumeros = item.telefone.replace(/\D/g, '');

      // Garante o código do país 55
      if (!apenasNumeros.startsWith('55')) {
        apenasNumeros = `55${apenasNumeros}`;
      }

      console.log(`📱 Buscando o ID correto do WhatsApp para ${item.nome} (${apenasNumeros})...`);

      // 1. Pergunta ao WhatsApp qual é o ID real registrado para este número
      let numberDetails = await client.getNumberId(apenasNumeros);

      // Se não encontrou e o número tem 13 dígitos (com o 9), tenta procurar sem o 9º dígito
      if (!numberDetails && apenasNumeros.length === 13) {
        const semNonoDigito = apenasNumeros.slice(0, 4) + apenasNumeros.slice(5);
        console.log(`🔍 Tentando localizar sem o 9º dígito: ${semNonoDigito}...`);
        numberDetails = await client.getNumberId(semNonoDigito);
      }

      // Se ainda assim não encontrar o número no WhatsApp
      if (!numberDetails) {
        console.error(`❌ O número ${apenasNumeros} não está registrado no WhatsApp!`);
        await pool.query('UPDATE agendamentos SET status = $1 WHERE id = $2', ['falhou_numero_invalido', item.id]);
        continue;
      }

      // 2. Envia a mensagem utilizando o _serialized ID obtido do próprio WhatsApp
      const chatId = numberDetails._serialized;
      await client.sendMessage(chatId, mensagemFormatada);

      // 3. Atualiza o status no banco de dados para enviado
      await pool.query('UPDATE agendamentos SET status = $1 WHERE id = $2', ['enviado', item.id]);
      console.log(`✅ [SUCESSO] Mensagem entregue para ${item.nome}! Agendamento ID ${item.id} atualizado.`);
    }
  } catch (erro) {
    console.error('❌ Erro ao enviar mensagem pelo WhatsApp:', erro.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});