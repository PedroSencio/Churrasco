const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
const mercadopago = require('mercadopago');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Google Sheets Auth
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Configuração Mercado Pago V1
mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_TOKEN,
  integrator_id: process.env.MERCADO_PAGO_INTEGRATOR_ID // Adicionado para rastreamento
});

const pagamentosPendentes = new Map();

app.post('/atualizar-sheets', async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';

    const values = req.body.map(({ nome, cpf, nascimento, tipo, status_pagamento, id_compra, payment_id }) => [
      nome,
      cpf,
      nascimento,
      tipo,
      status_pagamento,
      id_compra,
      payment_id,
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Página1!A1:G1',
      valueInputOption: 'RAW',
      resource: { values },
    });

    res.status(200).send('Dados enviados com sucesso!');
  } catch (err) {
    console.error('Erro ao enviar para o Google Sheets:', err);
    res.status(500).send('Erro ao atualizar a planilha.');
  }
});

app.post('/gerar-pix', async (req, res) => {
  try {
    console.log("📦 Dados recebidos para PIX:", req.body);

    const { nome, cpf, email, id_compra, device_id } = req.body;

    console.log("Dados recebidos:", req.body);

    if (!req.body.cpf || !/^\d{11}$/.test(req.body.cpf.replace(/\D/g, ''))) {
      return res.status(400).json({ error: "CPF inválido" });
    }
    
    if (!req.body.valor || req.body.valor < 5) {
      return res.status(400).json({ 
        error: "Valor mínimo para Pix é R$5,00",
        code: "MIN_VALUE_ERROR"
      });
    }

    const pagamento = await mercadopago.payment.create({
      transaction_amount: Number(req.body.valor),
      description: `Ingresso - ${req.body.nome}`,
      payment_method_id: 'pix',
      payer: {
        email: req.body.email || "comprador@example.com",
        first_name: req.body.nome,
        identification: {
          type: 'CPF',
          number: req.body.cpf.replace(/\D/g, '').slice(0, 11),
        },
      },
    });

    res.json({
      qr_code: pagamento.body.point_of_interaction.transaction_data.qr_code,
      qr_code_base64: pagamento.body.point_of_interaction.transaction_data.qr_code_base64,
      payment_id: pagamento.body.id,
      status: pagamento.body.status
    });
  } catch (error) {
    console.error('Erro detalhado:', {
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });

    res.status(500).json({ 
      error: 'Erro ao gerar Pix',
      details: error.message,
      code: error.status || 'MP_ERROR'
    });
  }
});

app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-signature'];
  if (signature !== process.env.MP_WEBHOOK_SECRET) {
    return res.status(401).send('Assinatura inválida');
  }

  console.log('🔔 Webhook recebido:', {
    headers: req.headers,
    body: req.body,
    ip: req.ip
  });

  const paymentId = req.body.data?.id;

  try {
    const payment = await mercadopago.payment.findById(paymentId);

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';

    const range = 'Página1!A2:G';
    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const linhas = resposta.data.values;

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      if (linha[6] === String(paymentId)) {
        if (payment.body.status === 'approved') {
          linha[4] = 'Aprovado'; // Coluna E
          const linhaRange = `Página1!A${i + 2}:G${i + 2}`; // linha + 2 por conta do cabeçalho

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: linhaRange,
            valueInputOption: 'RAW',
            requestBody: { values: [linha] }
          });
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.sendStatus(500);
  }
});

app.post('/confirmar-compra', async (req, res) => {
  const { id_compra } = req.body;

  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';

    const range = 'Página1!A2:F';
    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const linhas = resposta.data.values;

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      if (linha[5] === id_compra) {
        linha[4] = 'Aprovado'; // Coluna E
        const linhaRange = `Página1!A${i + 2}:F${i + 2}`; // linha + 2 por conta do cabeçalho

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: linhaRange,
          valueInputOption: 'RAW',
          requestBody: { values: [linha] }
        });
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro ao confirmar compra:', err);
    res.status(500).send('Erro ao confirmar compra');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
