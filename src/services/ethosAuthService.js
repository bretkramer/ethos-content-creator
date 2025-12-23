import axios from 'axios';
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';

export class EthosAuthService {
  constructor({ baseUrl }) {
    this.baseUrl = baseUrl;
  }

  async getOrganizations(email) {
    const response = await axios.get(`${this.baseUrl}/v1/organizations`, {
      params: { user_email: email },
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    return response.data.organizations || [];
  }

  authenticateUser(email, password, organization) {
    return new Promise((resolve, reject) => {
      const authenticationDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      const userPool = new CognitoUserPool({
        UserPoolId: organization.idpGroupId,
        ClientId: organization.idpClientId,
      });

      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });

      cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (result) => {
          resolve({
            accessToken: result.getAccessToken().getJwtToken(),
            idToken: result.getIdToken().getJwtToken(),
            refreshToken: result.getRefreshToken().getToken(),
            expiresIn: result.getAccessToken().getExpiration(),
          });
        },
        onFailure: (err) => reject(new Error(err?.message || 'Authentication failed')),
      });
    });
  }

  async getContextToken(apiKey, organizationId) {
    const response = await axios.post(
      `${this.baseUrl}/v1/contexts`,
      { org_id: organizationId },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/ld+json',
          Accept: 'application/ld+json',
        },
      },
    );

    return response.data.token;
  }

  async authenticate({ email, password, organizationId }) {
    const organizations = await this.getOrganizations(email);
    const organization = organizations.find((org) => org.id === organizationId);
    if (!organization) throw new Error('Organization not found');

    const cognitoResult = await this.authenticateUser(email, password, organization);
    const contextToken = await this.getContextToken(cognitoResult.accessToken, organizationId);

    return {
      apiKey: cognitoResult.accessToken,
      contextToken,
      idToken: cognitoResult.idToken,
      refreshToken: cognitoResult.refreshToken,
      expiresIn: cognitoResult.expiresIn,
      organizationId,
      baseUrl: this.baseUrl,
    };
  }
}

