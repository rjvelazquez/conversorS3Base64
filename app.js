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
    const documentoBase64 = await getDocumentFromS3(String(bucket), String(key));
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

const enviarADocumentoMortgageBot = async (loanId, bucket, key, accessToken) => {
  const { documentoBase64, fileType } = await getDocumentFromS3(bucket, key);

  const url = `https://api.fusionfabric.cloud/mortgagebot/los/document/v1/loans/${loanId}/documents`;
  const data = {
    documentType: 'ID', // Ajusta según sea necesario
    useBarcode: 'true', // Ajusta según sea necesario
    fileType: fileType,
    embeddedContent: documentoBase64,
    name: key, // Suponiendo que 'key' es el nombre del archivo
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

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key
  });

  
  try {
    const { ContentType, Body } = await client.send(command);
    
    // Recopilar datos del stream en un buffer
    const buffer = await streamToBuffer(Body);

    // Convertir el buffer a base64
    const documentoBase64 = buffer.toString('base64');
    
    const fileType = ContentType.split('/').pop();

    return { documentoBase64, fileType };
  } catch (error) {
    console.error('Error al obtener el documento de S3:', error);
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
    console.log(process.env.AWS_REGION, process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_ACCESS_KEY);
  });

