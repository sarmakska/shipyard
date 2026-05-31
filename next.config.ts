import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a built-in module loaded at runtime. Keep it external so the
  // bundler does not attempt to inline it into the server build.
  serverExternalPackages: ["node:sqlite"],
};

export default nextConfig;
