const express = require('express');
const axios = require('axios');
const AWS = require('aws-sdk');
const app = express();

// Configura AWS
AWS.config.update({ region: 'us-east-1' });
const s3 = new AWS.S3();

// Endpoint para recibir datos y enviarlos a MortgageBot
app.get('/enviar-a-mortgagebot', async (req, res) => {
    const { loanId, bucket, key } = req.query; // Obtiene los parámetros de la URL

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
    const clientId = 'f8d118b0-7b4b-4bef-bd33-75dbcaa863d4';
    const clientSecret = '7bd2eb75-45de-48c0-aa00-9ebe0b41821c';
    const authUrl = 'https://api.fusionfabric.cloud/login/v1/vigpr25173-prod/oidc/token';

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
        // Ajusta estos campos según la API de MortgageBot
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


const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
