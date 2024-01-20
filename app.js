require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const app = express();



// Configura AWS SDK v3
const s3 = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});


// Endpoint para recibir datos y enviarlos a MortgageBot
app.get('/enviar-a-mortgagebot', async (req, res) => {
  const { loanId, bucket, key } = req.query;
  console.log('Se recibio una solicitud');
  console.log('Bucket:', bucket, 'Key:', key);
  console.log('Tipo de Bucket:', typeof bucket, 'Tipo de Key:', typeof key);

  try {
    const accessToken = await obtenerAccessToken();
    const respuestaMortgageBot = await enviarADocumentoMortgageBot(loanId, bucket, key, accessToken);

    res.json({ mensaje: 'Documento enviado con éxito', respuesta: respuestaMortgageBot });
  } catch (error) {
    console.error('Error al procesar la solicitud:', error);

    let errorMessage = 'Error desconocido al procesar la solicitud';

    // Construir el mensaje de error basado en la respuesta del servidor o el error generado
    if (error.response) {
      // La solicitud fue hecha y el servidor respondió con un estado de error
      errorMessage = `Error del servidor: ${error.response.status} - ${error.response.data}`;
    } else if (error.request) {
      // La solicitud fue hecha pero no se recibió respuesta
      errorMessage = 'Error: No se recibió respuesta del servidor';
    } else {
      // Algo ocurrió al configurar la solicitud que generó un Error
      errorMessage = `Error al configurar la solicitud: ${error.message}`;
    }

    // Enviar el mensaje de error en la respuesta HTTP
    res.status(500).send(errorMessage);
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

const FormData = require('form-data');

const enviarADocumentoMortgageBot = async (loanId, bucket, key, accessToken) => {
  const { documentoBase64, fileType } = await getDocumentFromS3(bucket, key);

  const url = `https://api.fusionfabric.cloud/mortgagebot/los/document/v1/loans/${loanId}/documents`;
  
  const form = new FormData();
  form.append('documentType', 'ID'); // Ajusta este valor si es necesario
  form.append('useBarcode', 'true'); // Ajusta este valor si es necesario
  form.append('fileType', fileType); // 'pdf', 'png', etc.
  form.append('embeddedContent', documentoBase64, {
    filename: key, 
    contentType: 'pdf',
    knownLength: documentoBase64.length
  });

  try {
    const response = await axios.post(url, form, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'multipart/form-datas',
        ...form.getHeaders(),
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error al enviar el documento a MortgageBot:', error);
    throw error;
  }
};

const getDocumentFromS3 = async (bucket, key) => {
  // Asegúrate de que bucket y key no sean undefined
  if (!bucket || !key) {
    throw new Error('Bucket o Key no proporcionados');
  }

  const client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

    
  try {
    
    const command = new GetObjectCommand({Bucket: bucket, Key: key });
    const { ContentType, Body } = await client.send(command);
    const buffer = await streamToBuffer(Body);
  
    // Usa ContentType como fallback
    const mimeType = ContentType || 'application/octet-stream';
  

  // Convertir el buffer a base64
  const documentoBase64 = buffer.toString('base64');

  return { documentoBase64, fileType: mimeType };
  } catch (error) {
    if (error.message.includes("bucketName.split")) {
      console.error("Error específico con el bucket:", bucket);
      console.error(bucket);
    }
    throw error;
  }
};


// Función para convertir un stream a un buffer
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}


const PORT = process.env.PORT || 8081;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
  });

