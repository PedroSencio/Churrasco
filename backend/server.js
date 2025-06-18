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

    const pagamento = await mercadopago.payment.create({
      transaction_amount: req.body.valor,
      description: `Ingresso - ${nome}`,
      payment_method_id: 'pix',
      payer: {
        email: email || "comprador@example.com",
        first_name: nome,
        identification: {
          type: 'CPF',
          number: cpf.replace(/\D/g, '').slice(0, 11),
        },
      },
      metadata: {
        device_id
      },
    });

    const paymentId = pagamento.body.id;
    pagamentosPendentes.set(paymentId, id_compra);

    const dados = pagamento.response.point_of_interaction.transaction_data;

    res.json({
      qr_code: dados.qr_code,
      qr_code_base64: dados.qr_code_base64,
      payment_id: paymentId // Adiciona o payment_id na resposta
    });
  } catch (error) {
    console.error('Erro ao gerar Pix:', error);
    res.status(500).send({ error: 'Erro ao gerar Pix' });
  }
});

app.post('/webhook', async (req, res) => {
  console.log('🔥 Webhook recebido!', req.body);
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
