/**
 * Type definitions for SmartLife Cloud API
 */

import { Region } from "./smartlife-constants";

/**
 * SmartLife API Error
 */
export class SmartLifeApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public payload?: unknown,
  ) {
    super(message);
    this.name = "SmartLifeApiError";
  }
}

/**
 * SmartLife Client Configuration
 */
export interface SmartLifeClientConfig {
  username: string;
  password: string;
  countryCode: string;
  region?: Region | "auto";
  requestTimeoutMs?: number;
  maxRetries?: number;
  logLevel?: "info" | "debug" | "trace";
}

/**
 * Login token response
 */
export interface LoginTokenResponse {
  token: string;
  publicKey?: string;
  exponent?: string;
  pbKey?: string;
}

/**
 * Login response
 */
export interface LoginResponse {
  sid: string;
  domain?: {
    mobileApiUrl?: string;
  };
}

/**
 * SmartLife API request
 */
export interface SmartLifeRequest {
  action: string;
  version?: string;
  data?: Record<string, unknown>;
  requiresSid?: boolean;
}

/**
 * SmartLife API response
 */
export interface SmartLifeResponse<T = unknown> {
  success: boolean;
  result?: T;
  errorCode?: string;
  errorMsg?: string;
}

/**
 * Query params for signed requests
 */
export interface SignedQueryParams {
  a: string;
  deviceId: string;
  os: string;
  lang: string;
  v: string;
  clientId: string;
  time: string;
  et: string;
  ttid: string;
  appVersion: string;
  appRnVersion?: string;
  platform?: string;
  requestId: string;
  postData?: string;
  sid?: string;
  sign: string;
}

/**
 * Device information from SmartLife
 */
export interface SmartLifeDevice {
  id: string;
  name: string;
  localKey: string;
  category: string;
  productId: string;
  sub?: boolean;
  uuid?: string;
  online?: boolean;
  iconUrl?: string;
  ip?: string;
  lat?: string;
  lon?: string;
  model?: string;
  timeZone?: string;
  activeTime?: number;
  createTime?: number;
  updateTime?: number;
  bizType?: number;
  isLocalOnline?: boolean;
  dps?: Record<string, unknown>;
}

/**
 * Home information
 */
export interface SmartLifeHome {
  groupId: string;
  name: string;
  displayOrder?: number;
  homeId?: number;
}

/**
 * Logger interface
 */
export interface Logger {
  info(message: string, ...parameters: unknown[]): void;
  warn(message: string, ...parameters: unknown[]): void;
  error(message: string, ...parameters: unknown[]): void;
  debug(message: string, ...parameters: unknown[]): void;
}
