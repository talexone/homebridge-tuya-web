/**
 * SmartLife Cloud API Client
 * Based on the SmartLife mobile app API
 */

import { randomUUID } from "crypto";
import { URLSearchParams } from "url";
import fetch from "axios";
import {
  APP_KEY,
  APP_SECRET,
  APP_SECRET_2,
  APP_CERT_SHA256,
  APP_TTID,
  ET_VERSION,
  ENDPOINTS,
  SIGNED_KEYS,
  LOGIN_NON_RETRYABLE_CODES,
  SESSION_ERROR_CODES,
  RETRYABLE_CODES,
  NON_RETRYABLE_AUTH_COOLDOWN_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
} from "./smartlife-constants";
import {
  mobileHash,
  createHmacSignature,
  md5Hash,
  randomDeviceId,
  encryptPasswordWithPublicKeyExponent,
  encryptPasswordWithPbKey,
} from "../helpers/crypto";
import {
  SmartLifeApiError,
  SmartLifeClientConfig,
  SmartLifeRequest,
  SmartLifeResponse,
  SignedQueryParams,
  LoginTokenResponse,
  LoginResponse,
  Logger,
  ProductRef,
  ProductStandardConfig,
  ProductSchemaItem,
} from "./smartlife-types";

/**
 * Utility functions
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  const base = 500;
  const max = 8000;
  const raw = Math.min(max, base * Math.pow(2, attempt - 1));
  const jitter = Math.floor(Math.random() * 300);
  return raw + jitter;
}

function normalizeApiUrl(url: string): string {
  if (url.endsWith("/api.json")) {
    return url;
  }
  return `${url.replace(/\/$/, "")}/api.json`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

/**
 * SmartLife Cloud Client
 */
export class SmartLifeClient {
  private username: string;
  private password: string;
  private countryCode: string;
  private region: string;
  private requestTimeoutMs: number;
  private maxRetries: number;
  private logLevel: "info" | "debug" | "trace";
  private logger: Logger;

  private hmacSecret = `${APP_CERT_SHA256}_${APP_SECRET_2}_${APP_SECRET}`;
  private deviceId = randomDeviceId(44);
  private sid?: string;
  private endpoint: string;
  private loginPromise?: Promise<void>;
  private lastNonRetryableAuthError?: SmartLifeApiError;
  private lastNonRetryableAuthErrorAtMs = 0;
  private productRefsByHome: Map<string, Map<string, ProductRef>> = new Map();

  constructor(config: SmartLifeClientConfig, logger: Logger) {
    this.username = config.username;
    this.password = config.password;
    this.countryCode = config.countryCode;
    this.region = config.region || "auto";
    this.requestTimeoutMs = config.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxRetries = config.maxRetries || DEFAULT_MAX_RETRIES;
    this.logLevel = config.logLevel || "info";
    this.logger = logger;

    // Set initial endpoint
    this.endpoint = ENDPOINTS.us[0];
  }

  /**
   * Execute a SmartLife API request with retries
   */
  public async request<T = unknown>(
    request: SmartLifeRequest,
  ): Promise<T | undefined> {
    let lastError: Error | undefined;

    for (let attempts = 1; attempts <= this.maxRetries; attempts++) {
      try {
        await this.ensureSession();

        const result = await this.requestRaw<T>(request);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Handle session errors with re-authentication
        if (this.isSessionError(error)) {
          if (attempts < this.maxRetries) {
            this.debug(
              "Session expired for action=%s attempt=%s, re-authenticating.",
              request.action,
              attempts,
            );
            this.sid = undefined;
            continue;
          }
          throw error;
        }

        // Check if we should retry
        if (!this.shouldRetry(error)) {
          throw error;
        }

        // If it's the last attempt, throw
        if (attempts >= this.maxRetries) {
          throw error;
        }

        // Backoff and retry
        const delayMs = backoffDelay(attempts);
        this.debug(
          "Retrying action=%s attempt=%s/%s after %sms due to: %s",
          request.action,
          attempts,
          this.maxRetries,
          delayMs,
          toErrorMessage(error),
        );
        await sleep(delayMs);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Unknown SmartLife request error");
  }

  /**
   * Ensure we have a valid session
   */
  private async ensureSession(forceLogin = false): Promise<void> {
    if (this.sid && !forceLogin) {
      return;
    }

    if (this.loginPromise) {
      await this.loginPromise;
      if (this.sid) {
        return;
      }
    }

    if (forceLogin) {
      this.sid = undefined;
    }

    // Check cooldown for non-retryable auth errors
    if (this.lastNonRetryableAuthError) {
      const elapsedMs = Date.now() - this.lastNonRetryableAuthErrorAtMs;
      if (elapsedMs < NON_RETRYABLE_AUTH_COOLDOWN_MS) {
        const remainingMs = NON_RETRYABLE_AUTH_COOLDOWN_MS - elapsedMs;
        this.warn(
          "Skipping login retry for %sms after non-retryable auth error: %s",
          remainingMs,
          this.lastNonRetryableAuthError.code,
        );
        throw this.lastNonRetryableAuthError;
      }
    }

    this.loginPromise = this.login().finally(() => {
      this.loginPromise = undefined;
    });

    await this.loginPromise;
  }

  /**
   * Perform SmartLife login (2-step process)
   */
  private async login(): Promise<void> {
    const endpoints = this.getEndpointOrder();
    let lastError: Error | undefined;

    for (const endpoint of endpoints) {
      try {
        this.endpoint = endpoint;
        this.debug("Attempting SmartLife login via %s", endpoint);

        // Step 1: Get login token
        const token = await this.requestRaw<LoginTokenResponse>({
          action: "thing.m.user.username.token.get",
          version: "2.0",
          requiresSid: false,
          data: {
            countryCode: this.countryCode,
            username: this.username,
            isUid: false,
          },
        });

        if (!token || typeof token.token !== "string" || token.token.length === 0) {
          throw new SmartLifeApiError(
            "NO_TOKEN",
            "Missing login token in SmartLife response",
            token,
          );
        }

        // Step 2: Login with encrypted password
        const loginAction = this.username.includes("@")
          ? "thing.m.user.email.password.login"
          : "thing.m.user.mobile.passwd.login";
        const loginVersion = this.username.includes("@") ? "3.0" : "4.0";

        const login = await this.requestRaw<LoginResponse>({
          action: loginAction,
          version: loginVersion,
          requiresSid: false,
          data: this.buildLoginPayload(token),
        });

        if (!login || typeof login.sid !== "string" || login.sid.length === 0) {
          throw new SmartLifeApiError(
            "NO_SESSION",
            "Missing sid in login response",
            login,
          );
        }

        this.sid = login.sid;
        this.lastNonRetryableAuthError = undefined;
        this.lastNonRetryableAuthErrorAtMs = 0;

        // Update endpoint if provided in response
        if (
          typeof login.domain?.mobileApiUrl === "string" &&
          login.domain.mobileApiUrl.length > 0
        ) {
          this.endpoint = normalizeApiUrl(login.domain.mobileApiUrl);
        }

        this.info("Authenticated with SmartLife cloud endpoint: %s", this.endpoint);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (
          error instanceof SmartLifeApiError &&
          LOGIN_NON_RETRYABLE_CODES.has(error.code)
        ) {
          this.lastNonRetryableAuthError = error;
          this.lastNonRetryableAuthErrorAtMs = Date.now();
          throw error;
        }

        this.warn("SmartLife login failed on %s: %s", endpoint, toErrorDetails(error));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("SmartLife authentication failed");
  }

  /**
   * Build login payload with encrypted password
   */
  private buildLoginPayload(
    token: LoginTokenResponse,
  ): Record<string, unknown> {
    const passwordMd5Hex = md5Hash(this.password);
    let encryptedPassword = passwordMd5Hex;
    let ifencrypt = 0;

    // Try encryption with publicKey and exponent first
    if (
      typeof token.publicKey === "string" &&
      token.publicKey.length > 0 &&
      typeof token.exponent === "string" &&
      token.exponent.length > 0
    ) {
      try {
        encryptedPassword = encryptPasswordWithPublicKeyExponent(
          passwordMd5Hex,
          token.publicKey,
          token.exponent,
        );
        ifencrypt = 1;
      } catch (error) {
        this.warn(
          "RSA password encryption (publicKey/exponent) failed, fallback to next method: %s",
          toErrorMessage(error),
        );
      }
    }

    // Fallback to pbKey encryption
    if (ifencrypt === 0 && typeof token.pbKey === "string" && token.pbKey.length > 0) {
      try {
        encryptedPassword = encryptPasswordWithPbKey(passwordMd5Hex, token.pbKey);
        ifencrypt = 1;
      } catch (error) {
        this.warn(
          "RSA password encryption (pbKey) failed, fallback to md5-hex password: %s",
          toErrorMessage(error),
        );
      }
    }

    const payload: Record<string, unknown> = {
      countryCode: this.countryCode,
      [this.username.includes("@") ? "email" : "mobile"]: this.username,
      passwd: encryptedPassword,
      options: '{"group": 1,"mfaCode": ""}',
      token: token.token,
      ifencrypt,
    };

    return payload;
  }

  /**
   * Execute raw API request
   */
  private async requestRaw<T = unknown>(
    request: SmartLifeRequest,
  ): Promise<T | undefined> {
    const requiresSid = request.requiresSid !== false;

    if (requiresSid && !this.sid) {
      throw new SmartLifeApiError(
        "USER_SESSION_INVALID",
        "Session is not available",
      );
    }

    const params = this.buildSignedQueryParams(request, requiresSid);
    const url = this.endpoint;
    const formBody = new URLSearchParams(params as Record<string, string>).toString();

    this.trace("HTTP POST %s", url);

    try {
      const response = await fetch.post(url, formBody, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: this.requestTimeoutMs,
      });

      let payload: SmartLifeResponse<T>;

      try {
        payload = response.data;
      } catch (error) {
        throw new SmartLifeApiError(
          "INVALID_RESPONSE",
          `Invalid JSON for ${request.action}: ${toErrorMessage(error)}`,
          JSON.stringify(response.data).slice(0, 500),
        );
      }

      if (!payload || typeof payload !== "object") {
        throw new SmartLifeApiError(
          "INVALID_RESPONSE",
          `Invalid response object for ${request.action}`,
          payload,
        );
      }

      this.trace("HTTP response for %s", request.action);

      if (!payload.success) {
        throw new SmartLifeApiError(
          payload.errorCode ?? "UNKNOWN_API_ERROR",
          payload.errorMsg ?? "Unknown API error",
          payload,
        );
      }

      return payload.result;
    } catch (error: any) {
      if (error instanceof SmartLifeApiError) {
        throw error;
      }
      if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
        throw new SmartLifeApiError(
          "REQUEST_TIMEOUT",
          `SmartLife request timed out: ${request.action}`,
        );
      }
      if (error.response) {
        throw new SmartLifeApiError(
          `HTTP_${error.response.status}`,
          `HTTP ${error.response.status} ${error.response.statusText}`,
        );
      }
      throw new SmartLifeApiError(
        "NETWORK_ERROR",
        `Network error for ${request.action}: ${toErrorMessage(error)}`,
      );
    }
  }

  /**
   * Build signed query parameters
   */
  private buildSignedQueryParams(
    request: SmartLifeRequest,
    requiresSid: boolean,
  ): Partial<SignedQueryParams> {
    const now = Math.floor(Date.now() / 1000).toString();

    const params: Partial<SignedQueryParams> = {
      a: request.action,
      deviceId: this.deviceId,
      os: "Android",
      lang: "en",
      v: request.version ?? "1.0",
      clientId: APP_KEY,
      time: now,
      et: ET_VERSION,
      ttid: APP_TTID,
      appVersion: "6.6.0",
      appRnVersion: "5.11",
      platform: "Android",
      requestId: randomUUID(),
    };

    if (request.data) {
      params.postData = JSON.stringify(request.data);
    }

    if (requiresSid && this.sid) {
      params.sid = this.sid;
    }

    params.sign = createHmacSignature(
      this.hmacSecret,
      this.buildStringToSign(params),
    );

    return params;
  }

  /**
   * Build the string to sign for HMAC
   */
  private buildStringToSign(params: Partial<SignedQueryParams>): string {
    const sortedKeys = Object.keys(params).sort((a, b) => a.localeCompare(b));
    const parts: string[] = [];

    for (const key of sortedKeys) {
      const value = params[key as keyof SignedQueryParams];
      if (!SIGNED_KEYS.has(key) || value === undefined || value.length === 0) {
        continue;
      }

      if (key === "postData") {
        parts.push(`${key}=${mobileHash(value)}`);
      } else {
        parts.push(`${key}=${value}`);
      }
    }

    return parts.join("||");
  }

  /**
   * Get endpoint order based on region preference
   */
  private getEndpointOrder(): string[] {
    const allEndpoints: string[] = [
      ...ENDPOINTS.us,
      ...ENDPOINTS.eu,
      ...ENDPOINTS.in,
    ];

    if (this.region === "auto") {
      return allEndpoints;
    }

    const preferred = ENDPOINTS[this.region as keyof typeof ENDPOINTS] as readonly string[];
    if (!preferred) {
      return allEndpoints;
    }

    const preferredArray: string[] = [...preferred];
    return [
      ...preferredArray,
      ...allEndpoints.filter((endpoint) => !preferredArray.includes(endpoint)),
    ];
  }

  /**
   * Check if error is a session error
   */
  private isSessionError(error: unknown): boolean {
    if (!(error instanceof SmartLifeApiError)) {
      return false;
    }

    if (SESSION_ERROR_CODES.has(error.code)) {
      return true;
    }

    if (error.code === "HTTP_401" || error.code === "HTTP_403") {
      return true;
    }

    const normalizedCode = error.code.toLowerCase();
    return normalizedCode.includes("session") || normalizedCode.includes("token");
  }

  /**
   * Check if error should trigger retry
   */
  private shouldRetry(error: unknown): boolean {
    if (!(error instanceof SmartLifeApiError)) {
      return true;
    }

    if (this.isSessionError(error)) {
      return true;
    }

    if (RETRYABLE_CODES.has(error.code)) {
      return true;
    }

    if (/^HTTP_(429|5\d\d)$/.test(error.code)) {
      return true;
    }

    const normalized = error.code.toLowerCase();
    return (
      normalized.includes("timeout") ||
      normalized.includes("network") ||
      normalized.includes("invalid_response") ||
      normalized.includes("http_429") ||
      normalized.includes("http_5")
    );
  }

  /**
   * List all homes in the account
   */
  public async listHomes(): Promise<unknown[]> {
    const response = await this.request({
      action: "m.life.home.space.list",
      version: "1.0",
      requiresSid: true,
    });

    if (!Array.isArray(response)) {
      this.debug("Unexpected homes payload: %j", response);
      return [];
    }

    return response.filter(
      (item): item is object => typeof item === "object" && item !== null,
    );
  }

  /**
   * List all devices in a home
   */
  public async listHomeDevices(
    homeId: string | number,
    includeProductRefs: boolean = true,
  ): Promise<unknown[]> {
    const devicesResponse = await this.request({
      action: "m.life.my.group.device.list",
      version: "2.2",
      requiresSid: true,
      data: {
        gid: homeId,
      },
    });

    if (!Array.isArray(devicesResponse)) {
      this.debug(
        "Unexpected devices payload for home %s: %j",
        homeId,
        devicesResponse,
      );
      return [];
    }

    const homeIdStr = String(homeId);
    let productRefMap = this.productRefsByHome.get(homeIdStr) ?? new Map<string, ProductRef>();

    // Fetch product references to get category information
    if (includeProductRefs || productRefMap.size === 0) {
      try {
        productRefMap = await this.getProductRefMap(homeId);
        this.productRefsByHome.set(homeIdStr, productRefMap);
        this.debug(
          "Fetched %d product references for home %s",
          productRefMap.size,
          homeId,
        );
      } catch (error) {
        this.debug(
          "Product references fetch failed for home %s: %s",
          homeId,
          toErrorMessage(error),
        );
      }
    }

    // Enrich devices with product reference data (including category)
    return devicesResponse
      .filter((item): item is object => typeof item === "object" && item !== null)
      .map((device: any) => {
        const productId = typeof device.productId === "string" ? device.productId : undefined;
        const ref = productId ? productRefMap.get(productId) : undefined;
        const refConfig = ref?.standardConfig;

        return {
          ...device,
          homeId,
          category: device.category ?? ref?.category,
          categoryCode: device.categoryCode ?? ref?.categoryCode,
          productStandardConfig: device.productStandardConfig ?? refConfig,
        };
      });
  }

  /**
   * Get product reference map for a home
   * This provides category information and DP schemas for devices
   */
  private async getProductRefMap(
    homeId: string | number,
  ): Promise<Map<string, ProductRef>> {
    const response = await this.request({
      action: "m.life.device.ref.info.my.list",
      version: "7.2",
      requiresSid: true,
      data: {
        gid: homeId,
        zigbeeGroup: true,
      },
    });

    const result = new Map<string, ProductRef>();

    if (!Array.isArray(response)) {
      return result;
    }

    for (const item of response) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const ref = this.normalizeProductRef(item as any);
      if (ref?.productId) {
        result.set(ref.productId, ref);
      }
    }

    return result;
  }

  /**
   * Normalize product reference data
   */
  private normalizeProductRef(raw: any): ProductRef | undefined {
    const productId =
      typeof raw.id === "string" && raw.id.length > 0
        ? raw.id
        : typeof raw.productId === "string" && raw.productId.length > 0
          ? raw.productId
          : undefined;

    if (!productId) {
      return undefined;
    }

    const schemaText = raw.schemaInfo?.schema;
    let parsedSchema: ProductSchemaItem[] = [];

    if (typeof schemaText === "string" && schemaText.length > 0) {
      try {
        const value = JSON.parse(schemaText);
        if (Array.isArray(value)) {
          parsedSchema = value.filter(
            (item): item is ProductSchemaItem =>
              typeof item === "object" && item !== null,
          );
        }
      } catch {
        parsedSchema = [];
      }
    }

    const functionSchemaList: Array<{
      standardCode: string;
      relationDpIdMaps: { dpId: string };
    }> = [];
    const statusSchemaList: Array<{
      dpCode: string;
      relationDpIdMaps: { dpId: string };
    }> = [];

    for (const schema of parsedSchema) {
      const code =
        typeof schema.code === "string" && schema.code.length > 0
          ? schema.code
          : undefined;
      const idValue =
        schema.id === undefined || schema.id === null
          ? undefined
          : String(schema.id);

      if (!code || !idValue) {
        continue;
      }

      const relationDpIdMaps = { dpId: idValue };
      statusSchemaList.push({ dpCode: code, relationDpIdMaps });

      const mode = typeof schema.mode === "string" ? schema.mode : "";
      if (mode.includes("w")) {
        functionSchemaList.push({ standardCode: code, relationDpIdMaps });
      }
    }

    const standardConfig: ProductStandardConfig = {
      productId,
      category: raw.category,
      functionSchemaList,
      statusSchemaList,
    };

    return {
      ...raw,
      productId,
      standardConfig,
    };
  }

  /**
   * Get product specifications including category
   */
  public async getProductSpec(productId: string): Promise<unknown> {
    return this.request({
      action: "tuya.m.product.info.get",
      version: "1.0",
      requiresSid: true,
      data: {
        product_id: productId,
      },
    });
  }

  /**
   * Publish data points to a device
   */
  public async publishDp(
    devId: string,
    dps: Record<string, unknown>,
  ): Promise<void> {
    await this.request({
      action: "thing.m.device.dp.publish",
      version: "1.0",
      requiresSid: true,
      data: {
        devId,
        dps: JSON.stringify(dps),
      },
    });
  }

  /**
   * Get device data points
   */
  public async getDeviceDp(devId: string): Promise<Record<string, unknown>> {
    const response = await this.request({
      action: "thing.m.device.dp.get",
      version: "1.0",
      requiresSid: true,
      data: {
        devId,
      },
    });

    return typeof response === "object" && response !== null
      ? (response as Record<string, unknown>)
      : {};
  }

  /**
   * Logging methods
   */
  private info(message: string, ...parameters: unknown[]): void {
    this.logger.info(message, ...parameters);
  }

  private warn(message: string, ...parameters: unknown[]): void {
    this.logger.warn(message, ...parameters);
  }

  private debug(message: string, ...parameters: unknown[]): void {
    if (this.logLevel === "debug" || this.logLevel === "trace") {
      this.logger.debug(message, ...parameters);
    }
  }

  private trace(message: string, ...parameters: unknown[]): void {
    if (this.logLevel === "trace") {
      this.logger.debug(message, ...parameters);
    }
  }
}
