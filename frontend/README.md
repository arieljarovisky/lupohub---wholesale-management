<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1vurSfax-n5NSWde_guV8DvgSLfJvF3Of

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Backend API Configuration

Set `VITE_API_URL` in [.env.local](.env.local) to point to your backend base URL. Examples:
- Development: `VITE_API_URL=http://localhost:3001/api`
- Custom port: `VITE_API_URL=http://localhost:3010/api`

You can override the Base URL from the UI in Configuración → Conectividad APIs. The app will use this value to fetch productos y pedidos desde el backend.
