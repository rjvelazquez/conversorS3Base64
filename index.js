require('dotenv').config();
const express = require('express');
const axios = require('axios');
const AWS = require('aws-sdk');
const app = express();

// Configura AWS con las credenciales y la región desde las variables de entorno
AWS.config.update({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
const s3 = new AWS.S3();

// Endpoint para recibir datos y enviarlos a MortgageBot
app.get('/enviar-a-mortgagebot', async (req, res) => {
  const { loanId, bucket, key } = req.query;
  console.log('Se recibio una solicitud');

  try {
    const documentoBase64 = await getDocumentFromS3(bucket, key);
    const accessToken = await obtenerAccessToken();
    const respuestaMortgageBot = await enviarADocumentoMortgageBot(loanId, documentoBase64, accessToken);

    res.json({ mensaje: 'Documento enviado con éxito', respuesta: respuestaMortgageBot });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al procesar la solicitud');
  }
});

const obtenerAccessToken = async () => {
  const clientId = process.env.CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET;
  const authUrl = process.env.AUTH_URL;

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);

  try {
    const response = await axios.post(authUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error al obtener el token de acceso:', error);
    throw error;
  }
};

const enviarADocumentoMortgageBot = async (loanId, documentoBase64, accessToken) => {
  const url = `https://api.fusionfabric.cloud/mortgagebot/los/document/v1/loans/${loanId}/documents`;
  const data = {
    documentType: 'ID',
    useBarcode: 'true',
    fileType: 'pdf',
    embeddedContent: documentoBase64,
  };

  try {
    const response = await axios.post(url, data, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error al enviar el documento a MortgageBot:', error);
    throw error;
  }
};

const getDocumentFromS3 = async (bucket, key) => {
  try {
    const params = { Bucket: bucket, Key: key };
    const data = await s3.getObject(params).promise();
    return data.Body.toString('base64');
  } catch (error) {
    console.error('Error al obtener el documento de S3:', error);
    throw error;
  }
};

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

