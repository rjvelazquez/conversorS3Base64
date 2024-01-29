require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const jwt = require('jsonwebtoken'); // Importa jsonwebtoken
const app = express();

app.use(express.json()); // Para analizar el cuerpo de las solicitudes POST


// Configura AWS SDK v3
const s3 = new S3Client({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  }
});


// Middleware para verificar el token
// Middleware para verificar el token
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: 'Acceso denegado. No se proporcionó token.'
    });
  }

  // Dividir el encabezado para obtener el token
  const token = authHeader.split(' ')[1]; // Token es el segundo elemento después de "Bearer"

  try {
    const verificado = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.usuario = verificado;
    console.log('Token verificado');
    next();
  } catch (error) {
    let mensajeError = 'Token inválido';
    let statusCode = 400;

    if (error instanceof jwt.JsonWebTokenError) {
      mensajeError = 'Token inválido o mal formado';
    } else if (error instanceof jwt.TokenExpiredError) {
      mensajeError = 'Token expirado';
      statusCode = 401;
    } else if (error instanceof jwt.NotBeforeError) {
      mensajeError = 'Token aún no válido';
    }

    res.status(statusCode).json({
      success: false,
      message: mensajeError
    });
  }
}



// Endpoint para autenticación y generación de token
app.post('/authenticate', (req, res) => {
  const { username, password } = req.body;

  // Utiliza las variables de entorno para las credenciales
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ username }, process.env.JWT_SECRET_KEY, { expiresIn: '1h' });
    res.json({ token });
    console.log('Token solicitado');
  } else {
    res.status(401).send('Credenciales incorrectas');
  }
});

// Endpoint para recibir datos y enviarlos a MortgageBot
app.post('/enviar-a-mortgagebot', verificarToken, async (req, res) => {
  const { loanId, bucket, key, name } = req.body; // Cambiado a req.body para POST
  console.log('Se recibió una solicitud');
  console.log('Bucket:', bucket, 'Key:', key);
  //console.log('Tipo de Bucket:', typeof bucket, 'Tipo de Key:', typeof key);

  try {
    const accessToken = await obtenerAccessToken();
    const respuestaMortgageBot = await enviarADocumentoMortgageBot(loanId, bucket, key, accessToken, name);
    console.log('Respuesta de MortgageBot:', respuestaMortgageBot);

    res.json({ mensaje: 'Documento enviado con éxito', respuesta: respuestaMortgageBot });
  } catch (error) {
    console.error('Error al procesar la solicitud:', error);
    let errorMessage = 'Error desconocido al procesar la solicitud';
    let mortgageBotResponse = {};

    // Obtener respuesta de MortgageBot si está disponible
    if (error.response) {
      mortgageBotResponse = error.response.data;
      errorMessage = `Error del servidor: ${error.response.status} - ${JSON.stringify(mortgageBotResponse)}`;
    } else if (error.request) {
      errorMessage = 'Error: No se recibió respuesta del servidor';
    } else {
      errorMessage = `Error al configurar la solicitud: ${error.message}`;
    }

    console.log('Respuesta de MortgageBot (en caso de error):', mortgageBotResponse);
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

const enviarADocumentoMortgageBot = async (loanId, bucket, key, accessToken, name) => {
  const { documentoBase64, fileType } = await getDocumentFromS3(bucket, key);
  

  const url = `https://api.fusionfabric.cloud/mortgagebot/los/document/v1/loans/${loanId}/documents`;
  
  const form = new FormData();
  
// Ajusta el tamaño máximo del formulario
  form.maxDataSize = 100 * 1024 * 1024; // Por ejemplo, 10 MB
  form.append('documentType', name); // Ajusta este valor si es necesario
  form.append('useBarcode', 'true'); // Ajusta este valor si es necesario
  form.append('fileType', fileType); // 'pdf', 'png', etc.
  form.append('embeddedContent', documentoBase64);

  console.log('Base 64: ' + documentoBase64.substring(0, 100));

  // Genera un Idempotency-Key único para cada solicitud
  const idempotencyKey = generateIdempotencyKey();

  try {
    console.log('Preparando para enviar solicitud a MortgageBot');
    console.log(`URL: ${url}`);
    console.log('Headers:', form.getHeaders());

    if (!documentoBase64) {
      throw new Error('El documento en Base64 está vacío');
    }

    const response = await axios.post(url, form, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        //...form.getHeaders(),
        'Idempotency-Key': idempotencyKey
      }
    });

    return response.data;
  } catch (error) {
    console.error('Error al enviar el documento a MortgageBot:', error);
    if (error.response) {
      console.error('Detalle de la respuesta de error:', error.response);
    }
    throw error;
  }
};
const { v4: uuidv4 } = require('uuid');

function generateIdempotencyKey() {
  return uuidv4(); // Esto generará un UUID v4 único
}

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
  
    if (!buffer) {
      throw new Error('No se pudo obtener el buffer del documento de S3');
    }

    // Extraer la extensión del archivo del nombre del archivo (key)
    const extension = key.split('.').pop();

    // Convertir el buffer a base64
    const documentoBase64 = buffer.toString('base64');
    console.log('Tamaño de la cadena base64 (bytes):', Buffer.byteLength(documentoBase64, 'utf-8'));


    return { documentoBase64, fileType: extension };
  } catch (error) {
    console.error("Error al obtener el documento de S3:", error);
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


const PORT = process.env.PORT || 1024;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
  });

