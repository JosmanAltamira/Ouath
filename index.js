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
  console.log('=== Initiating OAuth 2.0 flow with HubSpot ===');
  console.log('');
  console.log("===> Step 1: Redirecting user to your app's OAuth URL");
  res.redirect(authUrl);
  console.log('===> Step 2: User is being prompted for consent by HubSpot');
});

// Paso 2
// se le solicita al usuario que le dé acceso a la aplicación al solicitado
// recursos.Todo esto lo hace HubSpot, por lo que no es necesario ningún trabajo
// Al final de la aplicación

// Paso 3
// recibir el código de autorización del servidor OAuth 2.0,
// y procesarlo en función de los parámetros de consulta que se pasan
app.get('/oauth-callback', async (req, res) => {
  console.log('===> Step 3: Handling the request sent by the server');

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
    console.log('===> Step 4: Exchanging authorization code for an access token and refresh token');
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

    console.log('       > Received an access token and refresh token');
    return tokens.access_token;
  } catch (e) {
    console.error(`       > Error exchanging ${exchangeProof.grant_type} for access token`);
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
    console.log('Refreshing expired access token');
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
  console.log('=== Retrieving a contact from HubSpot using the access token ===');
  try {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    console.log('===> Replace the following request.get() to test other API calls');
    console.log('===> request.get(\'https://api.hubapi.com/contacts/v1/lists/all/contacts/all?count=1\')');
    const result = await request.get('https://api.hubapi.com/contacts/v1/lists/all/contacts/all?count=1', {
      headers: headers
    });

    return JSON.parse(result).contacts[0];
  } catch (e) {
    console.error('  > Unable to retrieve contact');
    return JSON.parse(e.response.body);
  }
};

//========================================//
//   Mostrando información al usuario//
//========================================//

const displayContactName = (res, contact) => {
  if (contact.status === 'error') {
    res.write(`<p>Unable to retrieve contact! Error Message: ${contact.message}</p>`);
    return;
  }
  const { firstname, lastname } = contact.properties;
  res.write(`<p>Nombre de contacto: ${firstname.value} ${lastname.value}</p>`);
};

app.get('/', async (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.write(`<h2>Guarneros God</h2>`);
  if (isAuthorized(req.sessionID)) {
    const accessToken = await getAccessToken(req.sessionID);
    const contact = await getContact(accessToken);
    res.write(`<h4>Access token: ${accessToken}</h4>`);
    displayContactName(res, contact);
  } else {
    res.write(`<a href="/install"><h3>Instala la aplicación</h3></a>`);
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

