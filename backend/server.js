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
  access_token: 'APP_USR-353925293894264-061720-a3575a7163214becd16668024e0f4d36-568402986'
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

    const { nome, sobrenome, cpf, email, id_compra, valor_total } = req.body;

    // Corrigir valor com base no valor_total
    const valor = parseFloat(valor_total);
    console.log(`Valor calculado: ${valor}`);

    const pagamento = await mercadopago.payment.create({
      transaction_amount: parseFloat(valor),
      description: `Ingresso - Churrasco Eng em Formação`,
      payment_method_id: 'pix',
      notification_url: 'https://churrasco-uawh.onrender.com/webhook',
      external_reference: id_compra, // ← Importante para rastrear internamente

      payer: {
        email: email || 'pedrosencio2309@gmail.com',
        first_name: nome,
        last_name: sobrenome || 'Sencio',
        identification: {
          type: 'CPF',
          number: cpf.replace(/[^0-9]/g, '') // Limpa o CPF para garantir que não tenha caracteres inválidos
        },
        address: {
          zip_code: '19901732',
          street_name: 'Aurora Gonçalves Custódio',
          street_number: '204',
          neighborhood: 'Oriental',
          city: 'Ourinhos',
          federal_unit: 'SP'
        },
        phone: {
          area_code: '14',
          number: '997969064'
        }
      }
    });

    const paymentId = pagamento.body.id;
    pagamentosPendentes.set(paymentId, id_compra);

    const dados = pagamento.response.point_of_interaction.transaction_data;

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Página1!A1:G1',
      valueInputOption: 'RAW',
      resource: {
        values: [[
          nome,
          cpf,
          "",        // nascimento (poderia vir do req.body se desejar)
          "Adulto",  // tipo (ou outro valor se desejar enviar)
          "Pendente",
          id_compra,
          paymentId
        ]]
      }
    });

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

  // Verifica se é o tipo esperado
  const paymentId = req.body.data?.id;
  const action = req.body.action;

  // Ignora eventos que não são atualização de status
  if (req.body.type !== 'payment' || action !== 'payment.updated') {
    console.log('🔕 Webhook ignorado: não é atualização de pagamento.');
    return res.sendStatus(200);
  }

  try {
    const payment = await mercadopago.payment.findById(paymentId);
    const status = payment.body.status;

    if (status !== 'approved') {
      console.log(`⏳ Pagamento ${paymentId} ainda não aprovado. Status: ${status}`);
      return res.sendStatus(200);
    }

    console.log(`✅ Pagamento aprovado: ${paymentId}`);

    // Atualizar planilha
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';

    const range = 'Página1!A2:G';
    const resposta = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const linhas = resposta.data.values;

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      if (linha[6] === String(paymentId)) {
        linha[4] = 'Aprovado'; // coluna E
        const linhaRange = `Página1!A${i + 2}:G${i + 2}`;

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: linhaRange,
          valueInputOption: 'RAW',
          requestBody: { values: [linha] }
        });
        break;
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

app.post('/processar-pagamento', async (req, res) => {
  try {
    const {
      token,
      transaction_amount,
      payment_method_id,
      installments,
      issuer_id,
      email,
      identificationType,
      identificationNumber,
      deviceId
    } = req.body;

    const pagamento = await mercadopago.payment.create({
      transaction_amount: parseFloat(transaction_amount),
      token,
      description: "Ingresso - Churrasco Eng em Formação",
      payment_method_id,
      installments: parseInt(installments),
      issuer_id,
      payer: {
        email,
        identification: {
          type: identificationType,
          number: identificationNumber
        }
      },
      device: {
        device_id: deviceId
      }
    });

    res.status(200).json({
      status: pagamento.body.status,
      status_detail: pagamento.body.status_detail,
      id: pagamento.body.id
    });
  } catch (error) {
    console.error('Erro ao processar pagamento:', error);
    res.status(500).send({ error: 'Erro ao processar pagamento' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
