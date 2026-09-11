/**
 * @nemesis-oss/nexum-tools — the tool plane.
 *
 * Tool implementations and the mountable domain packs. Mount packs via
 * the kernel's ToolPack API; deep imports (e.g.
 * @nemesis-oss/nexum-tools/docs/store) are supported.
 */
export * from "./packs/index.js";
export { Tool, ToolError } from "./tools/tool.js";
