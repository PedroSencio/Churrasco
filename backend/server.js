const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const stream = require('stream');

const app = express();

// Middleware JSON + CORS para liberar acesso ao Netlify
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: 'https://formaturachurrasco.netlify.app',
}));

// Google Auth
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
});

const spreadsheetId = '1NKD77418Q1B3nURFu53BTJ6yt5_3qZ5Y-yqSi0tOyWg';

app.post('/atualizar-sheets', async (req, res) => {
  try {
    console.log('▶️ POST /atualizar-sheets');

    if (!Array.isArray(req.body) || req.body.length === 0) {
      return res.status(400).send('❌ Dados inválidos.');
    }

    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    const values = req.body.map(({ nome, cpf, nascimento, tipo, comprovante }) => [
      nome,
      cpf,
      nascimento,
      tipo,
      comprovante || 'Sem comprovante',
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Página1!A1',
      valueInputOption: 'RAW',
      requestBody: { values },
    });

    console.log('✅ Dados salvos na planilha:', values);
    res.status(200).send('Dados enviados com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao atualizar planilha:', err);
    res.status(500).send('Erro ao atualizar a planilha.');
  }
});

app.post('/upload', async (req, res) => {
  try {
    console.log('📦 POST /upload');

    const { fileName, fileData } = req.body;

    if (!fileName || !fileData) {
      return res.status(400).json({ message: 'Arquivo inválido.' });
    }

    const client = await auth.getClient();
    const drive = google.drive({ version: 'v3', auth: client });

    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.from(fileData.split(',')[1], 'base64'));

    const upload = await drive.files.create({
      requestBody: {
        name: fileName,
        mimeType: 'image/jpeg',
      },
      media: {
        mimeType: 'image/jpeg',
        body: bufferStream,
      },
    });

    const fileId = upload.data.id;

    await drive.permissions.create({
      fileId,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const fileLink = `https://drive.google.com/uc?id=${fileId}`;

    console.log('✅ Comprovante salvo:', fileLink);

    res.status(200).json({ fileLink }); // <-- resposta essencial pro front
  } catch (err) {
    console.error('❌ Erro no upload:', err);
    res.status(500).json({ message: 'Erro ao enviar a imagem.', error: err });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
