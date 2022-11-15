require('dotenv').config();
const express = require('express');
const request = require('request-promise-native');
const NodeCache = require('node-cache');
const session = require('express-session');
const opn = require('open');
const app = express();


const PORT = 3000;


const refreshTokenStore = {};
const accessTokenCache = new NodeCache({ deleteOnExpire: true });

if (!process.env.CLIENT_ID || !process.env.CLIENT_SECRET) {
    throw new Error('Missing CLIENT_ID or CLIENT_SECRET environment variable.')
}

//===========================================================================//
// Configuración de la aplicación Hubspot
//
// Todos los siguientes valores deben coincidir con la configuración de configuración en su aplicación.
// Se utilizarán para construir la URL OAuth, que los usuarios visitan para comenzar
// Instalación.Si no coinciden con la configuración de su aplicación, los usuarios
// ver una página de error.

// reemplazar lo siguiente con los valores de la configuración de su autenticación de aplicación,
// o establecerlas como variables de entorno antes de ejecutar.

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

// Los alcances para esta aplicación serán predeterminados a `crm.objects.contacts.read`
// Para solicitar a otros, establezca la variable de entorno de alcance en su lugar

let SCOPES = ['crm.objects.contacts.read'];
if (process.env.SCOPE) {
    SCOPES = (process.env.SCOPE.split(/ |, ?|%20/)).join(' ');
}

// En una instalación exitosa, los usuarios serán redirigidos a /oauth-Callback
const REDIRECT_URI = `http://localhost:${PORT}/oauth-callback`;

//===========================================================================//

// Use una sesión para realizar un seguimiento de la identificación del cliente
app.use(session({
  secret: Math.random().toString(36).substring(2),
  resave: false,
  saveUninitialized: true
}));
 
//================================//
//   Ejecutando el flujo OAuth 2.0  //
//================================//

// Paso 1
// Cree la URL de autorización para redirigir a un usuario
// cuando eligen instalar la aplicación
const authUrl =
  'https://app.hubspot.com/oauth/authorize' +
  `?client_id=${encodeURIComponent(CLIENT_ID)}` + // ID de cliente de la aplicación
  `&scope=${encodeURIComponent(SCOPES)}` + // los ámbitos solicitados por la aplicación
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`; // dónde enviar al usuario después de la página de consentimiento

// redirige al usuario desde la página de instalación a
// La URL de autorización
app.get('/install', (req, res) => {
  console.log('');
  console.log('=== Iniciando el flujo OAuth 2.0 con Hubspot ===');
  console.log('');
  console.log("===> Paso 1: redirigir al usuario a la URL OAuth de su aplicación");
  res.redirect(authUrl);
  console.log('===> Paso 2: HubSpot le solicita el usuario.');
});

// Paso 2
// se le solicita al usuario que le dé acceso a la aplicación al solicitado
// recursos.Todo esto lo hace HubSpot, por lo que no es necesario ningún trabajo
// Al final de la aplicación

// Paso 3
// recibir el código de autorización del servidor OAuth 2.0,
// y procesarlo en función de los parámetros de consulta que se pasan
app.get('/oauth-callback', async (req, res) => {
  console.log('===> Paso 3: Manejo de la solicitud enviada por el servidor');

// recibió un código de autorización de usuario, así que ahora combina eso con el otro
  // Los valores requeridos e intercambiar tanto por un token de acceso como para un token de actualización
  if (req.query.code) {
    console.log('       > Received an authorization token');

    const authCodeProof = {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code: req.query.code
    };

  // Paso 4
    // intercambia el código de autorización por un token de acceso y actualización del token
    console.log('===> Paso 4: intercambiar código de autorización para un token de acceso y actualizar token');
    const token = await exchangeForTokens(req.sessionID, authCodeProof);
    if (token.message) {
      return res.redirect(`/error?msg=${token.message}`);
    }

// Una vez que se hayan recuperado los tokens, úsalos para hacer una consulta
    // a la API Hubspot
    res.redirect(`/`);
  }
});

//==========================================//
// Intercambiar pruebas de un token de acceso  //
//==========================================//

const exchangeForTokens = async (userId, exchangeProof) => {
  try {
    const responseBody = await request.post('https://api.hubapi.com/oauth/v1/token', {
      form: exchangeProof
    });
// Por lo general, estos datos de tokens deben persistir en una base de datos y asociarse con
    // Una identidad de usuario.
    const tokens = JSON.parse(responseBody);
    refreshTokenStore[userId] = tokens.refresh_token;
    accessTokenCache.set(userId, tokens.access_token, Math.round(tokens.expires_in * 0.75));

    console.log('       > Recibí un token de acceso y actualización de token');
    return tokens.access_token;
  } catch (e) {
    console.error(`       > Intercambio de errores${exchangeProof.grant_type} Para el token de acceso`);
    return JSON.parse(e.response.body);
  }
};

const refreshAccessToken = async (userId) => {
  const refreshTokenProof = {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    refresh_token: refreshTokenStore[userId]
  };
  return await exchangeForTokens(userId, refreshTokenProof);
};

const getAccessToken = async (userId) => {
// Si el token de acceso ha expirado, recupere
  // uno nuevo con el token de actualización
  if (!accessTokenCache.get(userId)) {
    console.log('Refrescante token de acceso vencido');
    await refreshAccessToken(userId);
  }
  return accessTokenCache.get(userId);
};

const isAuthorized = (userId) => {
  return refreshTokenStore[userId] ? true : false;
};

//====================================================//
//  Uso de un token de acceso para consultar la API HubSpot  //
//====================================================//

const getContact = async (accessToken) => {
  console.log('');
  console.log('=== Recuperar un contacto de Hubspot utilizando el token de acceso ===');
  try {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    console.log('===> Reemplace la siguiente solicitud.get () para probar otras llamadas de API');
    console.log('===> request.get(\'https://api.hubapi.com/contacts/v1/lists/all/contacts/all?count=1\')');
    const result = await request.get('https://api.hubapi.com/contacts/v1/lists/all/contacts/all?count=1', {
      headers: headers
    });

    return JSON.parse(result).contacts[0];
  } catch (e) {
    console.error('  > Incapaz de recuperar el contacto');
    return JSON.parse(e.response.body);
  }
};

//========================================//
//   Mostrando información al usuario//
//========================================//

const displayContactName = (res, contact) => {
  if (contact.status === 'error') {
    res.write(`<p>¡No se puede recuperar el contacto!Mensaje de error: ${contact.message}</p>`);
    return;
  }
  const { firstname, lastname } = contact.properties;
  res.write(`<p><center>Nombre de contacto: ${firstname.value} ${lastname.value}</center></p>`);
};

app.get('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.write(`<h1 style="color:blue;"><center>Neu-traz</center></h1>`);
  if (isAuthorized(req.sessionID)) {
    const accessToken = await getAccessToken(req.sessionID);
    const contact = await getContact(accessToken);
    res.write(`<p><h4><center>Token de acceso:</center><h4><p>
               <p><h4><center>${accessToken}</center> </h4><p>`);
    displayContactName(res, contact);
  } else {
    res.write(`<a href="/install"><h3><center>Acceso al sistema</center></h3></a>`);
  }
  res.end();
});

app.get('/error', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.write(`<h4>Error: ${req.query.msg}</h4>`);
  res.end();
});


app.listen(PORT, () => console.log(`=== Starting your app on http://localhost:${PORT} ===`));
opn(`http://localhost:${PORT}`);

