import type { NextConfig } from "next";
const config: NextConfig = {
  output: process.env.NEXT_STATIC_EXPORT === "1" ? "export" : "standalone",
  poweredByHeader: false,
};
export default config;
