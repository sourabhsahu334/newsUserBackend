import { google } from 'googleapis';

const getOAuth2Client = (user) => {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oAuth2Client.setCredentials({
    access_token: user.gmailAccessToken || user.accessToken,
    refresh_token: user.gmailRefreshToken || user.refreshToken
  });
  return oAuth2Client;
};

const getGoogleAuthUrl = (scopes, state) => {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL || 'https://www.neukaps.com/auth/google/callback'
  );

  const authOptions = {
    access_type: 'offline',
    scope: scopes || ['profile', 'email'],
    prompt: 'consent'
  };

  if (state) {
    authOptions.state = state;
  }

  return oAuth2Client.generateAuthUrl(authOptions);
};

export { getOAuth2Client, getGoogleAuthUrl };
export default getOAuth2Client;