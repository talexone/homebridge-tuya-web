/**
 * SmartLife Cloud API Constants
 * These constants are specific to the SmartLife application
 */

// SmartLife App credentials
export const APP_KEY = "ekmnwp9f5pnh3trdtpgy";
export const APP_SECRET = "r3me7ghmxjevrvnpemwmhw3fxtacphyg";
export const APP_SECRET_2 = "jfg5rs5kkmrj5mxahugvucrsvw43t48x";
export const APP_CERT_SHA256 =
  "0F:C3:61:99:9C:C0:C3:5B:A8:AC:A5:7D:AA:55:93:A2:0C:F5:57:27:70:2E:A8:5A:D7:B3:22:89:49:F8:88:FE";
export const APP_TTID = "smartlife";
export const ET_VERSION = "0.0.1";

// API Endpoints - supporting both formats
export const ENDPOINTS = {
  us: [
    "https://a1-us.lifeaiot.com/api.json",
    "https://a1.tuyaus.com/api.json",
  ],
  eu: [
    "https://a1-eu.lifeaiot.com/api.json",
    "https://a1.tuyaeu.com/api.json",
  ],
  in: [
    "https://a1-in.lifeaiot.com/api.json",
    "https://a1.tuyain.com/api.json",
  ],
} as const;

export type Region = keyof typeof ENDPOINTS;

// Error codes that should not trigger login retry
export const LOGIN_NON_RETRYABLE_CODES = new Set([
  "USER_PASSWD_WRONG",
  "USER_LOGIN_INVALID",
  "USER_NOT_EXISTS",
  "USER_NOT_REGISTER",
]);

// Error codes indicating session expiration
export const SESSION_ERROR_CODES = new Set([
  "USER_SESSION_INVALID",
  "TOKEN_INVALID",
  "TOKEN_EXPIRED",
]);

// Error codes that should trigger retry
export const RETRYABLE_CODES = new Set([
  "FrequentlyInvoke",
  "FREQUENTLY_INVOKE",
  "SYSTEM_ERROR",
  "REQUEST_ERROR",
]);

// Keys that are included in the request signature
export const SIGNED_KEYS = new Set([
  "a",
  "v",
  "lat",
  "lon",
  "lang",
  "deviceId",
  "imei",
  "imsi",
  "appVersion",
  "ttid",
  "isH5",
  "h5Token",
  "os",
  "clientId",
  "postData",
  "time",
  "requestId",
  "n4h5",
  "sid",
  "sp",
  "et",
]);

// Cooldown period after non-retryable auth error
export const NON_RETRYABLE_AUTH_COOLDOWN_MS = 30000;

// Default request timeout
export const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

// Default max retries
export const DEFAULT_MAX_RETRIES = 3;
