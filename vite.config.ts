import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const csp =
  "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' blob: data:; font-src 'self'; media-src 'self' blob:; connect-src 'self' ipc: http://ipc.localhost https://accounts.google.com https://www.googleapis.com https://openidconnect.googleapis.com https://login.microsoftonline.com https://login.live.com https://graph.microsoft.com https://*.1drv.com https://*.sharepoint.com; frame-src 'self' https://accounts.google.com https://login.microsoftonline.com https://login.live.com; object-src 'none'; base-uri 'self'; form-action 'self'";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "notes-security",
      apply: "build",
      transformIndexHtml(html) {
        return html.replace(
          "<head>",
          `<head><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="strict-origin-when-cross-origin">`,
        );
      },
    },
  ],
  server: { port: 5173, strictPort: true },
  build: { target: "es2022" },
});
