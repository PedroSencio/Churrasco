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
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
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

    const values = req.body.map(({ nome, cpf, nascimento, tipo, status_pagamento, id_compra }) => [
      nome,
      cpf,
      nascimento,
      tipo,
      status_pagamento,
      id_compra,
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Página1!A1',
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
    const { nome, valor, cpf, email, id_compra } = req.body;

    const pagamento = await mercadopago.payment.create({
      transaction_amount: parseFloat(valor),
      description: `Ingresso - ${nome}`,
      payment_method_id: 'pix',
      payer: {
        email: email || "comprador@example.com",
        first_name: nome,
        identification: {
          type: 'CPF',
          number: cpf || '12345678900',
        },
      },
    });

    const paymentId = pagamento.body.id;
    pagamentosPendentes.set(paymentId, id_compra);

    const dados = pagamento.response.point_of_interaction.transaction_data;

    res.json({
      qr_code: dados.qr_code,
      qr_code_base64: dados.qr_code_base64,
    });
  } catch (error) {
    console.error('Erro ao gerar Pix:', error);
    res.status(500).send({ error: 'Erro ao gerar Pix' });
  }
});

app.post('/webhook', async (req, res) => {
  const paymentId = req.body.data?.id;
  const signature = req.headers['x-signature'];

  try {
    // Validação da assinatura
    const expectedSignature = crypto.createHmac('sha256', process.env.MERCADO_PAGO_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      console.error('Assinatura inválida no webhook');
      return res.sendStatus(403);
    }

    const payment = await mercadopago.payment.findById(paymentId);

    if (payment.body.status === 'approved') {
      const id_compra = pagamentosPendentes.get(paymentId);
      if (id_compra) {
        await fetch('https://churrasco-uawh.onrender.com/confirmar-compra', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_compra })
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
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';
    const range = 'Página1!A2:F'; // ajuste conforme o layout

    const resposta = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    const linhas = resposta.data.values;
    const novasLinhas = linhas.map((linha, i) => {
      if (linha[5] === id_compra) {
        linha[4] = 'Aprovado'; // coluna E = status
      }
      return linha;
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Página1!A2:F',
      valueInputOption: 'RAW',
      requestBody: { values: novasLinhas }
    });

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
