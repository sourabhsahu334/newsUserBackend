import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  googleId: { type: String, required: false, unique: true },
  email: String,
  name: String,
  accessToken: String,
  refreshToken: String,
  msId: { type: String, unique: false, sparse: true },
  msEmail: String,
  msAccessToken: String,
  msRefreshToken: String,
  msIdToken: String,
  msGrantedScopes: [String],
  googleGrantedScopes: [String],
  gmailAccessToken: String,
  gmailRefreshToken: String,
  gmailGrantedScopes: [String],
  zoomId: { type: String, unique: false, sparse: true },
  zoomEmail: String,
  zoomAccessToken: String,
  zoomRefreshToken: String,
  zoomGrantedScopes: [String],
  slackId: { type: String, unique: false, sparse: true },
  slackEmail: String,
  slackAccessToken: String,
  slackTeamId: String,
  slackTeamName: String,
  slackGrantedScopes: [String],
  // Instagram integration fields
  instagramId: { type: String, unique: false, sparse: true },
  instagramUsername: String,
  instagramAccessToken: String,
  instagramGrantedScopes: [String],
  // Meta (Facebook) integration fields
  metaId: { type: String, unique: false, sparse: true },
  metaEmail: String,
  metaAccessToken: String,
  metaGrantedScopes: [String],
  metaPageTokens: [{
    pageId: String,
    pageName: String,
    accessToken: String
  }],
  activeColumn: {
    type: [String],
    default: [
      "fit_status",
      "current_company",
      "mobile",
      "summary",
      "collegename",
      "skillsets",
      "total_skills",
      "total_experience",
      "total_experience_months",
      "number_of_companies",
      "latest_company",
      "latest_start_date",
      "latest_end_date",
      "latest_duration_months",
      "experience_history"
    ]
  },
  passwordHash: String,
});

export default mongoose.model('User', userSchema); 