const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const mercadopago = require('mercadopago');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// Autenticação Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Configuração Mercado Pago
mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_TOKEN,
});

// Rota para atualizar planilha
app.post('/atualizar-sheets', async (req, res) => {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    const spreadsheetId = process.env.SHEET_ID;

    const values = req.body.map(({ nome, cpf, nascimento, tipo, status_pagamento, id_compra, payment_id }) => [
      nome, cpf, nascimento, tipo, status_pagamento, id_compra, payment_id
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Página1!A1:G1',
      valueInputOption: 'RAW',
      resource: { values },
    });

    res.status(200).send('Dados enviados com sucesso!');
  } catch (err) {
    console.error('Erro ao atualizar Sheets:', err);
    res.status(500).send('Erro ao atualizar a planilha.');
  }
});

// Rota para gerar pagamento Pix
app.post('/gerar-pix', async (req, res) => {
  try {
    const { nome, cpf, email, valor, id_compra, device_id } = req.body;

    const pagamento = await mercadopago.payment.create({
      transaction_amount: Number(valor),
      description: `Ingresso - ${nome}`,
      payment_method_id: 'pix',
      payer: {
        email: email || "comprador@example.com",
        first_name: nome,
        identification: { type: 'CPF', number: cpf.replace(/\D/g, '').slice(0, 11) }
      },
      device: { device_id },
      metadata: { device_id },
    });

    const dados = pagamento.body.point_of_interaction.transaction_data;
    res.json({
      qr_code: dados.qr_code,
      qr_code_base64: dados.qr_code_base64,
      payment_id: pagamento.body.id
    });
  } catch (error) {
    console.error('Erro ao gerar Pix:', error);
    res.status(500).send({ error: 'Erro ao gerar Pix' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});