import axios from 'axios';

export class EthosApiError extends Error {
  constructor(message, { status, method, url, data } = {}) {
    super(message);
    this.name = 'EthosApiError';
    this.status = status;
    this.method = method;
    this.url = url;
    this.data = data;
  }
}

export class EthosClient {
  constructor({ baseUrl, apiKey, contextToken }) {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Context-Token': contextToken,
        'Content-Type': 'application/json',
      },
    });
  }

  _wrapAxiosError(err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const method = err?.config?.method?.toUpperCase();
    const url = err?.config?.url;
    const message =
      data?.['hydra:description'] ||
      data?.message ||
      data?.detail ||
      err?.message ||
      'Ethos API request failed';

    return new EthosApiError(message, { status, method, url, data });
  }

  async get(path, config) {
    try {
      const res = await this.client.get(path, config);
      return res.data;
    } catch (e) {
      throw this._wrapAxiosError(e);
    }
  }

  async post(path, body, config) {
    try {
      const res = await this.client.post(path, body, config);
      return res.data;
    } catch (e) {
      throw this._wrapAxiosError(e);
    }
  }

  async patch(path, body, config) {
    try {
      const res = await this.client.patch(path, body, config);
      return res.data;
    } catch (e) {
      throw this._wrapAxiosError(e);
    }
  }
}

