import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { gmailPlugin } from './server/viteGmailPlugin.js'
import { googleDrivePlugin } from './server/viteGoogleDrivePlugin.js'
import { jobScrapePlugin } from './server/viteJobScrapePlugin.js'
import { usersAdminPlugin } from './server/viteUsersAdminPlugin.js'

// https://vite.dev/config/
export default defineConfig({
  // Bind IPv4+IPv6 so localhost / 127.0.0.1 work (Windows often IPv6-only otherwise).
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
  plugins: [
    react(),
    jobScrapePlugin(),
    usersAdminPlugin(),
    googleDrivePlugin(),
    gmailPlugin(),
  ],
})
