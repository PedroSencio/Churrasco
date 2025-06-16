const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');


const app = express();

app.use(express.json());
app.use(cors());

// Configuração da API do Google Sheets
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';

app.post('/atualizar-sheets', async (req, res) => {
  try {
    console.log('▶️ Recebido POST /atualizar-sheets');
    if (!Array.isArray(req.body) || req.body.length === 0) {
      console.error('❌ Dados inválidos ou vazios:', req.body);
      return res.status(400).send('Dados inválidos.');
    }

    const values = req.body.map(({ nome, cpf, nascimento, tipo }) => [
      nome,
      cpf,
      nascimento,
      tipo,
    ]);

    // Atualizar a planilha com os dados do arquivo
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Página1!A1',
      valueInputOption: 'RAW',
      requestBody: {
        values,
      },
    });

    console.log('✅ Dados adicionados:', values);
    res.status(200).send('Dados enviados para o Google Sheets com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao enviar para o Google Sheets:', err);
    res.status(500).send('Erro ao atualizar a planilha.');
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
