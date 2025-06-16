const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const stream = require('stream');

const app = express();

app.use(express.json({ limit: '20mb' })); // aumenta o limite
app.use(cors({
  origin: 'https://formaturachurrasco.netlify.app' // seu frontend no Netlify
}));

// Autenticação com conta de serviço
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
  ],
});

const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';

// Upload do comprovante
app.post('/upload', async (req, res) => {
  try {
    const { fileName, fileData } = req.body;

    // Detecta tipo do arquivo (jpeg, png, pdf)
    const base64Header = fileData.split(',')[0];
    let mimeType = 'image/jpeg';
    if (base64Header.includes('image/png')) mimeType = 'image/png';
    if (base64Header.includes('application/pdf')) mimeType = 'application/pdf';

    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.from(fileData.split(',')[1], 'base64'));

    const drive = google.drive({ version: 'v3', auth });
    const client = await auth.getClient();

    const uploadResponse = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType,
      },
      media: {
        mimeType,
        body: bufferStream,
      },
      auth: client
    });

    const fileId = uploadResponse.data.id;

    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const fileLink = `https://drive.google.com/uc?id=${fileId}`;
    res.status(200).json({ fileLink });
  } catch (err) {
    console.error('❌ Erro no upload:', err);
    res.status(500).json({ message: 'Erro ao enviar o comprovante.', error: err.message });
  }
});

// Enviar dados para o Google Sheets
app.post('/atualizar-sheets', async (req, res) => {
  try {
    if (!Array.isArray(req.body) || req.body.length === 0) {
      return res.status(400).send('Dados inválidos.');
    }

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const values = req.body.map(({ nome, cpf, nascimento, tipo, comprovante }) => [
      nome,
      cpf,
      nascimento,
      tipo,
      comprovante || 'Sem comprovante'
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Página1!A1',
      valueInputOption: 'RAW',
      requestBody: { values },
    });

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
