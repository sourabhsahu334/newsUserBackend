const { google } = require('googleapis');

const getOAuth2Client = (user) => {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oAuth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken
  });
  return oAuth2Client;
};

module.exports = getOAuth2Client; 