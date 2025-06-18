const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');
const mercadopago = require('mercadopago');
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

app.post('/atualizar-sheets', async (req, res) => {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';

    const dados = req.body; // array de objetos
    const valores = dados.map(pessoa => [
      pessoa.nome,
      pessoa.cpf,
      pessoa.nascimento,
      pessoa.tipo,
      pessoa.status_pagamento
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Página1!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });

    res.status(200).send('Dados salvos com sucesso');
  } catch (error) {
    console.error('Erro ao atualizar planilha:', error);
    res.status(500).send('Erro ao atualizar planilha');
  }
});


app.post('/gerar-pix', async (req, res) => {
  try {
    const { nome, valor, cpf, email } = req.body;

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

    const dados = pagamento.response.point_of_interaction.transaction_data;

    res.json({
      qr_code: dados.qr_code,
      qr_code_base64: dados.qr_code_base64,
    });
  } catch (error) {
    console.error('Erro ao gerar Pix:', error.response ? error.response.data : error);
    res.status(500).send({ error:'Erro ao gerar Pix'});
  }
});

app.post('/webhook', async (req, res) => {
  const paymentId = req.body.data?.id;

  try {
    const payment = await mercadopago.payment.findById(paymentId);

    if (payment.body.status === 'approved') {
      const nome = payment.body.payer.first_name;
      const cpf = payment.body.payer.identification.number;

      // Atualizar o status na planilha
      await atualizarStatusPagamento(nome, cpf);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.sendStatus(500);
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
