const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const stream = require('stream');


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

app.post('/upload', async (req, res) => {
  try {
    const { fileName, fileData } = req.body;

    // Salvar a imagem no Google Drive
    const drive = google.drive({ version: 'v3', auth });
    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.from(fileData.split(',')[1], 'base64'));

    const driveResponse = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'image/jpeg',
      },
      media: {
        mimeType: 'image/jpeg',
        body: bufferStream,
      },
    });

    const fileId = driveResponse.data.id;

    // Tornar o arquivo público
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const fileLink = `https://drive.google.com/uc?id=${fileId}`;

    // Atualizar a planilha com o link da imagem
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Sheet1!E1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [[fileName, fileLink]],
      },
    });

    res.status(200).json({ message: 'Imagem enviada e planilha atualizada com sucesso!', response });
  } catch (error) {
    console.error('Erro ao enviar a imagem:', error);
    res.status(500).json({ message: 'Erro ao enviar a imagem.', error });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
