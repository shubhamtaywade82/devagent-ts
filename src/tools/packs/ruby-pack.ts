/**
 * RubyPack (review item 21) — Ruby-specific tooling from the ruby domain
 * (domains/ruby/): RuboCop linting + RSpec test execution.
 */

import { Tool } from "../tool.js";
import { RunRubocopTool } from "../../domains/ruby/rubocop-tool.js";
import { RunRSpecTool } from "../../domains/ruby/rspec-tool.js";
import { ToolPack, packOf } from "../gateway/tool-pack.js";

export function rubyPack(root: string): ToolPack {
  return packOf(
    "ruby",
    "Ruby/Rails project tooling: RuboCop, RSpec.",
    "build",
    [new RunRubocopTool(root), new RunRSpecTool(root)],
    "Ruby",
  );
}
