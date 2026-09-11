/**
 * ModelGateway — the kernel's single port to model inference.
 *
 * Port only: the default implementation (DefaultModelGateway, which
 * routes over the model plane's Router/Catalog stack) lives in
 * provider/default-model-gateway.ts after the package split.
 */

import type { ChatMessage, ChatOptions, ChatResponse, Capability } from "../model-types.js";
import type { ModelCapabilityRegistry } from "./model-capability-registry.js";

export interface ModelGateway {
  /** Route one chat request by capability. Never mutates provider state. */
  route(capability: Capability, messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResponse>;
  /** Route bypassing capability selection (explicit model). */
  routeToModel(
    model: string,
    tier: "local" | "cloud",
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatResponse>;
  /** The capability registry the gateway routes from. */
  profiles(): ModelCapabilityRegistry;
}
