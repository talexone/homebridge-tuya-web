/**
 * SmartLife Web API Service
 * This service provides compatibility with the old TuyaWebApi interface
 * while using the new SmartLife Cloud API under the hood
 */

import { Logger } from "homebridge";
import {
  AuthenticationError,
  RateLimitError,
  UnsupportedOperationError,
} from "../errors";
import { DeviceOfflineError } from "../errors/DeviceOfflineError";
import { SmartLifeClient } from "./smartlife-client";
import { SmartLifeApiError } from "./smartlife-types";
import { TuyaDevice } from "./response";

export interface SmartLifeWebApiConfig {
  username: string;
  password: string;
  countryCode: string;
  region?: "us" | "eu" | "in" | "auto";
  requestTimeoutMs?: number;
  maxRetries?: number;
  logLevel?: "info" | "debug" | "trace";
}

/**
 * SmartLife Web API
 * Provides a bridge between the old TuyaWebApi interface and the new SmartLife API
 */
export class SmartLifeWebApi {
  private client: SmartLifeClient;
  private devicesCache: TuyaDevice[] = [];
  private lastDiscoveryTime = 0;
  private discoveryPromise?: Promise<TuyaDevice[] | undefined>;
  private log?: Logger;

  constructor(config: SmartLifeWebApiConfig, log?: Logger) {
    this.log = log;
    const logger: Logger = log || {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
      success: console.log,
      log: console.log,
    };

    this.client = new SmartLifeClient(
      {
        username: config.username,
        password: config.password,
        countryCode: config.countryCode,
        region: config.region || "auto",
        requestTimeoutMs: config.requestTimeoutMs,
        maxRetries: config.maxRetries,
        logLevel: config.logLevel || "info",
      },
      logger,
    );
  }

  /**
   * Initialize the session (login)
   * This is called automatically when needed, but can be called explicitly
   */
  public async getOrRefreshToken(): Promise<void> {
    // SmartLifeClient handles authentication automatically
    // Just trigger a simple request to ensure we're logged in
    try {
      await this.client.listHomes();
    } catch (error) {
      if (error instanceof SmartLifeApiError) {
        throw new AuthenticationError(error.message);
      }
      throw error;
    }
  }

  /**
   * Get all device states
   */
  public async getAllDeviceStates(): Promise<TuyaDevice[] | undefined> {
    return this.discoverDevices();
  }

  /**
   * Discover all devices across all homes
   */
  public async discoverDevices(): Promise<TuyaDevice[] | undefined> {
    // Prevent concurrent discovery requests
    if (this.discoveryPromise) {
      return this.discoveryPromise;
    }

    this.discoveryPromise = this.performDiscovery();
    try {
      const result = await this.discoveryPromise;
      return result;
    } finally {
      this.discoveryPromise = undefined;
    }
  }

  private async performDiscovery(): Promise<TuyaDevice[] | undefined> {
    try {
      const homes = await this.client.listHomes();
      this.log?.info(`SmartLife: Found ${homes.length} home(s)`);
      const allDevices: TuyaDevice[] = [];
      const productCategories = new Map<string, string>();

      for (const home of homes) {
        const homeData = home as Record<string, unknown>;
        const homeId =
          homeData.groupId ||
          homeData.homeId ||
          homeData.gid ||
          homeData.id;

        if (!homeId) {
          this.log?.warn(`SmartLife: Home without ID found, skipping:`, home);
          continue;
        }

        try {
          this.log?.debug(`SmartLife: Fetching devices for home ${homeId}...`);
          const devices = await this.client.listHomeDevices(
            homeId as string | number,
          );
          this.log?.info(`SmartLife: Found ${devices.length} device(s) in home ${homeId}`);
          
          // Enrich devices with category from product specs
          for (const device of devices) {
            const dev = device as Record<string, unknown>;
            const productId = dev.productId as string;
            
            if (productId && !productCategories.has(productId)) {
              try {
                const productSpec = await this.client.getProductSpec(productId) as Record<string, unknown>;
                const category = productSpec?.category as string;
                if (category) {
                  productCategories.set(productId, category);
                  this.log?.debug(`SmartLife: Product ${productId} has category: ${category}`);
                }
              } catch (error) {
                this.log?.debug(`Could not get product spec for ${productId}:`, error);
              }
            }
            
            // Add category to device
            if (productId && productCategories.has(productId)) {
              dev.category = productCategories.get(productId);
            }
          }
          
          const tuyaDevices = this.convertSmartLifeDevicesToTuya(devices);
          allDevices.push(...tuyaDevices);
        } catch (error) {
          // Log error but continue with other homes
          if (this.log) {
            this.log.warn(`Failed to get devices for home ${homeId}:`, error);
          }
        }
      }

      this.log?.info(`SmartLife: Total devices discovered: ${allDevices.length}`);
      this.devicesCache = allDevices;
      this.lastDiscoveryTime = Date.now();
      return allDevices;
    } catch (error) {
      if (error instanceof SmartLifeApiError) {
        if (error.code === "FrequentlyInvoke" || error.code === "FREQUENTLY_INVOKE") {
          throw new RateLimitError("Requesting too quickly.", error.message);
        }
        throw new AuthenticationError(error.message);
      }
      throw error;
    }
  }

  /**
   * Get state for a specific device
   */
  public async getDeviceState(deviceId: string): Promise<Record<string, unknown>> {
    try {
      const dp = await this.client.getDeviceDp(deviceId);
      return dp;
    } catch (error) {
      if (error instanceof SmartLifeApiError) {
        if (error.code === "FrequentlyInvoke" || error.code === "FREQUENTLY_INVOKE") {
          throw new RateLimitError("Requesting too quickly.", error.message);
        }
        throw new Error(`Failed to get device state: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Set device state
   * For SmartLife API, we need to publish data points
   */
  public async setDeviceState(
    deviceId: string,
    method: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      // Convert the old API method/payload to SmartLife DP format
      const dps = this.convertPayloadToDps(method, payload);
      
      await this.client.publishDp(deviceId, dps);
    } catch (error) {
      if (error instanceof SmartLifeApiError) {
        if (error.code === "FrequentlyInvoke" || error.code === "FREQUENTLY_INVOKE") {
          throw new RateLimitError("Requesting too quickly.", error.message);
        }
        if (error.code === "UnsupportedOperation") {
          throw new UnsupportedOperationError(
            "Unsupported Operation",
            "The action you tried to perform is not valid for the current device. Please disable it.",
          );
        }
        if (error.code === "TargetOffline" || error.code === "DEVICE_OFFLINE") {
          throw new DeviceOfflineError();
        }
        throw new Error(`Failed to set device state: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Convert SmartLife device format to Tuya format
   */
  private convertSmartLifeDevicesToTuya(devices: unknown[]): TuyaDevice[] {
    this.log?.debug(`Converting ${devices.length} SmartLife devices to Tuya format`);
    
    return devices
      .map((device, index) => {
        const dev = device as Record<string, unknown>;
        
        // Log first device structure for debugging
        if (index === 0 && this.log) {
          this.log.debug(`First device structure: ${JSON.stringify(dev, null, 2)}`);
        }
        
        // Extract data points
        const dps = (dev.dps as Record<string, unknown>) || {};
        const state = Object.keys(dps).length > 0 ? dps : undefined;

        const category = dev.category as string;
        const devType = this.mapCategoryToDevType(category);
        const haType = this.mapCategoryToHaType(category);

        const tuyaDevice = {
          id: (dev.devId || dev.id) as string,
          name: (dev.name || "Unknown Device") as string,
          dev_type: devType,
          ha_type: haType,
          data: state || {},
          online: (dev.online ?? true) as boolean,
          icon: (dev.iconUrl || "") as string,
        } as TuyaDevice;

        this.log?.debug(`Device "${tuyaDevice.name}" (${tuyaDevice.id}): category=${category}, dev_type=${devType}, ha_type=${haType}`);

        return tuyaDevice;
      })
      .filter((device) => device.id);
  }

  /**
   * Map SmartLife category to dev_type
   */
  private mapCategoryToDevType(category?: string): string {
    if (!category) return "scene";
    
    const categoryMap: Record<string, string> = {
      "cz": "outlet",
      "kg": "switch",
      "pc": "outlet",
      "tdq": "light",
      "dj": "light",
      "dd": "light",
      "xdd": "dimmer",
      "fsd": "fan",
      "fs": "fan",
      "cl": "cover",
      "jy": "cover",
      "wnykq": "climate",
      "wsdcg": "sensor",
    };

    return categoryMap[category] || "scene";
  }

  /**
   * Map SmartLife category to ha_type (Home Assistant type)
   */
  private mapCategoryToHaType(category?: string): string {
    if (!category) return "scene";
    
    const haTypeMap: Record<string, string> = {
      "cz": "outlet",
      "kg": "switch",
      "pc": "outlet",
      "tdq": "light",
      "dj": "light",
      "dd": "light",
      "xdd": "light",
      "fsd": "fan",
      "fs": "fan",
      "cl": "cover",
      "jy": "cover",
      "wnykq": "climate",
      "wsdcg": "sensor",
    };

    return haTypeMap[category] || "scene";
  }

  /**
   * Convert old API method/payload to SmartLife DP format
   */
  private convertPayloadToDps(
    method: string,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    // Common conversions
    const dps: Record<string, unknown> = {};

    switch (method) {
      case "turnOnOff":
        dps["1"] = payload.value;
        break;
      case "brightnessSet":
        dps["3"] = payload.value;
        break;
      case "colorSet":
        if (payload.color) {
          const color = payload.color as Record<string, unknown>;
          if (color.hue !== undefined && color.saturation !== undefined) {
            // Convert HSV to DP format
            const h = Math.round((color.hue as number) * 360);
            const s = Math.round((color.saturation as number) * 1000);
            const v = color.brightness
              ? Math.round((color.brightness as number) * 1000)
              : 1000;
            dps["5"] = `${h.toString(16).padStart(4, "0")}${s.toString(16).padStart(4, "0")}${v.toString(16).padStart(4, "0")}`;
          }
        }
        break;
      case "colorTemperatureSet":
        dps["4"] = payload.value;
        break;
      default:
        // Pass through any DP values directly
        if (payload.dp) {
          Object.assign(dps, payload.dp);
        }
    }

    return dps;
  }
}
